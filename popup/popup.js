
const els = {
  openOptions: document.getElementById('openOptions'),
  globalToggle: document.getElementById('globalToggle'),
  appliedRules: document.getElementById('appliedRules')
};

let currentTabId = null;

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (resp) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(resp);
    });
  });
}

async function getCurrentTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const tab = tabs && tabs[0];
  return tab && typeof tab.id === 'number' ? tab.id : null;
}

function renderAppliedRules(names) {
  els.appliedRules.innerHTML = '';
  if (!names.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No rules applied yet.';
    els.appliedRules.appendChild(empty);
    return;
  }

  for (const name of names) {
    const item = document.createElement('li');
    item.textContent = name;
    els.appliedRules.appendChild(item);
  }
}

async function refresh() {
  currentTabId = await getCurrentTabId();
  const state = await sendMessage({ type: 'get-popup-state', tabId: currentTabId }) || {};
  els.globalToggle.checked = state.globalEnabled !== false;
  renderAppliedRules(state.appliedRules || []);
}

els.openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

els.globalToggle.addEventListener('change', async () => {
  await sendMessage({ type: 'set-global', enabled: els.globalToggle.checked });
  await refresh();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'global-state-updated') {
    refresh();
    return;
  }
  if (msg.type === 'rule-activity-updated' && msg.tabId === currentTabId) {
    refresh();
  }
});

refresh();
