
/**
 * MV3 Service Worker for dynamic URL redirection using declarativeNetRequest (DNR).
 * - Stores user rules in chrome.storage.local
 * - Translates them into DNR dynamic rules (updateDynamicRules)
 * - Logs matches via chrome.declarativeNetRequest.onRuleMatchedDebug
 *
 * Rule structure in storage:
 * {
 *   id: string,        // uuid-like
 *   name: string,      // <= 80 chars
 *   mode: "exact" | "wildcard" | "contain" | "domain",
 *   source: string,
 *   destination: string,
 *   enabled: boolean,
 *   disablePwBotDetection: boolean,
 *   categoryId: string | null // optional; missing/null means Uncategorized
 * }
 *
 * We maintain a mapping between our rule.id and a numeric DNR ruleId.
 */

const STORAGE_KEYS = {
  RULES: "rules",
  CATEGORIES: "categories",
  GLOBAL_ENABLED: "globalEnabled",
  LOGS: "logs",
  NEXT_DNR_ID: "nextDnrId",
  MAP: "idMap", // map our rule.id -> DNR numeric id
  RULE_STATUSES: "ruleStatuses",
  USER_AGENT_OVERRIDE: "userAgentOverride"
};

const LOG_LIMIT = 1000; // keep last N logs
const USER_AGENT_DNR_RULE_ID = 1;
const DEFAULT_USER_AGENT_OVERRIDE = {
  enabled: false,
  mode: "attach",
  value: "Playwire/2.0"
};
const PW_BOT_CONTENT_SCRIPT_ID = "pw-bot-accessor";
const PW_BOT_CONTENT_SCRIPT_FILE = "content/pw-bot-accessor.js";
const DNR_RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "other"
];

