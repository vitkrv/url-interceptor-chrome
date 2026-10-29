// options.js
const UNCATEGORIZED_ID = '';
const ALL_RULES_ID = '__all__';

const els = {
  rulesList: document.getElementById('rulesList'),
  categoriesList: document.getElementById('categoriesList'),
  btnNew: document.getElementById('btnNew'),
  btnQuickImport: document.getElementById('btnQuickImport'),
  btnNewCategory: document.getElementById('btnNewCategory'),
  btnExport: document.getElementById('btnExport'),
  fileImport: document.getElementById('fileImport'),
  btnLogs: document.getElementById('btnLogs'),
  logsModal: document.getElementById('logsModal'),
  logsBody: document.getElementById('logsBody'),
  logsCount: document.getElementById('logsCount'),
  logsSearch: document.getElementById('logsSearch'),
  logsTypeFilter: document.getElementById('logsTypeFilter'),
  logsStatus: document.getElementById('logsStatus'),
  btnCloseLogs: document.getElementById('btnCloseLogs'),
  btnToggleLogsPause: document.getElementById('btnToggleLogsPause'),
  btnCopyLogs: document.getElementById('btnCopyLogs'),
  btnClearLogs: document.getElementById('btnClearLogs'),
  pwBotDetectionToggle: document.getElementById('pwBotDetectionToggle'),
  cspBypassToggle: document.getElementById('cspBypassToggle'),
  userAgentToggle: document.getElementById('userAgentToggle'),
  userAgentForm: document.getElementById('userAgentForm'),
  userAgentMode: document.getElementById('userAgentMode'),
  userAgentValue: document.getElementById('userAgentValue'),
  userAgentError: document.getElementById('userAgentError'),
  btnCancelUserAgent: document.getElementById('btnCancelUserAgent'),
  globalToggle: document.getElementById('globalToggle'),
  ruleModal: document.getElementById('ruleModal'),
  ruleForm: document.getElementById('ruleForm'),
  ruleModalTitle: document.getElementById('ruleModalTitle'),
  name: document.getElementById('name'),
  mode: document.getElementById('mode'),
  category: document.getElementById('category'),
  source: document.getElementById('source'),
  destination: document.getElementById('destination'),
  nameError: document.getElementById('nameError'),
  sourceError: document.getElementById('sourceError'),
  destinationError: document.getElementById('destinationError'),
  ruleId: document.getElementById('ruleId'),
  btnCancelRule: document.getElementById('btnCancelRule'),
  btnSaveRule: document.getElementById('btnSaveRule'),
  ruleNotification: document.getElementById('ruleNotification'),
  quickShareModal: document.getElementById('quickShareModal'),
  quickShareValue: document.getElementById('quickShareValue'),
  quickShareStatus: document.getElementById('quickShareStatus'),
  btnCloseQuickShare: document.getElementById('btnCloseQuickShare'),
  btnCopyQuickShare: document.getElementById('btnCopyQuickShare'),
  quickImportModal: document.getElementById('quickImportModal'),
  quickImportForm: document.getElementById('quickImportForm'),
  quickImportValue: document.getElementById('quickImportValue'),
  quickImportError: document.getElementById('quickImportError'),
  btnCancelQuickImport: document.getElementById('btnCancelQuickImport'),
  categoryModal: document.getElementById('categoryModal'),
  categoryForm: document.getElementById('categoryForm'),
  categoryModalTitle: document.getElementById('categoryModalTitle'),
  categoryName: document.getElementById('categoryName'),
  categoryNameError: document.getElementById('categoryNameError'),
  categoryId: document.getElementById('categoryId'),
  btnDeleteCategory: document.getElementById('btnDeleteCategory'),
  btnCancelCategory: document.getElementById('btnCancelCategory'),
  categoryDeleteChoiceModal: document.getElementById('categoryDeleteChoiceModal'),
  categoryDeleteChoiceText: document.getElementById('categoryDeleteChoiceText'),
  btnCancelCategoryDeleteChoice: document.getElementById('btnCancelCategoryDeleteChoice'),
  btnMoveRulesToUncategorized: document.getElementById('btnMoveRulesToUncategorized'),
  btnDeleteCategoryRules: document.getElementById('btnDeleteCategoryRules'),
  confirmModal: document.getElementById('confirmModal'),
  confirmText: document.getElementById('confirmText'),
  btnNo: document.getElementById('btnNo'),
  btnYes: document.getElementById('btnYes')
};

let rules = [];
let categories = [];
let logs = [];
let logsPaused = false;
let ruleStatuses = {};
let globalEnabled = true;
let pwBotDetectionEnabled = false;
let userAgentOverride = {
  enabled: false,
  mode: 'attach',
  value: 'Playwire/2.0'
};
let currentRuleEnabled = true;
let ruleSaving = false;
let selectedCategoryId = ALL_RULES_ID;
let pendingConfirm = null;
let pendingCategoryDelete = null;
let draggedRuleId = null;
let categoryDropHandled = false;

function clearRuleErrors() {
  els.nameError.textContent = '';
  els.sourceError.textContent = '';
  els.destinationError.textContent = '';
  els.ruleNotification.textContent = '';
  els.ruleNotification.hidden = true;
}

function notifyRuleError(message) {
  els.ruleNotification.textContent = message;
  els.ruleNotification.hidden = false;
}

function setRuleSaving(saving) {
  ruleSaving = saving;
  els.btnSaveRule.textContent = saving ? 'Saving…' : 'Save';
  els.ruleForm.setAttribute('aria-busy', String(saving));
  ['btnSaveRule', 'btnCancelRule', 'name', 'mode', 'category', 'source', 'destination'].forEach(id => {
    els[id].disabled = saving;
  });
}

