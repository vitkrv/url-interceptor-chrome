// options.js
const UNCATEGORIZED_ID = '';

const els = {
  rulesList: document.getElementById('rulesList'),
  categoriesList: document.getElementById('categoriesList'),
  btnNew: document.getElementById('btnNew'),
  btnNewCategory: document.getElementById('btnNewCategory'),
  btnExport: document.getElementById('btnExport'),
  fileImport: document.getElementById('fileImport'),
  btnLogs: document.getElementById('btnLogs'),
  logsModal: document.getElementById('logsModal'),
  logsBody: document.getElementById('logsBody'),
  btnCloseLogs: document.getElementById('btnCloseLogs'),
  btnClearLogs: document.getElementById('btnClearLogs'),
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
let ruleStatuses = {};
let globalEnabled = true;
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

['name', 'source', 'destination'].forEach((id) => {
  els[id].addEventListener('input', () => {
    els[id + 'Error'].textContent = '';
  });
});

els.categoryName.addEventListener('input', clearCategoryErrors);

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

  return 'Unsupported rule mode';
}

function updateSourcePlaceholder() {
  if (els.mode.value === 'wildcard') {
    els.source.placeholder = 'e.g., https://*.example.com/*';
  } else if (els.mode.value === 'contain') {
    els.source.placeholder = 'e.g., example.com/path';
  } else {
    els.source.placeholder = 'e.g., https://example.com/a';
  }
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
  if (selectedCategoryId && !getCategoryById(selectedCategoryId)) {
    selectedCategoryId = UNCATEGORIZED_ID;
  }
  els.globalToggle.checked = globalEnabled;
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

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn danger';
    btnDelete.textContent = 'Delete';
    btnDelete.addEventListener('click', () => confirmDeleteRule(r));

    actions.appendChild(toggle);
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
    enabled: currentRuleEnabled
  };
  const errors = {};
  if (!rule.name) errors.name = 'Name is required';
  if (rule.name && rule.name.length > 80) errors.name = 'Name exceeds 80 characters';
  const sourceError = getSourceValidationError(rule.source, rule.mode);
  if (sourceError) errors.source = sourceError;
  if (!rule.destination) errors.destination = 'Destination is required';
  if (rule.destination && !isValidHttpUrl(rule.destination)) errors.destination = 'Destination must be a valid http(s) URL';
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
      } else if (resp.error === 'Destination must be a valid URL') {
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

// New
els.btnNew.addEventListener('click', () => openRuleModal(null));
els.btnNewCategory.addEventListener('click', () => openCategoryModal(null));

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
  renderLogs();
  els.logsModal.showModal();
});
els.btnCloseLogs.addEventListener('click', () => els.logsModal.close());
els.btnClearLogs.addEventListener('click', async () => {
  await sendMessage({ type: 'clear-logs' });
  await refresh();
  renderLogs();
});

function renderLogs() {
  els.logsBody.innerHTML = '';
  if (!logs || !logs.length) {
    els.logsBody.textContent = 'No logs yet.';
    return;
  }
  for (const entry of logs.slice(-1000).reverse()) {
    let time = '', info = '';
    if (typeof entry === 'string') {
      const m = entry.match(/^\[(.*?)\]\s*(.*)$/);
      time = m ? m[1] : '';
      info = m ? m[2] : entry;
    } else {
      time = entry.time;
      info = entry.info;
    }
    const row = document.createElement('div');
    row.className = 'log-row';
    const t = document.createElement('div');
    t.className = 'log-time';
    t.textContent = new Date(time).toLocaleString();
    const i = document.createElement('div');
    i.className = 'log-info';
    i.textContent = info;
    row.appendChild(t);
    row.appendChild(i);
    els.logsBody.appendChild(row);
  }
}

// Live log updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'logs-updated') {
    refresh().then(renderLogs);
  }
});

refresh();