const RULE_ACTIVITY_SESSION_KEY = "ruleActivity";
const ACTION_ICON = {
  active: {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  inactive: {
    "16": "icons/icon16-gray.png",
    "32": "icons/icon32-gray.png",
    "48": "icons/icon48-gray.png",
    "128": "icons/icon128-gray.png"
  }
};
let logWriteQueue = Promise.resolve();
let ruleActivityQueue = Promise.resolve();
const activePwBotFrames = new Map();
const tabRuleActivityFallback = {};

async function getRuleActivity() {
  if (!chrome.storage.session) return tabRuleActivityFallback;
  const data = await chrome.storage.session.get({ [RULE_ACTIVITY_SESSION_KEY]: {} });
  return data[RULE_ACTIVITY_SESSION_KEY] || {};
}

async function setRuleActivity(activity) {
  if (!chrome.storage.session) {
    Object.keys(tabRuleActivityFallback).forEach(key => delete tabRuleActivityFallback[key]);
    Object.assign(tabRuleActivityFallback, activity);
    return;
  }
  await chrome.storage.session.set({ [RULE_ACTIVITY_SESSION_KEY]: activity });
}

async function updateRuleActivity(mutator) {
  ruleActivityQueue = ruleActivityQueue.catch(() => {}).then(async () => {
    const activity = await getRuleActivity();
    const result = mutator(activity);
    await setRuleActivity(activity);
    return result;
  });
  return ruleActivityQueue;
}

async function getAppliedRuleNames(tabId) {
  const activity = await getRuleActivity();
  const rulesById = activity[String(tabId)] || {};
  return Object.values(rulesById);
}

async function updateActionState(tabId, globalEnabled = null) {
  if (typeof tabId !== "number" || tabId < 0) return;
  const enabled = globalEnabled === null
    ? (await getState())[STORAGE_KEYS.GLOBAL_ENABLED] !== false
    : globalEnabled;
  const count = (await getAppliedRuleNames(tabId)).length;
  const active = enabled && count > 0;
  await chrome.action.setIcon({ tabId, path: active ? ACTION_ICON.active : ACTION_ICON.inactive }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" }).catch(() => {});
  await chrome.action.setBadgeText({ tabId, text: active ? String(count) : "" }).catch(() => {});
}

async function updateAllActionStates(globalEnabled = null) {
  const enabled = globalEnabled === null
    ? (await getState())[STORAGE_KEYS.GLOBAL_ENABLED] !== false
    : globalEnabled;
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all(tabs
    .filter(tab => typeof tab.id === "number")
    .map(tab => updateActionState(tab.id, enabled)));
}

async function resetTabRuleActivity(tabId) {
  if (typeof tabId !== "number" || tabId < 0) return;
  await updateRuleActivity(activity => {
    delete activity[String(tabId)];
  });
  await updateActionState(tabId);
  await chrome.runtime.sendMessage({ type: "rule-activity-updated", tabId }).catch(() => {});
}

async function rememberAppliedRule(tabId, rule) {
  if (typeof tabId !== "number" || tabId < 0 || !rule || !rule.id) return;
  const changed = await updateRuleActivity(activity => {
    const key = String(tabId);
    const rulesById = activity[key] || {};
    if (Object.prototype.hasOwnProperty.call(rulesById, rule.id)) return false;
    rulesById[rule.id] = rule.name || "Unnamed rule";
    activity[key] = rulesById;
    return true;
  });
  if (!changed) return;
  await updateActionState(tabId);
  await chrome.runtime.sendMessage({ type: "rule-activity-updated", tabId }).catch(() => {});
}

async function getState() {
  const data = await chrome.storage.local.get({
    [STORAGE_KEYS.RULES]: [],
    [STORAGE_KEYS.CATEGORIES]: [],
    [STORAGE_KEYS.GLOBAL_ENABLED]: true,
    [STORAGE_KEYS.LOGS]: [],
    [STORAGE_KEYS.NEXT_DNR_ID]: 1000,
    [STORAGE_KEYS.MAP]: {},
    [STORAGE_KEYS.RULE_STATUSES]: {},
    [STORAGE_KEYS.USER_AGENT_OVERRIDE]: DEFAULT_USER_AGENT_OVERRIDE
  });
  return data;
}

async function setState(patch) {
  return chrome.storage.local.set(patch);
}

function normalizeRuleForClient(rule) {
  return {
    ...rule,
    disablePwBotDetection: !!(rule && rule.disablePwBotDetection)
  };
}

function normalizeUserAgentOverride(config) {
  const source = config && typeof config === "object" ? config : {};
  const value = typeof source.value === "string" && source.value.trim()
    ? source.value.trim()
    : DEFAULT_USER_AGENT_OVERRIDE.value;
  return {
    enabled: !!source.enabled,
    mode: source.mode === "replace" ? "replace" : "attach",
    value
  };
}

function getUserAgentValidationError(value) {
  const text = String(value || "").trim();
  if (!text) return "User Agent value is required";
  if (!/^[\x20-\x7E]+$/.test(text)) {
    return "User Agent value must use printable ASCII characters only";
  }
  return "";
}

async function appendLogAndNotify(entry) {
  await appendLog(entry);
  await chrome.runtime.sendMessage({ type: "logs-updated" }).catch(() => {});
}

function getEnabledPwBotOverrideRuleIds(state) {
  const globalEnabled = state[STORAGE_KEYS.GLOBAL_ENABLED] !== false;
  if (!globalEnabled) return new Set();
  const rules = state[STORAGE_KEYS.RULES] || [];
  return new Set(
    rules
      .filter(rule => !!rule.enabled && !!rule.disablePwBotDetection)
      .map(rule => rule.id)
  );
}

function normalizeCategoryName(name) {
  return String(name || "").trim();
}

function getCategoryId(categoryId, categories) {
  const id = typeof categoryId === "string" && categoryId ? categoryId : null;
  if (!id) return null;
  return categories.some(category => category.id === id) ? id : null;
}

function normalizeCategory(category) {
  if (!category || typeof category.id !== "string") return null;
  const name = normalizeCategoryName(category.name);
  if (!name) return null;
  return { id: category.id, name };
}

function normalizeCategories(categories) {
  const seen = new Set();
  const normalized = [];
  for (const category of Array.isArray(categories) ? categories : []) {
    const next = normalizeCategory(category);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    normalized.push(next);
  }
  return normalized;
}

// Escape for exact-match regex
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isValidHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidDomain(str) {
  const value = String(str || "").trim().toLowerCase();
  if (!value || value.length > 253 || /[:/?#@\s]/.test(value)) return false;
  return value
    .split(".")
    .every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function getSourceValidationError(source, mode) {
  const value = String(source || '').trim();
  if (!value) return "Source is required";

  if (mode === "exact") {
    return isValidHttpUrl(value) ? "" : "Exact source must be a valid http(s) URL";
  }

  if (mode === "wildcard") {
    if (!/^https?:\/\//i.test(value)) {
      return "Wildcard source must start with http:// or https://";
    }
    if (/\s/.test(value)) {
      return "Wildcard source cannot contain whitespace";
    }
    return "";
  }

  if (mode === "contain") {
    if (/\s/.test(value)) {
      return "Contain source cannot contain whitespace";
    }
    return "";
  }

  if (mode === "domain") {
    return isValidDomain(value) ? "" : "Domain source must be a bare domain, for example cdn.intergient.com";
  }

  return "Unsupported rule mode";
}

function getDestinationValidationError(destination, mode) {
  const value = String(destination || "").trim();
  if (!value) return "Destination is required";
  if (mode === "domain") {
    return isValidDomain(value) ? "" : "Domain destination must be a bare domain, for example cdn.intergientdev.com";
  }
  return isValidHttpUrl(value) ? "" : "Destination must be a valid URL";
}

function makeRuleStatus(ok, message) {
  return {
    ok,
    message,
    updatedAt: new Date().toISOString()
  };
}

function redactUrlForLog(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return String(rawUrl || "").split(/[?#]/)[0];
  }
}

async function getWebpageUrlForLog(request) {
  if (!request) return "";
  if (request.type === "main_frame" && request.url) return redactUrlForLog(request.url);
  if (request.documentUrl) return redactUrlForLog(request.documentUrl);

  if (typeof request.tabId === "number" && request.tabId >= 0) {
    const tab = await chrome.tabs.get(request.tabId).catch(() => null);
    if (tab && tab.url) return redactUrlForLog(tab.url);
  }

  return request.initiator ? redactUrlForLog(request.initiator) : "";
}

async function appendLog(entry) {
  logWriteQueue = logWriteQueue.catch(() => {}).then(async () => {
    const state = await getState();
    const logs = state[STORAGE_KEYS.LOGS] || [];
    logs.push(entry);
    while (logs.length > LOG_LIMIT) logs.shift();
    await setState({ [STORAGE_KEYS.LOGS]: logs });
  });

  await logWriteQueue;
}

function setPwBotAccessorActive(active) {
  const stateKey = "__urlRedirectorPwBotDetectionState__";
  const apiKey = "__urlRedirectorPwBotDetectionApi__";
  const scoreKey = "_pwBotScore";

  const state = window[stateKey] || {
    active: false,
    hasValue: Object.prototype.hasOwnProperty.call(window, scoreKey),
    value: window[scoreKey]
  };

  function readScore() {
    return state.active ? 99 : state.value;
  }

  function writeScore(value) {
    state.hasValue = true;
    state.value = value;
  }

  function install() {
    try {
      Object.defineProperty(window, scoreKey, {
        configurable: true,
        enumerable: true,
        get: readScore,
        set: writeScore
      });
    } catch {
      return false;
    }
    return true;
  }

  const api = window[apiKey] || {
    install,
    activate() {
      state.active = true;
      return install();
    },
    deactivate() {
      state.active = false;
      return install();
    },
    isActive() {
      return state.active;
    }
  };

  Object.defineProperty(window, stateKey, {
    configurable: true,
    value: state
  });
  Object.defineProperty(window, apiKey, {
    configurable: true,
    value: api
  });

  if (active) return api.activate();
  return api.deactivate();
}

function rememberActivePwBotFrames(tabId, results, ruleId) {
  if (typeof tabId !== "number" || !Array.isArray(results) || !ruleId) return;
  const frameMap = activePwBotFrames.get(tabId) || new Map();
  for (const result of results) {
    if (result && typeof result.frameId === "number") {
      const ruleIds = frameMap.get(result.frameId) || new Set();
      ruleIds.add(ruleId);
      frameMap.set(result.frameId, ruleIds);
    }
  }
  if (frameMap.size) activePwBotFrames.set(tabId, frameMap);
}

async function setPwBotOverrideForTarget(tabId, active, frameId = null, ruleId = null) {
  if (typeof tabId !== "number" || tabId < 0) return [];

  const target = { tabId };
  if (typeof frameId === "number" && frameId >= 0) {
    target.frameIds = [frameId];
  } else {
    target.allFrames = true;
  }

  const results = await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: setPwBotAccessorActive,
    args: [active]
  }).catch(() => []);

  if (active) rememberActivePwBotFrames(tabId, results, ruleId);
  return results;
}

async function activatePwBotOverride(tabId, frameId, rule) {
  const results = await setPwBotOverrideForTarget(tabId, true, frameId, rule && rule.id);
  if (!results.length) return;

  await appendLog({
    time: new Date().toISOString(),
    info: `PW Bot Detection override activated for rule [${rule.name}]`
  });
  await chrome.runtime.sendMessage({ type: "logs-updated" }).catch(() => {});
}

async function deactivateStalePwBotOverrides(activeRuleIds) {
  if (activeRuleIds.size === 0) {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    await Promise.all(tabs
      .filter(tab => typeof tab.id === "number")
      .map(tab => setPwBotOverrideForTarget(tab.id, false)));
    activePwBotFrames.clear();
    return;
  }

  const entries = Array.from(activePwBotFrames.entries());
  for (const [tabId, frameMap] of entries) {
    for (const [frameId, ruleIds] of Array.from(frameMap.entries())) {
      for (const ruleId of Array.from(ruleIds)) {
        if (!activeRuleIds.has(ruleId)) ruleIds.delete(ruleId);
      }
      if (ruleIds.size === 0) {
        frameMap.delete(frameId);
        await setPwBotOverrideForTarget(tabId, false, frameId);
      }
    }
    if (frameMap.size === 0) {
      activePwBotFrames.delete(tabId);
    }
  }
}

async function isPwBotAccessorRegistered() {
  const scripts = await chrome.scripting
    .getRegisteredContentScripts({ ids: [PW_BOT_CONTENT_SCRIPT_ID] })
    .catch(() => []);
  return scripts.some(script => script.id === PW_BOT_CONTENT_SCRIPT_ID);
}

async function registerPwBotAccessor() {
  if (await isPwBotAccessorRegistered()) return;
  await chrome.scripting.registerContentScripts([{
    id: PW_BOT_CONTENT_SCRIPT_ID,
    js: [PW_BOT_CONTENT_SCRIPT_FILE],
    matches: ["<all_urls>"],
    runAt: "document_start",
    world: "MAIN",
    allFrames: true,
    persistAcrossSessions: false
  }]).catch(() => {});
}

async function unregisterPwBotAccessor() {
  await chrome.scripting.unregisterContentScripts({ ids: [PW_BOT_CONTENT_SCRIPT_ID] }).catch(() => {});
}

async function syncPwBotAccessor(state = null) {
  const currentState = state || await getState();
  const activeRuleIds = getEnabledPwBotOverrideRuleIds(currentState);

  if (activeRuleIds.size > 0) {
    await registerPwBotAccessor();
  } else {
    await unregisterPwBotAccessor();
  }

  await deactivateStalePwBotOverrides(activeRuleIds);
}

// Build a DNR rule and an install status.
async function toDnrRule(rule, dnrId) {
  const sourceError = getSourceValidationError(rule.source, rule.mode);
  if (sourceError) {
    return { dnrRule: null, status: makeRuleStatus(false, sourceError) };
  }
  const destinationError = getDestinationValidationError(rule.destination, rule.mode);
  if (destinationError) {
    return { dnrRule: null, status: makeRuleStatus(false, destinationError) };
  }

  const action = {
    type: "redirect",
    redirect: {}
  };

  const condition = {
    resourceTypes: DNR_RESOURCE_TYPES
  };

  // Choose filter and redirect mapping
  if (rule.mode === "contain") {
    // urlFilter does substring match (case-insensitive, normalized). Good for "contains".
    condition.urlFilter = rule.source;
    action.redirect = { url: rule.destination };
  } else if (rule.mode === "exact") {
    // Use regexFilter for exact equals
    const expr = "^" + escapeRegex(rule.source) + "$";
    condition.regexFilter = expr;

    // Use a simple redirect URL
    action.redirect = { url: rule.destination };

    // Validate regex support
    const ok = await chrome.declarativeNetRequest.isRegexSupported({ regex: expr }).catch(() => ({ isSupported: false }));
    if (!ok || ok.isSupported === false) {
      return {
        dnrRule: null,
        status: makeRuleStatus(false, `Exact regex is not supported${ok && ok.reason ? `: ${ok.reason}` : ""}`)
      };
    }
  } else if (rule.mode === "wildcard") {
    // Convert wildcard pattern where "*" matches any characters
    const expr = "^" + rule.source.split("*").map(escapeRegex).join(".*") + "$";
    const support = await chrome.declarativeNetRequest
      .isRegexSupported({ regex: expr })
      .catch(() => ({ isSupported: false }));
    if (!support || support.isSupported === false) {
      return {
        dnrRule: null,
        status: makeRuleStatus(false, `Wildcard pattern is not supported${support && support.reason ? `: ${support.reason}` : ""}`)
      };
    }
    condition.regexFilter = expr;
    action.redirect = { url: rule.destination };
  } else if (rule.mode === "domain") {
    condition.urlFilter = `||${String(rule.source).trim().toLowerCase()}/`;
    action.redirect = {
      transform: {
        host: String(rule.destination).trim().toLowerCase()
      }
    };
  } else {
    return { dnrRule: null, status: makeRuleStatus(false, "Unsupported rule mode") };
  }

  return {
    dnrRule: {
      id: dnrId,
      priority: 1,
      action,
      condition
    },
    status: makeRuleStatus(true, "Installed")
  };
}

function toUserAgentDnrRule(config) {
  const userAgentOverride = normalizeUserAgentOverride(config);
  const value = userAgentOverride.value.trim();
  const validationError = getUserAgentValidationError(value);
  if (!userAgentOverride.enabled || validationError) return null;

  return {
    id: USER_AGENT_DNR_RULE_ID,
    priority: 2,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{
        header: "user-agent",
        operation: userAgentOverride.mode === "replace" ? "set" : "append",
        value
      }]
    },
    condition: {
      regexFilter: "^https?://",
      resourceTypes: DNR_RESOURCE_TYPES
    }
  };
}

async function rebuildDnrRules() {
  const state = await getState();
  const { RULES, GLOBAL_ENABLED, MAP } = STORAGE_KEYS;
  const rules = state[RULES] || [];
  const globalEnabled = state[GLOBAL_ENABLED] !== false;
  const idMap = state[MAP] || {};
  const statuses = {};
  const add = [];
  const userAgentRule = toUserAgentDnrRule(state[STORAGE_KEYS.USER_AGENT_OVERRIDE]);
  if (userAgentRule) add.push(userAgentRule);

  if (!globalEnabled) {
    for (const r of rules) {
      statuses[r.id] = makeRuleStatus(true, r.enabled ? "Global disabled" : "Disabled");
    }
  } else {
    // Build redirect rules only while global redirects are enabled.
    for (const r of rules) {
      if (!r.enabled) {
        statuses[r.id] = makeRuleStatus(true, "Disabled");
        continue;
      }

      const dnrId = idMap[r.id] || state[STORAGE_KEYS.NEXT_DNR_ID] || 1000;
      const result = await toDnrRule(r, dnrId);
      statuses[r.id] = result.status;

      if (result.dnrRule) {
        if (!idMap[r.id]) {
          idMap[r.id] = dnrId;
          state[STORAGE_KEYS.NEXT_DNR_ID] = dnrId + 1;
        }
        add.push(result.dnrRule);
      } else {
        // rule invalid; drop its mapping so ids can be reused
        delete idMap[r.id];
      }
    }
  }

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existing.map(r => r.id);

  // Replace existing dynamic rules entirely to avoid duplicate IDs
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: removeIds,
    addRules: add
  });

  // Commit storage changes after Chrome accepts the DNR update.
  await setState({
    [STORAGE_KEYS.MAP]: idMap,
    [STORAGE_KEYS.NEXT_DNR_ID]: state[STORAGE_KEYS.NEXT_DNR_ID],
    [STORAGE_KEYS.RULE_STATUSES]: statuses
  });
  await syncPwBotAccessor({
    ...state,
    [STORAGE_KEYS.MAP]: idMap,
    [STORAGE_KEYS.RULE_STATUSES]: statuses
  });
}