function clearCategoryErrors() {
  els.categoryNameError.textContent = '';
}

function clearUserAgentErrors() {
  els.userAgentError.textContent = '';
}

['name', 'source', 'destination'].forEach((id) => {
  els[id].addEventListener('input', () => {
    els[id + 'Error'].textContent = '';
  });
});

els.categoryName.addEventListener('input', clearCategoryErrors);
els.userAgentValue.addEventListener('input', clearUserAgentErrors);
els.userAgentMode.addEventListener('change', clearUserAgentErrors);
els.quickImportValue.addEventListener('input', () => {
  els.quickImportError.textContent = '';
});

els.mode.addEventListener('change', () => {
  els.sourceError.textContent = '';
  updateSourcePlaceholder();
});

function isValidHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidDomain(str) {
  const value = String(str || '').trim().toLowerCase();
  if (!value || value.length > 253 || /[:/?#@\s]/.test(value)) return false;
  return value
    .split('.')
    .every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function getSourceValidationError(source, mode) {
  const value = String(source || '').trim();
  if (!value) return 'Source is required';

  if (mode === 'exact') {
    return isValidHttpUrl(value) ? '' : 'Exact source must be a valid http(s) URL';
  }

  if (mode === 'wildcard') {
    if (!/^https?:\/\//i.test(value)) return 'Wildcard source must start with http:// or https://';
    if (/\s/.test(value)) return 'Wildcard source cannot contain whitespace';
    return '';
  }

  if (mode === 'contain') {
    if (/\s/.test(value)) return 'Contain source cannot contain whitespace';
    return '';
  }

  if (mode === 'domain') {
    return isValidDomain(value) ? '' : 'Domain source must be a bare domain, for example cdn.intergient.com';
  }

  return 'Unsupported rule mode';
}

function getDestinationValidationError(destination, mode) {
  const value = String(destination || '').trim();
  if (!value) return 'Destination is required';
  if (mode === 'domain') {
    return isValidDomain(value) ? '' : 'Domain destination must be a bare domain, for example cdn.intergientdev.com';
  }
  return isValidHttpUrl(value) ? '' : 'Destination must be a valid http(s) URL';
}

const QUICK_SHARE_PREFIX = 'ur1.';
const QUICK_SHARE_MODE_CODES = {
  exact: 'e',
  wildcard: 'w',
  contain: 'c',
  domain: 'd'
};
const QUICK_SHARE_MODES = Object.fromEntries(
  Object.entries(QUICK_SHARE_MODE_CODES).map(([mode, code]) => [code, mode])
);

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
}

function encodeQuickShareRule(rule) {
  const data = [
    QUICK_SHARE_MODE_CODES[rule.mode] || QUICK_SHARE_MODE_CODES.exact,
    rule.name,
    rule.source,
    rule.destination
  ];
  return QUICK_SHARE_PREFIX + toBase64Url(JSON.stringify(data));
}

function decodeQuickShareRule(text) {
  const value = String(text || '').trim();
  if (!value.startsWith(QUICK_SHARE_PREFIX)) throw new Error('Quick share string must start with ur1.');

  let data;
  try {
    data = JSON.parse(fromBase64Url(value.slice(QUICK_SHARE_PREFIX.length)));
  } catch {
    throw new Error('Quick share string is invalid.');
  }

  if (!Array.isArray(data) || data.length < 4 || data.length > 5) {
    throw new Error('Quick share string has an unsupported format.');
  }
  if (data.slice(0, 4).some(part => typeof part !== 'string') || (data.length === 5 && data[4] !== 1)) {
    throw new Error('Quick share string has an unsupported format.');
  }

  const mode = QUICK_SHARE_MODES[data[0]];
  const rule = {
    name: String(data[1] || '').trim(),
    mode,
    source: String(data[2] || '').trim(),
    destination: String(data[3] || '').trim(),
    enabled: true,
    categoryId: null
  };

  if (!mode) throw new Error('Quick share rule mode is unsupported.');
  if (!rule.name) throw new Error('Name is required.');
  if (rule.name.length > 80) throw new Error('Name exceeds 80 characters.');
  const sourceError = getSourceValidationError(rule.source, rule.mode);
  if (sourceError) throw new Error(sourceError);
  const destinationError = getDestinationValidationError(rule.destination, rule.mode);
  if (destinationError) throw new Error(destinationError);
  return rule;
}

function normalizeUserAgentOverride(config) {
  const source = config && typeof config === 'object' ? config : {};
  const value = typeof source.value === 'string' && source.value.trim()
    ? source.value.trim()
    : 'Playwire/2.0';
  return {
    enabled: !!source.enabled,
    mode: source.mode === 'replace' ? 'replace' : 'attach',
    value
  };
}

function getUserAgentValidationError(value) {
  const text = String(value || '').trim();
  if (!text) return 'User Agent value is required';
  if (!/^[\x20-\x7E]+$/.test(text)) {
    return 'User Agent value must use printable ASCII characters only';
  }
  return '';
}

function updateSourcePlaceholder() {
  if (els.mode.value === 'wildcard') {
    els.source.placeholder = 'e.g., https://*.example.com/*';
  } else if (els.mode.value === 'contain') {
    els.source.placeholder = 'e.g., example.com/path';
  } else if (els.mode.value === 'domain') {
    els.source.placeholder = 'e.g., cdn.intergient.com';
  } else {
    els.source.placeholder = 'e.g., https://example.com/a';
  }
  els.destination.placeholder = els.mode.value === 'domain'
    ? 'e.g., cdn.intergientdev.com'
    : 'e.g., https://target.com/b';
}

function sendMessage(payload, rejectOnError = false) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (resp) => {
      // Access runtime.lastError to avoid "Unchecked runtime.lastError" warnings.
      const error = chrome.runtime.lastError;
      if (error) {
        if (rejectOnError) reject(new Error(error.message));
        else resolve(undefined);
        return;
      }
      resolve(resp);
    });
  });
}

