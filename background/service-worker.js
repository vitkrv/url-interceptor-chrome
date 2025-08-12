
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
 *   enabled: boolean
 * }
 *
 * We maintain a mapping between our rule.id and a numeric DNR ruleId.
 */

const STORAGE_KEYS = {
  RULES: "rules",
  GLOBAL_ENABLED: "globalEnabled",
  LOGS: "logs",
  NEXT_DNR_ID: "nextDnrId",
  MAP: "idMap" // map our rule.id -> DNR numeric id
};

const LOG_LIMIT = 1000; // keep last N logs

async function getState() {
  const data = await chrome.storage.local.get({
    [STORAGE_KEYS.RULES]: [],
    [STORAGE_KEYS.GLOBAL_ENABLED]: true,
    [STORAGE_KEYS.LOGS]: [],
    [STORAGE_KEYS.NEXT_DNR_ID]: 1000,
    [STORAGE_KEYS.MAP]: {}
  });
  return data;
}

async function setState(patch) {
  return chrome.storage.local.set(patch);
}

// Escape for exact-match regex
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build a DNR rule (or return null if unsupported/invalid)
async function toDnrRule(rule, dnrId) {
  const action = {
    type: "redirect",
    redirect: {}
  };

  const condition = {
    resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "script"]
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
    if (!ok || ok.isSupported === false) return null;
  } else if (rule.mode === "wildcard") {
    // Convert wildcard pattern where "*" matches any characters
    const expr = "^" + rule.source.split("*").map(escapeRegex).join(".*") + "$";
    const support = await chrome.declarativeNetRequest
      .isRegexSupported({ regex: expr })
      .catch(() => ({ isSupported: false }));
    if (!support || support.isSupported === false) {
      return null;
    }
    condition.regexFilter = expr;
    action.redirect = { url: rule.destination };
  } else {
    return null;
  }

  return {
    id: dnrId,
    priority: 1,
    action,
    condition
  };
}

async function rebuildDnrRules() {
  const state = await getState();
  const { RULES, GLOBAL_ENABLED, MAP } = STORAGE_KEYS;
  const rules = state[RULES] || [];
  const globalEnabled = state[GLOBAL_ENABLED] !== false;
  const idMap = state[MAP] || {};

  // First, clear all dynamic rules if global disabled
  if (!globalEnabled) {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    if (existing.length) {
      const removeIds = existing.map(r => r.id);
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules: [] });
    }
    return;
  }

  // Build new set
  const add = [];
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existing.map(r => r.id);

  for (const r of rules) {
    if (!r.enabled) continue;

    let dnrId = idMap[r.id];
    if (!dnrId) {
      // allocate new id
      const next = state[STORAGE_KEYS.NEXT_DNR_ID] || 1000;
      dnrId = next;
      idMap[r.id] = dnrId;
      state[STORAGE_KEYS.NEXT_DNR_ID] = dnrId + 1;
    }

    const dnrRule = await toDnrRule(r, dnrId);
    if (dnrRule) {
      add.push(dnrRule);
    } else {
      // rule invalid; drop its mapping so ids can be reused
      delete idMap[r.id];
    }
  }

  // Commit storage changes (idMap / next id) before updating rules
  await setState({
    [STORAGE_KEYS.MAP]: idMap,
    [STORAGE_KEYS.NEXT_DNR_ID]: state[STORAGE_KEYS.NEXT_DNR_ID]
  });

  // Replace existing dynamic rules entirely to avoid duplicate IDs
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: removeIds,
    addRules: add
  });
}

// Listen to rule matches for logging
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
  try {
    const state = await getState();
    const globalEnabled = state[STORAGE_KEYS.GLOBAL_ENABLED] !== false;
    if (!globalEnabled) return;

    const rules = state[STORAGE_KEYS.RULES] || [];
    const idMap = state[STORAGE_KEYS.MAP] || {};
    const logs = state[STORAGE_KEYS.LOGS] || [];

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
    const pageUrl = info.request.url;

    logs.push({ time: ts, info: `on page [${pageUrl}] rule [${matchedRule.name}] applied` });
    while (logs.length > LOG_LIMIT) logs.shift();

    await setState({ [STORAGE_KEYS.LOGS]: logs });
    // notify UI
    await chrome.runtime.sendMessage({ type: "logs-updated" }).catch(() => {});
  } catch (e) {
    // swallow
  }
});

// Messages from options UI
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg && msg.type === "get-state") {
      const state = await getState();
      sendResponse({
        rules: state[STORAGE_KEYS.RULES] || [],
        globalEnabled: state[STORAGE_KEYS.GLOBAL_ENABLED] !== false,
        logs: state[STORAGE_KEYS.LOGS] || []
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
      const rules = state[STORAGE_KEYS.RULES] || [];
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
      if (typeof r.enabled !== "boolean") r.enabled = true;

      if (r.id) {
        const idx = rules.findIndex(x => x.id === r.id);
        if (idx >= 0) rules[idx] = r;
        else rules.push(r);
      } else {
        r.id = crypto.randomUUID();
        rules.push(r);
      }
      await setState({ [STORAGE_KEYS.RULES]: rules });
      await rebuildDnrRules();
      sendResponse({ ok: true, rule: r });
      return;
    }

    if (msg && msg.type === "delete-rule") {
      const state = await getState();
      const rules = state[STORAGE_KEYS.RULES] || [];
      const idMap = state[STORAGE_KEYS.MAP] || {};
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
        await setState({ [STORAGE_KEYS.RULES]: rules, [STORAGE_KEYS.MAP]: idMap });
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: "Rule not found" });
      return;
    }

    if (msg && msg.type === "export-rules") {
      const state = await getState();
      sendResponse({ ok: true, rules: state[STORAGE_KEYS.RULES] || [] });
      return;
    }

    if (msg && msg.type === "import-rules") {
      const incoming = msg.rules;
      if (!Array.isArray(incoming)) {
        sendResponse({ ok: false, error: "Invalid import payload" });
        return;
      }
      // Normalize & new IDs
      const normalized = [];
      for (const r of incoming) {
        if (!r || !r.name || !r.source || !r.destination) continue;
        normalized.push({
          id: crypto.randomUUID(),
          name: String(r.name).slice(0, 80),
          source: String(r.source),
          destination: String(r.destination),
          mode: ["exact", "wildcard", "contain"].includes(r.mode) ? r.mode : "exact",
          enabled: typeof r.enabled === "boolean" ? r.enabled : true
        });
      }
      const state = await getState();
      const rules = state[STORAGE_KEYS.RULES] || [];
      await setState({ [STORAGE_KEYS.RULES]: rules.concat(normalized) });
      await rebuildDnrRules();
      sendResponse({ ok: true, count: normalized.length });
      return;
    }

    if (msg && msg.type === "clear-logs") {
      await setState({ [STORAGE_KEYS.LOGS]: [] });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message" });
  })();
  return true; // keep channel open for async sendResponse
});

// On install / startup ensure rules are rebuilt
chrome.runtime.onInstalled.addListener(() => rebuildDnrRules());
chrome.runtime.onStartup.addListener(() => rebuildDnrRules());