// Listen to rule matches for logging when the debug API is available.
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
  try {
    const state = await getState();
    const globalEnabled = state[STORAGE_KEYS.GLOBAL_ENABLED] !== false;
    if (!globalEnabled) return;

    const rules = state[STORAGE_KEYS.RULES] || [];
    const idMap = state[STORAGE_KEYS.MAP] || {};

    // Find our rule by DNR id
    const matchedId = info.rule.ruleId;
    if (matchedId === USER_AGENT_DNR_RULE_ID) return;

    let matchedRule = null;
    for (const [rid, dnrId] of Object.entries(idMap)) {
      if (dnrId === matchedId) {
        matchedRule = (rules.find(r => r.id === rid) || null);
        break;
      }
    }
    if (!matchedRule || !matchedRule.enabled) return;

    await rememberAppliedRule(info.request && info.request.tabId, matchedRule);

    if (matchedRule.disablePwBotDetection) {
      const tabId = info.request && info.request.tabId;
      const frameId = info.request && info.request.frameId;
      await activatePwBotOverride(tabId, frameId, matchedRule);
    }

    const ts = new Date().toISOString();
    const requestUrl = redactUrlForLog(info.request.url);
    const webpageUrl = await getWebpageUrlForLog(info.request);
    const logTarget = webpageUrl
      ? `on webpage [${webpageUrl}] URL [${requestUrl}]`
      : `on URL [${requestUrl}]`;

    await appendLog({ time: ts, info: `${logTarget} rule [${matchedRule.name}] applied` });
    // notify UI
    await chrome.runtime.sendMessage({ type: "logs-updated" }).catch(() => {});
  } catch (e) {
    // swallow
  }
});
}