function getCategoryById(categoryId) {
  return categories.find(category => category.id === categoryId) || null;
}

function getRuleCategoryId(rule) {
  const id = typeof rule.categoryId === 'string' ? rule.categoryId : UNCATEGORIZED_ID;
  return getCategoryById(id) ? id : UNCATEGORIZED_ID;
}

function getSelectedCategoryName() {
  const category = getCategoryById(selectedCategoryId);
  return selectedCategoryId === ALL_RULES_ID ? 'All rules' : category ? category.name : 'Uncategorized';
}

function getVisibleRules() {
  const matchesSearch = TextSearch.createMatcher(document.getElementById('ruleSearch').value);
  const enabled = document.getElementById('enabledFilter').value;
  const mode = document.getElementById('modeFilter').value;
  return rules.filter(rule => (selectedCategoryId === ALL_RULES_ID || getRuleCategoryId(rule) === selectedCategoryId)
    && (enabled === 'all' || !!rule.enabled === (enabled === 'enabled'))
    && (mode === 'all' || rule.mode === mode)
    && matchesSearch([rule.name, rule.source, rule.destination, getCategoryById(rule.categoryId)?.name || 'Uncategorized']));
}

async function refresh(requireResponse = false) {
  const response = await sendMessage({ type: 'get-state' }, requireResponse);
  if (requireResponse && (!response || response.ok === false)) {
    throw new Error(response && response.error || 'No response from the extension. Reload the extension and try again.');
  }
  if (!response || response.ok === false) {
    const error = new Error(response?.error || 'Cannot connect to the extension. Reload it and try again.');
    if (typeof showLoadError === 'function') showLoadError(error.message);
    return;
  }
  if (typeof clearLoadError === 'function') clearLoadError();
  const state = response;
  rules = state.rules || [];
  categories = state.categories || [];
  if (!logsPaused) logs = (state.logs || []).slice(-1000);
  ruleStatuses = state.ruleStatuses || {};
  globalEnabled = !!state.globalEnabled;
  pwBotDetectionEnabled = !!state.pwBotDetectionEnabled;
  userAgentOverride = normalizeUserAgentOverride(state.userAgentOverride);
  if (selectedCategoryId !== ALL_RULES_ID && selectedCategoryId && !getCategoryById(selectedCategoryId)) {
    selectedCategoryId = UNCATEGORIZED_ID;
  }
  els.globalToggle.checked = globalEnabled;
  els.pwBotDetectionToggle.checked = pwBotDetectionEnabled;
  els.cspBypassToggle.checked = !!state.cspBypassEnabled;
  els.userAgentToggle.checked = userAgentOverride.enabled;
  renderCategoryOptions();
  renderCategories();
  renderRules();
  if (typeof updateShell === "function") updateShell();
}

function createBadge(text, className = '') {
  const badge = document.createElement('span');
  badge.className = `badge ${className}`.trim();
  badge.textContent = text;
  return badge;
}

function ruleBadge(mode) {
  if (mode === 'domain') return createBadge('Domain', 'green');
  if (mode === 'wildcard') return createBadge('Wildcard', 'cyan');
  if (mode === 'contain') return createBadge('Contain', 'orange');
  return createBadge('Exact', 'purple');
}

function getRuleStatus(rule) {
  if (!rule.enabled) return { ok: true, message: 'Disabled' };
  if (!globalEnabled) return { ok: true, message: 'Redirects paused' };
  return ruleStatuses[rule.id] || { ok: false, message: 'Pending' };
}

function statusBadge(rule) {
  const status = getRuleStatus(rule);
  if (status.message === 'Disabled') return createBadge(status.message, 'gray');
  if (status.message === 'Global disabled' || status.message === 'Redirects paused' || status.message === 'Pending') return createBadge(status.message, 'gray');
  const className = status.ok ? 'ok' : 'error';
  return createBadge(status.message, className);
}

function getCategoryCounts(categoryId) {
  const assigned = rules.filter(rule => categoryId === ALL_RULES_ID || getRuleCategoryId(rule) === categoryId);
  return {
    total: assigned.length,
    enabled: assigned.filter(rule => !!rule.enabled).length
  };
}

function renderCategoryOptions(selectedValue = els.category.value) {
  els.category.innerHTML = '';
  const uncategorized = document.createElement('option');
  uncategorized.value = UNCATEGORIZED_ID;
  uncategorized.textContent = 'Uncategorized';
  els.category.appendChild(uncategorized);

  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    els.category.appendChild(option);
  }

  els.category.value = getCategoryById(selectedValue) ? selectedValue : UNCATEGORIZED_ID;
}

