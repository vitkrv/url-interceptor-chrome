
const els = {
  openOptions: document.getElementById('openOptions'),
  globalToggle: document.getElementById('globalToggle'),
  appliedRules: document.getElementById('appliedRules')
};

let currentTabId = null;
let popupLoaded = false;
let refreshing = false;

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
  document.getElementById('activityCount').textContent = names.length;
  els.appliedRules.innerHTML = '';
  if (!names.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = currentTabId === null ? 'No available tab.' : 'No recorded rule activity on this page.';
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
  if (refreshing) return;
  refreshing = true; els.globalToggle.disabled = true;
  try {
    currentTabId = await getCurrentTabId();
    const state = await sendMessage({type:'get-popup-state',tabId:currentTabId});
    if (!state || typeof state.globalEnabled !== 'boolean') throw new Error('Could not load extension state. Retry or reload the extension.');
    els.globalToggle.checked = state.globalEnabled;
    document.getElementById('popupState').textContent = state.globalEnabled ? 'On' : 'Paused';
    renderAppliedRules(state.appliedRules || []); popupLoaded = true;
    document.getElementById('popupError').hidden = true; document.getElementById('retryPopup').hidden = true;
  } catch(e) { showError(e.message); }
  finally { refreshing = false; els.globalToggle.disabled = !popupLoaded; }
}
function showError(message) { document.getElementById('popupError').textContent = message; document.getElementById('popupError').hidden = false; document.getElementById('retryPopup').hidden = false; if(!popupLoaded) { els.appliedRules.textContent = ''; document.getElementById('popupState').textContent = 'Unavailable'; } }
document.getElementById('retryPopup').addEventListener('click',refresh);

els.openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

els.globalToggle.addEventListener('change', async () => {
  els.globalToggle.disabled = true;
  const old = !els.globalToggle.checked;
  const result = await sendMessage({ type: 'set-global', enabled: els.globalToggle.checked });
  if (!result?.ok) { els.globalToggle.checked = old; showError(result?.error || 'Could not update redirects.'); els.globalToggle.disabled = false; return; }
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