chrome.tabs.onRemoved.addListener((tabId) => {
  activePwBotFrames.delete(tabId);
  resetTabRuleActivity(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    resetTabRuleActivity(tabId);
  }
});

// Messages from options UI
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg && msg.type === "get-popup-state") {
        const state = await getState();
        const tabId = typeof msg.tabId === "number" ? msg.tabId : sender.tab && sender.tab.id;
        const globalEnabled = state[STORAGE_KEYS.GLOBAL_ENABLED] !== false;
        await updateActionState(tabId, globalEnabled);
        sendResponse({
          globalEnabled,
          appliedRules: await getAppliedRuleNames(tabId)
        });
        return;
      }

      if (msg && msg.type === "get-state") {
      let state = await getState();
      const rules = state[STORAGE_KEYS.RULES] || [];
      const ruleStatuses = state[STORAGE_KEYS.RULE_STATUSES] || {};
      if (rules.length && Object.keys(ruleStatuses).length === 0) {
        await rebuildDnrRules();
        state = await getState();
      }
      sendResponse({
        rules: (state[STORAGE_KEYS.RULES] || []).map(normalizeRuleForClient),
        categories: normalizeCategories(state[STORAGE_KEYS.CATEGORIES]),
        globalEnabled: state[STORAGE_KEYS.GLOBAL_ENABLED] !== false,
        userAgentOverride: normalizeUserAgentOverride(state[STORAGE_KEYS.USER_AGENT_OVERRIDE]),
        logs: state[STORAGE_KEYS.LOGS] || [],
        ruleStatuses: state[STORAGE_KEYS.RULE_STATUSES] || {}
      });
      return;
    }

    if (msg && msg.type === "set-global") {
      const enabled = !!msg.enabled;
      await setState({ [STORAGE_KEYS.GLOBAL_ENABLED]: enabled });
      await rebuildDnrRules();
      await updateAllActionStates(enabled);
      await chrome.runtime.sendMessage({ type: "global-state-updated" }).catch(() => {});
      sendResponse({ ok: true });
      return;
    }

    if (msg && msg.type === "set-user-agent-enabled") {
      const state = await getState();
      const current = normalizeUserAgentOverride(state[STORAGE_KEYS.USER_AGENT_OVERRIDE]);
      const enabled = !!msg.enabled;
      const validationError = enabled ? getUserAgentValidationError(current.value) : "";
      if (validationError) {
        sendResponse({ ok: false, error: validationError });
        return;
      }

      if (current.enabled === enabled) {
        sendResponse({ ok: true, userAgentOverride: current });
        return;
      }

      const next = { ...current, enabled };
      try {
        await setState({ [STORAGE_KEYS.USER_AGENT_OVERRIDE]: next });
        await rebuildDnrRules();
      } catch (e) {
        await setState({ [STORAGE_KEYS.USER_AGENT_OVERRIDE]: current });
        await rebuildDnrRules().catch(() => {});
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
        return;
      }
      await appendLogAndNotify({
        time: new Date().toISOString(),
        info: `User Agent override ${enabled ? "enabled" : "disabled"}`
      });
      sendResponse({ ok: true, userAgentOverride: next });
      return;
    }

    if (msg && msg.type === "save-user-agent-override") {
      const mode = msg.mode === "replace" ? "replace" : msg.mode === "attach" ? "attach" : "";
      const value = String(msg.value || "").trim();
      if (!mode) {
        sendResponse({ ok: false, error: "Unsupported User Agent override mode" });
        return;
      }
      const validationError = getUserAgentValidationError(value);
      if (validationError) {
        sendResponse({ ok: false, error: validationError });
        return;
      }

      const state = await getState();
      const current = normalizeUserAgentOverride(state[STORAGE_KEYS.USER_AGENT_OVERRIDE]);
      const next = { ...current, mode, value };
      const changed = current.mode !== next.mode || current.value !== next.value;
      if (!changed) {
        sendResponse({ ok: true, userAgentOverride: next });
        return;
      }

      try {
        await setState({ [STORAGE_KEYS.USER_AGENT_OVERRIDE]: next });
        await rebuildDnrRules();
      } catch (e) {
        await setState({ [STORAGE_KEYS.USER_AGENT_OVERRIDE]: current });
        await rebuildDnrRules().catch(() => {});
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
        return;
      }
      await appendLogAndNotify({
        time: new Date().toISOString(),
        info: `User Agent override changed to ${mode} [${value}]`
      });
      sendResponse({ ok: true, userAgentOverride: next });
      return;
    }

    if (msg && msg.type === "save-rule") {
      const state = await getState();
      const current = state[STORAGE_KEYS.RULES] || [];
      const categories = normalizeCategories(state[STORAGE_KEYS.CATEGORIES]);
      const r = msg.rule;
      // Basic validation
      if (!r || !r.name || !r.source || !r.destination) {
        sendResponse({ ok: false, error: "Missing fields" });
        return;
      }
      if (r.name.length > 80) {
        sendResponse({ ok: false, error: "Name exceeds 80 characters" });
        return;
      }
      if (!["exact", "wildcard", "contain", "domain"].includes(r.mode)) r.mode = "exact";
      const sourceError = getSourceValidationError(r.source, r.mode);
      if (sourceError) {
        sendResponse({ ok: false, error: sourceError });
        return;
      }
      const destinationError = getDestinationValidationError(r.destination, r.mode);
      if (destinationError) {
        sendResponse({ ok: false, error: destinationError });
        return;
      }
      if (typeof r.enabled !== "boolean") r.enabled = true;
      r.disablePwBotDetection = !!r.disablePwBotDetection;
      r.categoryId = getCategoryId(r.categoryId, categories);

      const rules = current.slice();
      if (r.id) {
        const idx = rules.findIndex(x => x.id === r.id);
        if (idx >= 0) rules[idx] = r;
        else rules.push(r);
      } else {
        r.id = crypto.randomUUID();
        rules.push(r);
      }
      const prev = current.slice();
      try {
        await setState({ [STORAGE_KEYS.RULES]: rules });
        await rebuildDnrRules();
        sendResponse({ ok: true, rule: r });
      } catch (e) {
        await setState({ [STORAGE_KEYS.RULES]: prev });
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
      }
      return;
    }

    if (msg && msg.type === "delete-rule") {
      const state = await getState();
      const rules = state[STORAGE_KEYS.RULES] || [];
      const idMap = state[STORAGE_KEYS.MAP] || {};
      const ruleStatuses = state[STORAGE_KEYS.RULE_STATUSES] || {};
      const idx = rules.findIndex(x => x.id === msg.id);
      if (idx >= 0) {
        const removed = rules.splice(idx, 1)[0];
        // remove from DNR too
        const dnrId = idMap[removed.id];
        if (dnrId) {
          await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [dnrId],
            addRules: []
          });
          delete idMap[removed.id];
        }
        delete ruleStatuses[removed.id];
        await setState({ [STORAGE_KEYS.RULES]: rules, [STORAGE_KEYS.MAP]: idMap, [STORAGE_KEYS.RULE_STATUSES]: ruleStatuses });
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: "Rule not found" });
      return;
    }

    if (msg && msg.type === "save-category") {
      const state = await getState();
      const categories = normalizeCategories(state[STORAGE_KEYS.CATEGORIES]);
      const incoming = msg.category || {};
      const name = normalizeCategoryName(incoming.name);
      if (!name) {
        sendResponse({ ok: false, error: "Category name is required" });
        return;
      }

      let category;
      if (incoming.id) {
        const idx = categories.findIndex(x => x.id === incoming.id);
        if (idx < 0) {
          sendResponse({ ok: false, error: "Category not found" });
          return;
        }
        category = { ...categories[idx], name };
        categories[idx] = category;
      } else {
        category = { id: crypto.randomUUID(), name };
        categories.push(category);
      }

      await setState({ [STORAGE_KEYS.CATEGORIES]: categories });
      sendResponse({ ok: true, category });
      return;
    }

    if (msg && msg.type === "delete-category") {
      const categoryId = typeof msg.categoryId === "string" ? msg.categoryId : "";
      const mode = msg.mode;
      if (!categoryId || !["deleteRules", "moveRulesToUncategorized"].includes(mode)) {
        sendResponse({ ok: false, error: "Invalid category delete request" });
        return;
      }

      const state = await getState();
      const categories = normalizeCategories(state[STORAGE_KEYS.CATEGORIES]);
      if (!categories.some(category => category.id === categoryId)) {
        sendResponse({ ok: false, error: "Category not found" });
        return;
      }

      const idMap = state[STORAGE_KEYS.MAP] || {};
      const ruleStatuses = state[STORAGE_KEYS.RULE_STATUSES] || {};
      let rules = state[STORAGE_KEYS.RULES] || [];
      if (mode === "deleteRules") {
        const removedIds = new Set(rules.filter(rule => rule.categoryId === categoryId).map(rule => rule.id));
        rules = rules.filter(rule => rule.categoryId !== categoryId);
        for (const id of removedIds) {
          delete idMap[id];
          delete ruleStatuses[id];
        }
      } else {
        rules = rules.map(rule => (
          rule.categoryId === categoryId ? { ...rule, categoryId: null } : rule
        ));
      }

      await setState({
        [STORAGE_KEYS.CATEGORIES]: categories.filter(category => category.id !== categoryId),
        [STORAGE_KEYS.RULES]: rules,
        [STORAGE_KEYS.MAP]: idMap,
        [STORAGE_KEYS.RULE_STATUSES]: ruleStatuses
      });
      await rebuildDnrRules();
      sendResponse({ ok: true });
      return;
    }

    if (msg && msg.type === "assign-rule-category") {
      const state = await getState();
      const categories = normalizeCategories(state[STORAGE_KEYS.CATEGORIES]);
      const categoryId = getCategoryId(msg.categoryId, categories);
      const rules = state[STORAGE_KEYS.RULES] || [];
      const idx = rules.findIndex(rule => rule.id === msg.ruleId);
      if (idx < 0) {
        sendResponse({ ok: false, error: "Rule not found" });
        return;
      }

      rules[idx] = { ...rules[idx], categoryId };
      await setState({ [STORAGE_KEYS.RULES]: rules });
      sendResponse({ ok: true });
      return;
    }

    if (msg && msg.type === "reorder-rules") {
      const order = Array.isArray(msg.ids) ? msg.ids : [];
      const state = await getState();
      const current = state[STORAGE_KEYS.RULES] || [];
      const categories = normalizeCategories(state[STORAGE_KEYS.CATEGORIES]);
      if ("categoryId" in msg) {
        const categoryId = getCategoryId(msg.categoryId, categories);
        const subset = current.filter(rule => getCategoryId(rule.categoryId, categories) === categoryId);
        if (order.length !== subset.length || new Set(order).size !== subset.length) {
          sendResponse({ ok: false, error: "Invalid order" });
          return;
        }
        const subsetMap = new Map(subset.map(rule => [rule.id, rule]));
        const reorderedSubset = order.map(id => subsetMap.get(id)).filter(Boolean);
        if (reorderedSubset.length !== subset.length) {
          sendResponse({ ok: false, error: "Invalid order" });
          return;
        }
        let nextIndex = 0;
        const reordered = current.map(rule => {
          if (getCategoryId(rule.categoryId, categories) !== categoryId) return rule;
          const next = reorderedSubset[nextIndex];
          nextIndex += 1;
          return next;
        });
        await setState({ [STORAGE_KEYS.RULES]: reordered });
        await rebuildDnrRules();
        sendResponse({ ok: true });
        return;
      }
      if (order.length !== current.length || new Set(order).size !== current.length) {
        sendResponse({ ok: false, error: "Invalid order" });
        return;
      }
      const map = new Map(current.map(r => [r.id, r]));
      const reordered = order.map(id => map.get(id)).filter(Boolean);
      if (reordered.length !== current.length) {
        sendResponse({ ok: false, error: "Invalid order" });
        return;
      }
      await setState({ [STORAGE_KEYS.RULES]: reordered });
      await rebuildDnrRules();
      sendResponse({ ok: true });
      return;
    }

    if (msg && msg.type === "export-rules") {
      const state = await getState();
      const data = {
        categories: normalizeCategories(state[STORAGE_KEYS.CATEGORIES]),
        rules: (state[STORAGE_KEYS.RULES] || []).map(normalizeRuleForClient)
      };
      sendResponse({ ok: true, data, rules: data.rules });
      return;
    }

    if (msg && msg.type === "import-rules") {
      const payload = msg.rules;
      const incoming = Array.isArray(payload) ? payload : payload && Array.isArray(payload.rules) ? payload.rules : null;
      if (!incoming) {
        sendResponse({ ok: false, error: "Invalid import payload" });
        return;
      }
      const incomingCategories = Array.isArray(payload) ? [] : normalizeCategories(payload.categories);
      const importedCategories = incomingCategories.map(category => ({
        id: crypto.randomUUID(),
        name: category.name
      }));
      const categoryMap = new Map(incomingCategories.map((category, index) => [category.id, importedCategories[index].id]));
      // Normalize & new IDs
      const normalized = [];
      let skipped = 0;
      for (const r of incoming) {
        if (!r || !r.name || !r.source || !r.destination) {
          skipped += 1;
          continue;
        }
        const mode = ["exact", "wildcard", "contain", "domain"].includes(r.mode) ? r.mode : "exact";
        const source = String(r.source).trim();
        const destination = String(r.destination).trim();
        if (getSourceValidationError(source, mode) || getDestinationValidationError(destination, mode)) {
          skipped += 1;
          continue;
        }
        normalized.push({
          id: crypto.randomUUID(),
          name: String(r.name).slice(0, 80),
          source,
          destination,
          mode,
          enabled: typeof r.enabled === "boolean" ? r.enabled : true,
          disablePwBotDetection: !!r.disablePwBotDetection,
          categoryId: categoryMap.get(r.categoryId) || null
        });
      }
      const state = await getState();
      const rules = state[STORAGE_KEYS.RULES] || [];
      const categories = normalizeCategories(state[STORAGE_KEYS.CATEGORIES]).concat(importedCategories);
      await setState({
        [STORAGE_KEYS.RULES]: rules.concat(normalized),
        [STORAGE_KEYS.CATEGORIES]: categories
      });
      await rebuildDnrRules();
      sendResponse({ ok: true, count: normalized.length, skipped });
      return;
    }

    if (msg && msg.type === "clear-logs") {
      await setState({ [STORAGE_KEYS.LOGS]: [] });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message" });
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  })();
  return true; // keep channel open for async sendResponse
});

async function initializeExtension() {
  await rebuildDnrRules();
  await updateAllActionStates();
}

// On install / startup ensure rules are rebuilt
chrome.runtime.onInstalled.addListener(() => initializeExtension());
chrome.runtime.onStartup.addListener(() => initializeExtension());
updateAllActionStates().catch(() => {});