function renderCategories() {
  els.categoriesList.innerHTML = '';
  const categoryItems = [{ id: ALL_RULES_ID, name: 'All rules', virtual: true }, { id: UNCATEGORIZED_ID, name: 'Uncategorized', virtual: true }].concat(categories);

  for (const category of categoryItems) {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.dataset.categoryId = category.id;
    if (category.id === selectedCategoryId) row.classList.add('selected');
    const counts = getCategoryCounts(category.id);
    if (counts.enabled > 0) row.classList.add('has-enabled');

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'category-main';
    main.setAttribute('aria-pressed',String(category.id === selectedCategoryId));
    main.addEventListener('click', () => {
      selectedCategoryId = category.id;
      renderCategories();
      renderRules();
      updateShell();
    });

    const name = document.createElement('span');
    name.className = 'category-name';
    name.textContent = category.name;
    const count = document.createElement('span');
    count.className = 'category-count';
    count.textContent = String(counts.total);
    const enabled = document.createElement('span');
    enabled.className = 'category-enabled';
    enabled.textContent = `${counts.enabled} enabled`;

    main.appendChild(name);
    main.appendChild(count);
    main.appendChild(enabled);
    row.appendChild(main);

    row.addEventListener('dragover', (e) => {
      if (!draggedRuleId || category.id === ALL_RULES_ID) return;
      e.preventDefault();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drop-target');
    });
    row.addEventListener('drop', async (e) => {
      if (!draggedRuleId || category.id === ALL_RULES_ID) return;
      e.preventDefault();
      row.classList.remove('drop-target');
      categoryDropHandled = true;
      const resp = await sendMessage({
        type: 'assign-rule-category',
        ruleId: draggedRuleId,
        categoryId: category.id || null
      });
      if (!resp || !resp.ok) {
        notify('Failed to assign category: ' + (resp && resp.error || 'unknown'));
      }
      await refresh();
    });

    els.categoriesList.appendChild(row);
  }
}

function getDragAfterElement(container, y) {
  const items = [...container.querySelectorAll('.item:not(.dragging)')];
  return items.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY }
  ).element;
}

els.rulesList.addEventListener('dragover', (e) => {
  if (!canReorder()) return;
  e.preventDefault();
  const dragging = document.querySelector('.item.dragging');
  if (!dragging) return;
  document.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before','drop-after'));
  const after = getDragAfterElement(els.rulesList, e.clientY);
  if (after) { after.classList.add('drop-before'); els.rulesList.insertBefore(dragging, after); }
  else { els.rulesList.appendChild(dragging); dragging.classList.add('drop-after'); }
});
els.rulesList.addEventListener('drop', async e => {
  if (!draggedRuleId || !canReorder()) return;
  e.preventDefault();
  categoryDropHandled = true;
  await persistOrder([...els.rulesList.querySelectorAll('.item')].map(el => el.dataset.id), draggedRuleId);
});

function renderRules() {
  els.rulesList.innerHTML = '';
  const visibleRules = getVisibleRules();
  document.getElementById('rulesTitle').textContent = getSelectedCategoryName();
  document.getElementById('categoryTitleActions').hidden = !getCategoryById(selectedCategoryId);
  const total = rules.filter(r => selectedCategoryId === ALL_RULES_ID || getRuleCategoryId(r) === selectedCategoryId).length;
  document.getElementById('rulesCount').textContent = 'Showing ' + visibleRules.length + ' of ' + total + ' rules';
  document.getElementById('orderHint').hidden = canReorder();
  if (!visibleRules.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = rules.length
      ? (!canReorder() ? "No rules match these filters." : `No rules in ${getSelectedCategoryName()}.`)
      : 'No rules yet. Click "Create Rule" to add one.';
    const actions = document.createElement('div'); actions.className = 'row';
    const create = document.createElement('button'); create.className = 'btn'; create.textContent = rules.length && !canReorder() ? 'Clear filters' : 'Create rule'; create.onclick = () => !canReorder() ? clearFilters() : openRuleModal(null); actions.appendChild(create);
    if (!rules.length) { const imp = document.createElement('button'); imp.className = 'btn outlined'; imp.textContent = 'Paste shared rule'; imp.onclick = openQuickImportModal; actions.appendChild(imp); }
    empty.appendChild(actions);
    els.rulesList.appendChild(empty);
    return;
  }

  for (const r of visibleRules) {
    const item = document.createElement('div');
    item.className = 'item';
    item.dataset.id = r.id;
    if (!r.enabled) item.classList.add('disabled');

    const handle = document.createElement('span');
    handle.className = 'drag-handle'; handle.innerHTML = uiIcon('grip');
    handle.draggable = true; handle.title = canReorder() ? 'Drag to reorder or assign a category' : 'Drag to assign a category; clear filters to reorder';
    handle.addEventListener('dragstart', e => { draggedRuleId = r.id; categoryDropHandled = false; e.dataTransfer.setData('text/plain',r.id); item.classList.add('dragging'); });
    handle.addEventListener('dragend', () => { draggedRuleId = null; renderRules(); });
    const top = document.createElement('div');
    top.className = 'item-row';

    const left = document.createElement('div');
    left.className = 'row rule-main';
    left.appendChild(handle);

    const info = document.createElement('div');
    info.className = 'rule-info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = r.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.appendChild(ruleBadge(r.mode));
    meta.appendChild(createBadge(getCategoryById(r.categoryId)?.name || 'Uncategorized'));
    meta.appendChild(statusBadge(r));
    info.appendChild(name);
    info.appendChild(meta);
    left.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'row item-actions';

    const toggle = document.createElement('label');
    toggle.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!r.enabled;
    input.setAttribute('aria-label', 'Enable rule ' + r.name);
    input.addEventListener('change', async () => {
      input.disabled = true;
      try { await checkedMessage({ type: 'save-rule', rule: {...r, enabled: input.checked} }); await refresh(true); } catch (e) { input.checked = r.enabled; notify(e.message); } finally { input.disabled = false; }
    });
    const slider = document.createElement('span');
    slider.className = 'slider';
    toggle.appendChild(input);
    toggle.appendChild(slider);

    const btnEdit = document.createElement('button');
    btnEdit.className = 'btn outlined';
    btnEdit.textContent = 'Edit';
    btnEdit.addEventListener('click', () => openRuleModal(r));

    const btnDup = document.createElement('button');
    btnDup.className = 'btn outlined';
    btnDup.textContent = 'Duplicate';
    btnDup.addEventListener('click', () => openRuleModal(r, true));

    const btnShare = document.createElement('button');
    btnShare.className = 'btn outlined icon-btn share-rule';
    btnShare.type = 'button';
    btnShare.title = 'Share';
    btnShare.setAttribute('aria-label', 'Share rule ' + r.name);
    btnShare.innerHTML = uiIcon('share');
    btnShare.addEventListener('click', () => openQuickShareModal(r));

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn danger icon-btn delete-rule';
    btnDelete.type = 'button';
    btnDelete.title = 'Delete';
    btnDelete.setAttribute('aria-label', 'Delete');
    btnDelete.textContent = 'Delete';
    btnDelete.addEventListener('click', () => confirmDeleteRule(r));

    actions.appendChild(toggle); actions.appendChild(btnShare); actions.appendChild(btnEdit);
    const menu = document.createElement('details'); menu.className = 'menu';
    const summary = document.createElement('summary'); summary.className = 'btn outlined icon-btn'; summary.innerHTML = uiIcon('more'); summary.setAttribute('aria-label', 'Actions for ' + r.name);
    const panel = document.createElement('div'); panel.className = 'menu-panel';
    panel.appendChild(btnDup);
    ['up','down'].forEach(direction => { const button = document.createElement('button'); button.textContent = 'Move ' + direction; const index = visibleRules.indexOf(r); button.disabled = !canReorder() || (direction === 'up' ? index === 0 : index === visibleRules.length - 1); button.onclick = () => moveRule(r.id,direction); panel.appendChild(button); });
    panel.appendChild(btnDelete); menu.append(summary,panel); actions.appendChild(menu);
    top.appendChild(left);
    top.appendChild(actions);

    const urls = document.createElement('div');
    urls.className = 'item-row urls';
    const source = document.createElement('span');
    source.className = 'source';
    source.textContent = r.source;
    const from = document.createElement('span'); from.className = 'url-label'; from.textContent = 'From'; source.prepend(from);
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '->';
    const dest = document.createElement('span');
    dest.className = 'dest';
    dest.textContent = r.destination;
    const to = document.createElement('span'); to.className = 'url-label'; to.textContent = 'To'; dest.prepend(to);
    urls.appendChild(source);

    urls.appendChild(dest);

    item.appendChild(top);
    item.appendChild(urls);
    els.rulesList.appendChild(item);
  }
}

