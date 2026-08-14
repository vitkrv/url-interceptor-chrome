// options.js
const UNCATEGORIZED_ID = '';

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
  btnCustomizeUserAgent: document.getElementById('btnCustomizeUserAgent'),
  userAgentToggle: document.getElementById('userAgentToggle'),
  userAgentModal: document.getElementById('userAgentModal'),
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
  disablePwBotDetection: document.getElementById('disablePwBotDetection'),
  nameError: document.getElementById('nameError'),
  sourceError: document.getElementById('sourceError'),
  destinationError: document.getElementById('destinationError'),
  ruleId: document.getElementById('ruleId'),
  btnCancelRule: document.getElementById('btnCancelRule'),
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
let userAgentOverride = {
  enabled: false,
  mode: 'attach',
  value: 'Playwire/2.0'
};
let currentRuleEnabled = true;
let selectedCategoryId = UNCATEGORIZED_ID;
let pendingConfirm = null;
let pendingCategoryDelete = null;
let draggedRuleId = null;
let categoryDropHandled = false;

function clearRuleErrors() {
  els.nameError.textContent = '';
  els.sourceError.textContent = '';
  els.destinationError.textContent = '';
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
  if (rule.disablePwBotDetection) data.push(1);
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
    disablePwBotDetection: data[4] === 1,
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

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (resp) => {
      // Access runtime.lastError to avoid "Unchecked runtime.lastError" warnings.
      if (chrome.runtime.lastError) {
        resolve(undefined);
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
  return category ? category.name : 'Uncategorized';
}

function getVisibleRules() {
  return rules.filter(rule => getRuleCategoryId(rule) === selectedCategoryId);
}

async function refresh() {
  const state = await sendMessage({ type: 'get-state' }) || {};
  rules = state.rules || [];
  categories = state.categories || [];
  logs = (state.logs || []).slice(-1000);
  ruleStatuses = state.ruleStatuses || {};
  globalEnabled = !!state.globalEnabled;
  userAgentOverride = normalizeUserAgentOverride(state.userAgentOverride);
  if (selectedCategoryId && !getCategoryById(selectedCategoryId)) {
    selectedCategoryId = UNCATEGORIZED_ID;
  }
  els.globalToggle.checked = globalEnabled;
  els.userAgentToggle.checked = userAgentOverride.enabled;
  renderCategoryOptions();
  renderCategories();
  renderRules();
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
  return ruleStatuses[rule.id] || { ok: false, message: 'Status pending' };
}

function statusBadge(rule) {
  const status = getRuleStatus(rule);
  if (status.message === 'Disabled') return createBadge(status.message, 'gray');
  if (status.message === 'Global disabled') return createBadge(status.message, 'gray');
  const className = status.ok ? 'ok' : 'error';
  return createBadge(status.message, className);
}

function getCategoryCounts(categoryId) {
  const assigned = rules.filter(rule => getRuleCategoryId(rule) === categoryId);
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
  const categoryItems = [{ id: UNCATEGORIZED_ID, name: 'Uncategorized', virtual: true }].concat(categories);

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
    main.addEventListener('click', () => {
      selectedCategoryId = category.id;
      renderCategories();
      renderRules();
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

    if (!category.virtual && category.id === selectedCategoryId) {
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.className = 'btn outlined compact category-settings icon-btn';
      settings.setAttribute('aria-label', 'Category settings');
      settings.title = 'Category settings';
      settings.innerHTML = '&#9881;';
      settings.addEventListener('click', () => openCategoryModal(category));
      row.appendChild(settings);
    }

    row.addEventListener('dragover', (e) => {
      if (!draggedRuleId) return;
      e.preventDefault();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drop-target');
    });
    row.addEventListener('drop', async (e) => {
      if (!draggedRuleId) return;
      e.preventDefault();
      row.classList.remove('drop-target');
      categoryDropHandled = true;
      const resp = await sendMessage({
        type: 'assign-rule-category',
        ruleId: draggedRuleId,
        categoryId: category.id || null
      });
      if (!resp || !resp.ok) {
        alert('Failed to assign category: ' + (resp && resp.error || 'unknown'));
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
  e.preventDefault();
  const dragging = document.querySelector('.item.dragging');
  if (!dragging) return;
  const after = getDragAfterElement(els.rulesList, e.clientY);
  if (after == null) {
    els.rulesList.appendChild(dragging);
  } else {
    els.rulesList.insertBefore(dragging, after);
  }
});

els.rulesList.addEventListener('drop', (e) => {
  e.preventDefault();
});

function renderRules() {
  els.rulesList.innerHTML = '';
  const visibleRules = getVisibleRules();
  if (!visibleRules.length) {
    const empty = document.createElement('div');
    empty.className = 'small';
    empty.textContent = rules.length
      ? `No rules in ${getSelectedCategoryName()}.`
      : 'No rules yet. Click "Create Rule" to add one.';
    els.rulesList.appendChild(empty);
    return;
  }

  for (const r of visibleRules) {
    const item = document.createElement('div');
    item.className = 'item';
    item.dataset.id = r.id;
    if (!r.enabled) item.classList.add('disabled');

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.innerHTML = '&#9776;';
    handle.draggable = true;
    handle.addEventListener('dragstart', (e) => {
      draggedRuleId = r.id;
      categoryDropHandled = false;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', r.id);
      item.classList.add('dragging');
    });
    handle.addEventListener('dragend', async () => {
      item.classList.remove('dragging');
      draggedRuleId = null;
      if (categoryDropHandled) {
        categoryDropHandled = false;
        return;
      }
      const ids = Array.from(els.rulesList.querySelectorAll('.item')).map(el => el.dataset.id);
      const resp = await sendMessage({
        type: 'reorder-rules',
        ids,
        categoryId: selectedCategoryId || null
      });
      if (!resp || !resp.ok) {
        await refresh();
        return;
      }
      await refresh();
    });

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
    meta.appendChild(statusBadge(r));
    if (r.disablePwBotDetection) {
      meta.appendChild(createBadge('Bot Detection disabled', 'orange'));
    }
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
    input.addEventListener('change', async () => {
      r.enabled = input.checked;
      await sendMessage({ type: 'save-rule', rule: r });
      await refresh();
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
    btnShare.setAttribute('aria-label', 'Share');
    btnShare.innerHTML = '&#x2934;';
    btnShare.addEventListener('click', () => openQuickShareModal(r));

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn danger icon-btn delete-rule';
    btnDelete.type = 'button';
    btnDelete.title = 'Delete';
    btnDelete.setAttribute('aria-label', 'Delete');
    btnDelete.innerHTML = `
      <svg viewBox="0 0 512 512" aria-hidden="true" focusable="false">
        <g fill="currentColor">
          <path d="M88.594,464.731C90.958,491.486,113.368,512,140.234,512h231.523c26.858,0,49.276-20.514,51.641-47.269l25.642-335.928H62.952L88.594,464.731z M420.847,154.93l-23.474,307.496c-1.182,13.37-12.195,23.448-25.616,23.448H140.234c-13.42,0-24.434-10.078-25.591-23.132L91.145,154.93H420.847z"/>
          <path d="M182.954,435.339c5.877-0.349,10.35-5.4,9.992-11.269l-10.137-202.234c-0.358-5.876-5.401-10.349-11.278-9.992c-5.877,0.357-10.35,5.409-9.993,11.277l10.137,202.234C172.033,431.231,177.085,435.696,182.954,435.339z"/>
          <path d="M256,435.364c5.885,0,10.656-4.763,10.656-10.648V222.474c0-5.885-4.771-10.648-10.656-10.648c-5.885,0-10.657,4.763-10.657,10.648v202.242C245.344,430.601,250.115,435.364,256,435.364z"/>
          <path d="M329.046,435.339c5.878,0.357,10.921-4.108,11.278-9.984l10.129-202.234c0.348-5.868-4.116-10.92-9.993-11.277c-5.877-0.357-10.92,4.116-11.277,9.992L319.054,424.07C318.697,429.938,323.17,434.99,329.046,435.339z"/>
          <path d="M439.115,64.517c0,0-34.078-5.664-43.34-8.479c-8.301-2.526-80.795-13.566-80.795-13.566l-2.722-19.297C310.388,9.857,299.484,0,286.642,0h-61.302c-12.825,0-23.728,9.857-25.616,23.175l-2.721,19.297c0,0-72.469,11.039-80.778,13.566c-9.261,2.815-43.357,8.479-43.357,8.479C62.544,67.365,55.332,77.172,55.332,88.38v21.926h401.336V88.38C456.668,77.172,449.456,67.365,439.115,64.517z M276.318,38.824h-40.636c-3.606,0-6.532-2.925-6.532-6.532s2.926-6.532,6.532-6.532h40.636c3.606,0,6.532,2.925,6.532,6.532S279.924,38.824,276.318,38.824z"/>
        </g>
      </svg>`;
    btnDelete.addEventListener('click', () => confirmDeleteRule(r));

    actions.appendChild(toggle);
    actions.appendChild(btnShare);
    actions.appendChild(btnEdit);
    actions.appendChild(btnDup);
    actions.appendChild(btnDelete);

    top.appendChild(left);
    top.appendChild(actions);

    const urls = document.createElement('div');
    urls.className = 'item-row urls';
    const source = document.createElement('span');
    source.className = 'source';
    source.textContent = r.source;
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '->';
    const dest = document.createElement('span');
    dest.className = 'dest';
    dest.textContent = r.destination;
    urls.appendChild(source);
    urls.appendChild(arrow);
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
    els.disablePwBotDetection.checked = !!existing.disablePwBotDetection;
    els.ruleId.value = duplicate ? '' : existing.id;
    currentRuleEnabled = existing.enabled;
    renderCategoryOptions(getRuleCategoryId(existing));
  } else {
    els.ruleModalTitle.textContent = 'Create Rule';
    els.name.value = '';
    els.mode.value = 'exact';
    els.source.value = '';
    els.destination.value = '';
    els.disablePwBotDetection.checked = false;
    els.ruleId.value = '';
    currentRuleEnabled = true;
    renderCategoryOptions(selectedCategoryId);
  }
  updateSourcePlaceholder();
  els.ruleModal.showModal();
}

function openCategoryModal(category = null) {
  clearCategoryErrors();
  if (category) {
    els.categoryModalTitle.textContent = 'Category Settings';
    els.categoryId.value = category.id;
    els.categoryName.value = category.name;
    els.btnDeleteCategory.hidden = false;
  } else {
    els.categoryModalTitle.textContent = 'Create Category';
    els.categoryId.value = '';
    els.categoryName.value = '';
    els.btnDeleteCategory.hidden = true;
  }
  els.categoryModal.showModal();
}

function openUserAgentModal() {
  clearUserAgentErrors();
  els.userAgentMode.value = userAgentOverride.mode;
  els.userAgentValue.value = userAgentOverride.value;
  els.userAgentModal.showModal();
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
  els.confirmModal.showModal();
}

function confirmDeleteRule(rule) {
  openConfirm(`Delete rule "${rule.name}"?`, async () => {
    await sendMessage({ type: 'delete-rule', id: rule.id });
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
      alert('Failed to delete category: ' + (resp && resp.error || 'unknown'));
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
  if (onYes) await onYes();
});

els.ruleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearRuleErrors();
  const rule = {
    id: els.ruleId.value || undefined,
    name: els.name.value.trim(),
    mode: els.mode.value,
    categoryId: els.category.value || null,
    source: els.source.value.trim(),
    destination: els.destination.value.trim(),
    disablePwBotDetection: els.disablePwBotDetection.checked,
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
    return;
  }
  const resp = await sendMessage({ type: 'save-rule', rule });
  if (!resp || !resp.ok) {
    if (resp) {
      if (resp.error === 'Name exceeds 80 characters') {
        els.nameError.textContent = resp.error;
      } else if (/source|wildcard|contain/i.test(resp.error)) {
        els.sourceError.textContent = resp.error;
      } else if (/destination/i.test(resp.error)) {
        els.destinationError.textContent = resp.error;
      } else {
        alert('Failed to save rule: ' + resp.error);
      }
    } else {
      alert('Failed to save rule: unknown error');
    }
    return;
  }
  await refresh();
  els.ruleModal.close();
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
  const category = getCategoryById(els.categoryId.value);
  if (category) requestCategoryDelete(category);
});

els.btnCancelCategoryDeleteChoice.addEventListener('click', () => {
  pendingCategoryDelete = null;
  els.categoryDeleteChoiceModal.close();
});

els.btnMoveRulesToUncategorized.addEventListener('click', () => beginCategoryDelete('moveRulesToUncategorized'));
els.btnDeleteCategoryRules.addEventListener('click', () => beginCategoryDelete('deleteRules'));

// Cancel in rule modal
els.btnCancelRule.addEventListener('click', (e) => {
  e.preventDefault();
  els.ruleModal.close();
});

els.btnCancelCategory.addEventListener('click', (e) => {
  e.preventDefault();
  els.categoryModal.close();
});

els.btnCancelUserAgent.addEventListener('click', (e) => {
  e.preventDefault();
  els.userAgentModal.close();
});

// New
els.btnNew.addEventListener('click', () => openRuleModal(null));
els.btnQuickImport.addEventListener('click', openQuickImportModal);
els.btnNewCategory.addEventListener('click', () => openCategoryModal(null));
els.btnCustomizeUserAgent.addEventListener('click', () => openUserAgentModal());

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

els.userAgentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearUserAgentErrors();
  const mode = els.userAgentMode.value;
  const value = els.userAgentValue.value.trim();
  const validationError = getUserAgentValidationError(value);
  if (validationError) {
    els.userAgentError.textContent = validationError;
    return;
  }

  const resp = await sendMessage({
    type: 'save-user-agent-override',
    mode,
    value
  });
  if (!resp || !resp.ok) {
    els.userAgentError.textContent = resp && resp.error || 'Failed to save User Agent override';
    return;
  }

  await refresh();
  els.userAgentModal.close();
});

els.userAgentToggle.addEventListener('change', async () => {
  const resp = await sendMessage({
    type: 'set-user-agent-enabled',
    enabled: els.userAgentToggle.checked
  });
  if (!resp || !resp.ok) {
    alert('Failed to update User Agent override: ' + (resp && resp.error || 'unknown'));
  }
  await refresh();
});

// Global toggle
els.globalToggle.addEventListener('change', async () => {
  await sendMessage({ type: 'set-global', enabled: els.globalToggle.checked });
  await refresh();
});

// Export
els.btnExport.addEventListener('click', async () => {
  const resp = await sendMessage({ type: 'export-rules' });
  const data = resp && resp.data ? resp.data : (resp && resp.rules) || [];
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rules-export.json';
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
});

// Import
els.fileImport.addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const text = await file.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { alert('Invalid JSON'); return; }
  const resp = await sendMessage({ type: 'import-rules', rules: payload });
  if (!resp || !resp.ok) alert('Import failed: ' + (resp && resp.error || 'unknown'));
  if (resp && resp.ok && resp.skipped) alert(`Imported ${resp.count} rules. Skipped ${resp.skipped} invalid rules.`);
  await refresh();
  ev.target.value = '';
});

// Logs
els.btnLogs.addEventListener('click', async () => {
  await refresh();
  setLogsPaused(false);
  els.logsStatus.textContent = '';
  renderLogs();
  els.logsModal.showModal();
});
els.btnCloseLogs.addEventListener('click', () => els.logsModal.close());
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
    await sendMessage({ type: 'clear-logs' });
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
  const query = els.logsSearch.value.trim().toLowerCase();
  const type = els.logsTypeFilter.value;
  return logs
    .slice(-1000)
    .reverse()
    .map(normalizeLogEntry)
    .filter(log => (type === 'all' || log.type === type) && (!query || log.searchText.includes(query)));
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
  if (msg && msg.type === 'global-state-updated') {
    refresh();
    return;
  }
  if (msg && msg.type === 'logs-updated') {
    if (!els.logsModal.open || logsPaused) return;
    refresh().then(renderLogs);
  }
});

refresh();
