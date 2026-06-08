
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
 *   mode: "exact" | "wildcard" | "contain",
 *   source: string,
 *   destination: string,
 *   enabled: boolean,
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
  RULE_STATUSES: "ruleStatuses"
};

const LOG_LIMIT = 1000; // keep last N logs
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

let logWriteQueue = Promise.resolve();

async function getState() {
  const data = await chrome.storage.local.get({
    [STORAGE_KEYS.RULES]: [],
    [STORAGE_KEYS.CATEGORIES]: [],
    [STORAGE_KEYS.GLOBAL_ENABLED]: true,
    [STORAGE_KEYS.LOGS]: [],
    [STORAGE_KEYS.NEXT_DNR_ID]: 1000,
    [STORAGE_KEYS.MAP]: {},
    [STORAGE_KEYS.RULE_STATUSES]: {}
  });
  return data;
}

async function setState(patch) {
  return chrome.storage.local.set(patch);
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

  return "Unsupported rule mode";
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

// Build a DNR rule and an install status.
async function toDnrRule(rule, dnrId) {
  const sourceError = getSourceValidationError(rule.source, rule.mode);
  if (sourceError) {
    return { dnrRule: null, status: makeRuleStatus(false, sourceError) };
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

async function rebuildDnrRules() {
  const state = await getState();
  const { RULES, GLOBAL_ENABLED, MAP } = STORAGE_KEYS;
  const rules = state[RULES] || [];
  const globalEnabled = state[GLOBAL_ENABLED] !== false;
  const idMap = state[MAP] || {};
  const statuses = {};

  // First, clear all dynamic rules if global disabled
  if (!globalEnabled) {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    if (existing.length) {
      const removeIds = existing.map(r => r.id);
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules: [] });
    }
    for (const r of rules) {
      statuses[r.id] = makeRuleStatus(true, r.enabled ? "Global disabled" : "Disabled");
    }
    await setState({ [STORAGE_KEYS.RULE_STATUSES]: statuses });
    return;
  }

  // Build new set
  const add = [];
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existing.map(r => r.id);

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
    let matchedRule = null;
    for (const [rid, dnrId] of Object.entries(idMap)) {
      if (dnrId === matchedId) {
        matchedRule = (rules.find(r => r.id === rid) || null);
        break;
      }
    }
    if (!matchedRule || !matchedRule.enabled) return;

    const ts = new Date().toISOString();
    const pageUrl = redactUrlForLog(info.request.url);

    await appendLog({ time: ts, info: `on page [${pageUrl}] rule [${matchedRule.name}] applied` });
    // notify UI
    await chrome.runtime.sendMessage({ type: "logs-updated" }).catch(() => {});
  } catch (e) {
    // swallow
  }
});
}

// Messages from options UI
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg && msg.type === "get-state") {
      let state = await getState();
      const rules = state[STORAGE_KEYS.RULES] || [];
      const ruleStatuses = state[STORAGE_KEYS.RULE_STATUSES] || {};
      if (rules.length && Object.keys(ruleStatuses).length === 0) {
        await rebuildDnrRules();
        state = await getState();
      }
      sendResponse({
        rules: state[STORAGE_KEYS.RULES] || [],
        categories: normalizeCategories(state[STORAGE_KEYS.CATEGORIES]),
        globalEnabled: state[STORAGE_KEYS.GLOBAL_ENABLED] !== false,
        logs: state[STORAGE_KEYS.LOGS] || [],
        ruleStatuses: state[STORAGE_KEYS.RULE_STATUSES] || {}
      });
      return;
    }

    if (msg && msg.type === "set-global") {
      await setState({ [STORAGE_KEYS.GLOBAL_ENABLED]: !!msg.enabled });
      await rebuildDnrRules();
      sendResponse({ ok: true });
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
      if (!["exact", "wildcard", "contain"].includes(r.mode)) r.mode = "exact";
      const sourceError = getSourceValidationError(r.source, r.mode);
      if (sourceError) {
        sendResponse({ ok: false, error: sourceError });
        return;
      }
      if (!isValidHttpUrl(r.destination)) {
        sendResponse({ ok: false, error: "Destination must be a valid URL" });
        return;
      }
      if (typeof r.enabled !== "boolean") r.enabled = true;
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
        rules: state[STORAGE_KEYS.RULES] || []
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
        const mode = ["exact", "wildcard", "contain"].includes(r.mode) ? r.mode : "exact";
        const source = String(r.source).trim();
        const destination = String(r.destination).trim();
        if (getSourceValidationError(source, mode) || !isValidHttpUrl(destination)) {
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

// On install / startup ensure rules are rebuilt
chrome.runtime.onInstalled.addListener(() => rebuildDnrRules());
chrome.runtime.onStartup.addListener(() => rebuildDnrRules());