function openRuleModal(existing, duplicate = false) {
  clearRuleErrors();
  if (existing) {
    els.ruleModalTitle.textContent = duplicate ? 'Create Rule' : 'Edit Rule';
    els.name.value = existing.name;
    els.mode.value = existing.mode;
    els.source.value = existing.source;
    els.destination.value = existing.destination;
    els.ruleId.value = duplicate ? '' : existing.id;
    currentRuleEnabled = existing.enabled;
    renderCategoryOptions(getRuleCategoryId(existing));
  } else {
    els.ruleModalTitle.textContent = 'Create Rule';
    els.name.value = '';
    els.mode.value = 'exact';
    els.source.value = '';
    els.destination.value = '';
    els.ruleId.value = '';
    currentRuleEnabled = true;
    renderCategoryOptions(selectedCategoryId === ALL_RULES_ID ? UNCATEGORIZED_ID : selectedCategoryId);
  }
  updateSourcePlaceholder();
  els.ruleModal.showModal();
}

function openCategoryModal(category = null) {
  clearCategoryErrors();
  if (category) {
    els.categoryModalTitle.textContent = 'Rename Category';
    els.categoryId.value = category.id;
    els.categoryName.value = category.name;
    document.getElementById('btnSaveCategory').textContent = 'Save changes';
  } else {
    els.categoryModalTitle.textContent = 'Create Category';
    els.categoryId.value = '';
    els.categoryName.value = '';
    document.getElementById('btnSaveCategory').textContent = 'Create category';
  }
  els.categoryModal.showModal();
}

function resetUserAgentEditor() {
  clearUserAgentErrors();
  els.userAgentMode.value = userAgentOverride.mode;
  els.userAgentValue.value = userAgentOverride.value;
  syncUAModeButtons();
  uaDraftBaseline = {mode: userAgentOverride.mode, value: userAgentOverride.value};
  updateUAActions();
}

function openQuickShareModal(rule) {
  els.quickShareValue.value = encodeQuickShareRule(rule);
  els.quickShareStatus.textContent = '';
  els.quickShareModal.showModal();
  els.quickShareValue.focus();
  els.quickShareValue.select();
}

function openQuickImportModal() {
  els.quickImportValue.value = '';
  els.quickImportError.textContent = '';
  els.quickImportModal.showModal();
  els.quickImportValue.focus();
}

function openConfirm(text, onYes) {
  pendingConfirm = onYes;
  els.confirmText.textContent = text;
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  els.btnYes.textContent = /Clear/.test(text) ? 'Clear logs' : /Delete/.test(text) ? 'Delete' : 'Discard changes';
  els.confirmModal.showModal();
}

