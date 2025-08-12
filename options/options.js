
// options.js
const els = {
  rulesList: document.getElementById('rulesList'),
  btnNew: document.getElementById('btnNew'),
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
  source: document.getElementById('source'),
  destination: document.getElementById('destination'),
  nameError: document.getElementById('nameError'),
  sourceError: document.getElementById('sourceError'),
  destinationError: document.getElementById('destinationError'),
  ruleId: document.getElementById('ruleId'),
  btnCancelRule: document.getElementById('btnCancelRule'),
  confirmModal: document.getElementById('confirmModal'),
  confirmText: document.getElementById('confirmText'),
  btnNo: document.getElementById('btnNo'),
  btnYes: document.getElementById('btnYes')
};

let rules = [];
let logs = [];
let globalEnabled = true;
let pendingDeleteId = null;

function clearRuleErrors() {
  els.nameError.textContent = '';
  els.sourceError.textContent = '';
  els.destinationError.textContent = '';
}

['name', 'source', 'destination'].forEach((id) => {
  els[id].addEventListener('input', () => {
    els[id + 'Error'].textContent = '';
  });
});

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (resp) => resolve(resp));
  });
}

async function refresh() {
  const state = await sendMessage({ type: 'get-state' }) || {};
  rules = state.rules || [];
  logs = state.logs || [];
  globalEnabled = !!state.globalEnabled;
  els.globalToggle.checked = globalEnabled;
  renderRules();
}

function ruleBadge(mode) {
  if (mode === 'wildcard') return '<span class="badge cyan">Wildcard</span>';
  if (mode === 'contain') return '<span class="badge orange">Contain</span>';
  return '<span class="badge gray">Exact</span>';
}

function renderRules() {
  els.rulesList.innerHTML = '';
  if (!rules.length) {
    const empty = document.createElement('div');
    empty.className = 'small';
    empty.textContent = 'No rules yet. Click “Create Rule” to add one.';
    els.rulesList.appendChild(empty);
    return;
  }
  for (const r of rules) {
    const item = document.createElement('div');
    item.className = 'item';
    if (!r.enabled) item.classList.add('disabled');

    const top = document.createElement('div');
    top.className = 'item-row';

    const info = document.createElement('div');
    info.innerHTML = `<div class="name">${r.name}</div><div class="meta">${ruleBadge(r.mode)} ${r.enabled ? '' : '<span class="badge">Disabled</span>'}</div>`;

    const actions = document.createElement('div');
    actions.className = 'row';

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

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn danger';
    btnDelete.textContent = 'Delete';
    btnDelete.addEventListener('click', () => confirmDelete(r));

    actions.appendChild(toggle);
    actions.appendChild(btnEdit);
    actions.appendChild(btnDelete);

    top.appendChild(info);
    top.appendChild(actions);

    const urls = document.createElement('div');
    urls.className = 'item-row urls';
    urls.innerHTML = `<span class="source">${r.source}</span><span class="arrow">→</span><span class="dest">${r.destination}</span>`;

    item.appendChild(top);
    item.appendChild(urls);
    els.rulesList.appendChild(item);
  }
}

function openRuleModal(existing) {
  clearRuleErrors();
  if (existing) {
    els.ruleModalTitle.textContent = 'Edit Rule';
    els.name.value = existing.name;
    els.mode.value = existing.mode;
    els.source.value = existing.source;
    els.destination.value = existing.destination;
    els.ruleId.value = existing.id;
  } else {
    els.ruleModalTitle.textContent = 'Create Rule';
    els.name.value = '';
    els.mode.value = 'exact';
    els.source.value = '';
    els.destination.value = '';
    els.ruleId.value = '';
  }
  els.ruleModal.showModal();
}

function confirmDelete(r) {
  pendingDeleteId = r.id;
  els.confirmText.textContent = `Delete rule “${r.name}”?`;
  els.confirmModal.showModal();
}

els.btnNo.addEventListener('click', () => { pendingDeleteId = null; els.confirmModal.close(); });
els.btnYes.addEventListener('click', async () => {
  if (pendingDeleteId) {
    await sendMessage({ type: 'delete-rule', id: pendingDeleteId });
    pendingDeleteId = null;
    els.confirmModal.close();
    await refresh();
  }
});

els.ruleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearRuleErrors();
  const rule = {
    id: els.ruleId.value || undefined,
    name: els.name.value.trim(),
    mode: els.mode.value,
    source: els.source.value.trim(),
    destination: els.destination.value.trim(),
    enabled: true
  };
  const errors = {};
  if (!rule.name) errors.name = 'Name is required';
  if (rule.name && rule.name.length > 80) errors.name = 'Name exceeds 80 characters';
  if (!rule.source) errors.source = 'Source is required';
  if (!rule.destination) errors.destination = 'Destination is required';
  if (Object.keys(errors).length) {
    if (errors.name) els.nameError.textContent = errors.name;
    if (errors.source) els.sourceError.textContent = errors.source;
    if (errors.destination) els.destinationError.textContent = errors.destination;
    return;
  }
  const resp = await sendMessage({ type: 'save-rule', rule });
  if (!resp || !resp.ok) {
    if (resp && resp.error === 'Name exceeds 80 characters') {
      els.nameError.textContent = resp.error;
    } else {
      alert('Failed to save rule: ' + (resp && resp.error || 'unknown error'));
    }
    return;
  }
  await refresh();
  els.ruleModal.close();
});

// Cancel in rule modal
els.btnCancelRule.addEventListener('click', () => {
  els.ruleModal.close();
});

// New
els.btnNew.addEventListener('click', () => openRuleModal(null));

// Global toggle
els.globalToggle.addEventListener('change', async () => {
  await sendMessage({ type: 'set-global', enabled: els.globalToggle.checked });
  await refresh();
});

// Export
els.btnExport.addEventListener('click', async () => {
  const resp = await sendMessage({ type: 'export-rules' });
  const data = (resp && resp.rules) || [];
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
  for (const entry of logs.slice().reverse()) {
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
