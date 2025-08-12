
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
  ruleId: document.getElementById('ruleId'),
  confirmModal: document.getElementById('confirmModal'),
  confirmText: document.getElementById('confirmText'),
  btnNo: document.getElementById('btnNo'),
  btnYes: document.getElementById('btnYes')
};

let rules = [];
let logs = [];
let globalEnabled = true;
let pendingDeleteId = null;

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
  if (mode === 'regex') return '<span class="badge cyan">Regex</span>';
  if (mode === 'contain') return '<span class="badge orange">Contain</span>';
  return '<span class="badge gray">Exact</span>';
}

function renderRules() {
  els.rulesList.innerHTML = '';
  if (!rules.length) {
    const empty = document.createElement('div');
    empty.className = 'small';
    empty.textContent = 'No rules yet. Click “New Rule” to create one.';
    els.rulesList.appendChild(empty);
    return;
  }
  for (const r of rules) {
    const row = document.createElement('div');
    row.className = 'item';

    const left = document.createElement('div');
    left.innerHTML = `<div class="name">${r.name}</div>
      <div class="meta">${ruleBadge(r.mode)} ${r.enabled ? '' : '<span class="badge">Disabled</span>'}</div>`;

    const mid = document.createElement('div');
    mid.innerHTML = `<div class="source">${r.source}</div><div class="dest">→ ${r.destination}</div>`;

    const right = document.createElement('div');
    right.className = 'row';
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

    right.appendChild(toggle);
    right.appendChild(btnEdit);
    right.appendChild(btnDelete);

    row.appendChild(left);
    row.appendChild(mid);
    row.appendChild(right);
    els.rulesList.appendChild(row);
  }
}

function openRuleModal(existing) {
  if (existing) {
    els.ruleModalTitle.textContent = 'Edit Rule';
    els.name.value = existing.name;
    els.mode.value = existing.mode;
    els.source.value = existing.source;
    els.destination.value = existing.destination;
    els.ruleId.value = existing.id;
  } else {
    els.ruleModalTitle.textContent = 'New Rule';
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
  const rule = {
    id: els.ruleId.value || undefined,
    name: els.name.value.trim(),
    mode: els.mode.value,
    source: els.source.value.trim(),
    destination: els.destination.value.trim(),
    enabled: true
  };
  const resp = await sendMessage({ type: 'save-rule', rule });
  if (!resp || !resp.ok) {
    alert('Failed to save rule: ' + (resp && resp.error || 'unknown error'));
    return;
  }
  els.ruleModal.close();
  await refresh();
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
  if (!logs || !logs.length) {
    els.logsBody.textContent = 'No logs yet.';
    return;
  }
  els.logsBody.textContent = logs.slice().reverse().join('\\n');
}

// Live log updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'logs-updated') {
    refresh().then(renderLogs);
  }
});

refresh();