function confirmDeleteRule(rule) {
  openConfirm(`Delete rule "${rule.name}"?`, async () => {
    await checkedMessage({ type: 'delete-rule', id: rule.id });
    await refresh();
  });
}

function beginCategoryDelete(mode) {
  if (!pendingCategoryDelete) return;
  const { category, count } = pendingCategoryDelete;
  let action = `Delete category "${category.name}"?`;
  if (count > 0 && mode === 'deleteRules') {
    action = `Delete category "${category.name}" and all assigned rules?`;
  } else if (count > 0) {
    action = `Delete category "${category.name}" and move assigned rules to Uncategorized?`;
  }
  els.categoryDeleteChoiceModal.close();
  openConfirm(action, async () => {
    const resp = await sendMessage({
      type: 'delete-category',
      categoryId: category.id,
      mode
    });
    if (!resp || !resp.ok) {
      notify('Failed to delete category: ' + (resp && resp.error || 'unknown'));
      return;
    }
    pendingCategoryDelete = null;
    selectedCategoryId = UNCATEGORIZED_ID;
    els.categoryModal.close();
    await refresh();
  });
}

function requestCategoryDelete(category) {
  const counts = getCategoryCounts(category.id);
  pendingCategoryDelete = { category, count: counts.total };
  if (counts.total === 0) {
    beginCategoryDelete('moveRulesToUncategorized');
    return;
  }

  els.categoryDeleteChoiceText.textContent = `Category "${category.name}" contains ${counts.total} rule${counts.total === 1 ? '' : 's'}.`;
  els.categoryModal.close();
  els.categoryDeleteChoiceModal.showModal();
}

els.btnNo.addEventListener('click', () => {
  pendingConfirm = null;
  els.confirmModal.close();
});

els.btnYes.addEventListener('click', async () => {
  const onYes = pendingConfirm;
  pendingConfirm = null;
  els.confirmModal.close();
  if (onYes) { try { await onYes(); } catch(e) { notify(e.message); } }
});

els.ruleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (ruleSaving) return;
  clearRuleErrors();
  ['name', 'source', 'destination'].forEach(id => {
    els[id].value = els[id].value.trim();
  });
  const rule = {
    id: els.ruleId.value || undefined,
    name: els.name.value.trim(),
    mode: els.mode.value,
    categoryId: els.category.value || null,
    source: els.source.value.trim(),
    destination: els.destination.value.trim(),
    enabled: currentRuleEnabled
  };
  const errors = {};
  if (!rule.name) errors.name = 'Name is required';
  if (rule.name && rule.name.length > 80) errors.name = 'Name exceeds 80 characters';
  const sourceError = getSourceValidationError(rule.source, rule.mode);
  if (sourceError) errors.source = sourceError;
  const destinationError = getDestinationValidationError(rule.destination, rule.mode);
  if (destinationError) errors.destination = destinationError;
  if (Object.keys(errors).length) {
    if (errors.name) els.nameError.textContent = errors.name;
    if (errors.source) els.sourceError.textContent = errors.source;
    if (errors.destination) els.destinationError.textContent = errors.destination;
    document.getElementById(Object.keys(errors)[0]).focus?.();
    notifyRuleError('Please correct the highlighted fields before saving.');
    return;
  }
  setRuleSaving(true);
  let saved = false;
  try {
    const resp = await sendMessage({ type: 'save-rule', rule }, true);
    if (!resp || !resp.ok) {
      const message = resp && resp.error || 'No response from the extension. Reload the extension and try again.';
      if (/name/i.test(message)) els.nameError.textContent = message;
      else if (/source|wildcard|contain/i.test(message)) els.sourceError.textContent = message;
      else if (/destination/i.test(message)) els.destinationError.textContent = message;
      throw new Error(message);
    }
    saved = true;
    // Keep the saved ID so retrying after a refresh failure updates the same rule.
    els.ruleId.value = resp.rule.id;
    await refresh(true);
    const status = ruleStatuses[resp.rule.id];
    if (status && !status.ok) {
      notifyRuleError('Rule saved, but could not be activated: ' + status.message);
      return;
    }
    els.ruleModal.close();
  } catch (error) {
    const prefix = saved ? 'Rule saved, but the list could not be refreshed: ' : 'Failed to save rule: ';
    notifyRuleError(prefix + (error && error.message || String(error)));
  } finally {
    setRuleSaving(false);
  }
});

els.categoryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearCategoryErrors();
  const category = {
    id: els.categoryId.value || undefined,
    name: els.categoryName.value.trim()
  };
  if (!category.name) {
    els.categoryNameError.textContent = 'Name is required';
    return;
  }

  const resp = await sendMessage({ type: 'save-category', category });
  if (!resp || !resp.ok) {
    els.categoryNameError.textContent = resp && resp.error || 'Failed to save category';
    return;
  }
  selectedCategoryId = resp.category.id;
  await refresh();
  els.categoryModal.close();
});

els.btnDeleteCategory.addEventListener('click', () => {
  const category = getCategoryById(selectedCategoryId);
  if (category) requestCategoryDelete(category);
});

els.btnCancelCategoryDeleteChoice.addEventListener('click', () => {
  pendingCategoryDelete = null;
  els.categoryDeleteChoiceModal.close();
});

els.btnMoveRulesToUncategorized.addEventListener('click', () => beginCategoryDelete('moveRulesToUncategorized'));
els.btnDeleteCategoryRules.addEventListener('click', () => beginCategoryDelete('deleteRules'));

// Cancel in rule modal
els.ruleModal.addEventListener('cancel', (e) => {
  if (ruleSaving) e.preventDefault();
});

els.btnCancelRule.addEventListener('click', (e) => {
  e.preventDefault();
  if (ruleSaving) return;
  els.ruleModal.close();
});

els.btnCancelCategory.addEventListener('click', (e) => {
  e.preventDefault();
  els.categoryModal.close();
});

els.btnCancelUserAgent.addEventListener('click', resetUserAgentEditor);

// New
els.btnNew.addEventListener('click', () => openRuleModal(null));
els.btnQuickImport.addEventListener('click', openQuickImportModal);
els.btnNewCategory.addEventListener('click', () => openCategoryModal(null));


els.btnCloseQuickShare.addEventListener('click', () => els.quickShareModal.close());
els.btnCopyQuickShare.addEventListener('click', async () => {
  els.quickShareValue.select();
  try {
    await navigator.clipboard.writeText(els.quickShareValue.value);
    els.quickShareStatus.textContent = 'Copied.';
  } catch {
    els.quickShareStatus.textContent = 'Copy failed. Select and copy the string manually.';
  }
});

els.btnCancelQuickImport.addEventListener('click', (e) => {
  e.preventDefault();
  els.quickImportModal.close();
});

els.quickImportForm.addEventListener('submit', (e) => {
  e.preventDefault();
  els.quickImportError.textContent = '';
  try {
    const rule = decodeQuickShareRule(els.quickImportValue.value);
    els.quickImportModal.close();
    openRuleModal(rule, true);
  } catch (err) {
    els.quickImportError.textContent = err && err.message ? err.message : 'Invalid quick share string.';
  }
});

let userAgentSaving = false;
els.userAgentForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (userAgentSaving || !uaDirty()) return;
  clearUserAgentErrors();
  const mode = els.userAgentMode.value;
  const value = els.userAgentValue.value.trim();
  const error = getUserAgentValidationError(value);
  if (error) { els.userAgentError.textContent = error; els.userAgentValue.focus(); return; }
  userAgentSaving = true;
  els.userAgentValue.disabled = true;
  document.getElementById('uaModeButtons').disabled = true;
  els.btnCancelUserAgent.disabled = true;
  document.getElementById('btnSaveUserAgent').disabled = true;
  els.userAgentForm.setAttribute('aria-busy','true');
  try {
    await checkedMessage({type:'save-user-agent-override',mode,value});
    userAgentOverride = {...userAgentOverride,mode,value};
    resetUserAgentEditor();
    await refresh(true);
  } catch (error) { els.userAgentError.textContent = error.message; }
  finally {
    userAgentSaving = false;
    els.userAgentValue.disabled = false;
    document.getElementById('uaModeButtons').disabled = false;
    els.btnCancelUserAgent.disabled = false;
    document.getElementById('btnSaveUserAgent').disabled = false;
    els.userAgentForm.setAttribute('aria-busy','false');
    updateUAActions();
  }
});

// Global toggle


// Export
els.btnExport.addEventListener('click', async () => {
  els.btnExport.disabled = true;
  try {
    const resp = await checkedMessage({ type:'export-rules' });
    if (!resp.data && !resp.rules) throw new Error('Export response contained no data.');
    const url = URL.createObjectURL(new Blob([JSON.stringify(resp.data || resp.rules,null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'rules-export.json'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
  } catch(e) { notify(e.message); } finally { els.btnExport.disabled = false; }
});

// Import
els.fileImport.addEventListener('change', async ev => {
  const file = ev.target.files[0]; if(!file) return; ev.target.disabled = true;
  try { let payload; try { payload = JSON.parse(await file.text()); } catch { throw new Error('Invalid JSON file.'); }
    const resp = await checkedMessage({type:'import-rules',rules:payload});
    if (resp.skipped) notify('Imported ' + resp.count + ' rules. Skipped ' + resp.skipped + ' invalid rules.'); await refresh(true);
  } catch(e) { notify(e.message); } finally { ev.target.value = ''; ev.target.disabled = false; }
});

// Logs

els.btnCloseLogs.addEventListener('click', () => { location.hash = 'rules'; });
els.logsSearch.addEventListener('input', renderLogs);
els.logsTypeFilter.addEventListener('change', renderLogs);
els.btnToggleLogsPause.addEventListener('click', async () => {
  setLogsPaused(!logsPaused);
  if (logsPaused) {
    els.logsStatus.textContent = 'Log refresh paused. New logs are still recorded.';
    return;
  }
  await refresh();
  els.logsStatus.textContent = 'Log refresh resumed.';
  renderLogs();
});
els.btnCopyLogs.addEventListener('click', async () => {
  const visibleLogs = getVisibleLogs();
  if (!visibleLogs.length) {
    els.logsStatus.textContent = 'No visible logs to copy.';
    return;
  }
  const text = visibleLogs
    .map(log => `[${log.timeText}] ${log.typeLabel}: ${log.title}${log.detail ? ` - ${log.detail}` : ''}`)
    .join('\n');
  try {
    await navigator.clipboard.writeText(text);
    els.logsStatus.textContent = `Copied ${visibleLogs.length} visible log${visibleLogs.length === 1 ? '' : 's'}.`;
  } catch {
    els.logsStatus.textContent = 'Copy failed. Select and copy logs manually.';
  }
});
els.btnClearLogs.addEventListener('click', () => {
  openConfirm('Clear all logs?', async () => {
    await checkedMessage({ type: 'clear-logs' });
    logs = [];
    await refresh();
    els.logsStatus.textContent = 'Logs cleared.';
    renderLogs();
  });
});

function setLogsPaused(paused) {
  logsPaused = paused;
  els.btnToggleLogsPause.textContent = paused ? 'Continue' : 'Pause';
  els.btnToggleLogsPause.setAttribute('aria-pressed', String(paused));
}

function formatLogTime(time) {
  if (!time) return 'Unknown time';
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? String(time) : date.toLocaleString();
}

function parseLogInfo(info) {
  const text = String(info || '');
  let match = text.match(/^on webpage \[(.*)] URL \[(.*)] rule \[(.*)] applied$/);
  if (match) {
    return {
      type: 'redirect',
      typeLabel: 'Redirect',
      title: `Rule "${match[3]}" applied`,
      detail: `Webpage: ${match[1]}\nURL: ${match[2]}`,
      ruleName: match[3],
      webpageUrl: match[1],
      url: match[2],
      rawInfo: text
    };
  }

  match = text.match(/^on URL \[(.*)] rule \[(.*)] applied$/);
  if (match) {
    return {
      type: 'redirect',
      typeLabel: 'Redirect',
      title: `Rule "${match[2]}" applied`,
      detail: `URL: ${match[1]}`,
      ruleName: match[2],
      url: match[1],
      rawInfo: text
    };
  }

  match = text.match(/^on page \[(.*)] rule \[(.*)] applied$/);
  if (match) {
    return {
      type: 'redirect',
      typeLabel: 'Redirect',
      title: `Rule "${match[2]}" applied`,
      detail: `URL: ${match[1]}`,
      ruleName: match[2],
      url: match[1],
      rawInfo: text
    };
  }

  match = text.match(/^PW Bot Detection override activated for rule \[(.*)]$/);
  if (match) {
    return {
      type: 'pw-bot',
      typeLabel: 'PW Bot',
      title: 'Detection override activated',
      detail: `Rule "${match[1]}"`,
      ruleName: match[1],
      rawInfo: text
    };
  }

  match = text.match(/^User Agent override (enabled|disabled)$/);
  if (match) {
    return {
      type: 'user-agent',
      typeLabel: 'User-Agent',
      title: `Override ${match[1]}`,
      detail: '',
      rawInfo: text
    };
  }

  match = text.match(/^User Agent override changed to (attach|replace) \[(.*)]$/);
  if (match) {
    return {
      type: 'user-agent',
      typeLabel: 'User-Agent',
      title: `Override changed to ${match[1]}`,
      detail: match[2],
      rawInfo: text
    };
  }

  return {
    type: 'event',
    typeLabel: 'Event',
    title: text || 'Log entry',
    detail: '',
    rawInfo: text
  };
}

function normalizeLogEntry(entry) {
  let time = '';
  let info = '';
  if (typeof entry === 'string') {
    const match = entry.match(/^\[(.*?)\]\s*(.*)$/);
    time = match ? match[1] : '';
    info = match ? match[2] : entry;
  } else if (entry && typeof entry === 'object') {
    time = entry.time;
    info = entry.info;
  }

  const parsed = parseLogInfo(info);
  const timeText = formatLogTime(time);
  const searchText = [
    timeText,
    parsed.typeLabel,
    parsed.title,
    parsed.detail,
    parsed.ruleName,
    parsed.webpageUrl,
    parsed.url,
    parsed.rawInfo
  ].join(' ').toLowerCase();
  return { ...parsed, timeText, searchText };
}

function getVisibleLogs() {
  const matchesSearch = TextSearch.createMatcher(els.logsSearch.value);
  const type = els.logsTypeFilter.value;
  return logs
    .slice(-1000)
    .reverse()
    .map(normalizeLogEntry)
    .filter(log => (type === 'all' || log.type === type) && matchesSearch(log.searchText));
}

function renderLogs() {
  els.logsBody.innerHTML = '';
  const total = logs ? logs.length : 0;
  const visibleLogs = getVisibleLogs();
  els.logsCount.textContent = total
    ? `Showing ${visibleLogs.length} of ${total} log${total === 1 ? '' : 's'}`
    : 'No logs';

  if (!logs || !logs.length) {
    const empty = document.createElement('div');
    empty.className = 'logs-empty';
    empty.textContent = 'No logs yet.';
    els.logsBody.appendChild(empty);
    return;
  }
  if (!visibleLogs.length) {
    const empty = document.createElement('div');
    empty.className = 'logs-empty';
    empty.textContent = 'No logs match the current filters.';
    els.logsBody.appendChild(empty);
    return;
  }
  for (const entry of visibleLogs) {
    const row = document.createElement('div');
    row.className = `log-row log-${entry.type}`;
    const t = document.createElement('div');
    t.className = 'log-time';
    t.textContent = entry.timeText;
    const badge = document.createElement('span');
    badge.className = `log-type ${entry.type}`;
    badge.textContent = entry.typeLabel;
    const content = document.createElement('div');
    content.className = 'log-content';
    const title = document.createElement('div');
    title.className = 'log-title';
    title.textContent = entry.title;
    content.appendChild(title);
    if (entry.detail) {
      const detail = document.createElement('div');
      detail.className = 'log-detail';
      detail.textContent = entry.detail;
      content.appendChild(detail);
    }
    row.appendChild(t);
    row.appendChild(badge);
    row.appendChild(content);
    els.logsBody.appendChild(row);
  }
}

// Live log updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && (msg.type === 'global-state-updated' || msg.type === 'csp-bypass-state-updated')) {
    refresh();
    return;
  }
  if (msg && msg.type === 'logs-updated') {
    if (typeof activeView === 'undefined' || activeView !== 'logs' || logsPaused) return;
    refresh().then(renderLogs);
  }
});
