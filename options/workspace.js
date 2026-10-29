
let activeView = 'rules';
const scrollPositions = {};
let uaDraftBaseline = null;
function uiIcon(name) {
  const paths = {share:'M18 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8.6 10.5l6.8-4M8.6 13.5l6.8 4',pencil:'M15 4l5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z',trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',grip:'M8 5h1m6 0h1M8 12h1m6 0h1M8 19h1m6 0h1',more:'M5 12h1m5 0h1m5 0h1',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2'};
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="'+(paths[name] || paths.more)+'"/></svg>';
}
// Notifications are reserved for warnings and errors; successful actions stay quiet.
function notify(message) {
  document.querySelector('.toast')?.remove();
  const box = document.createElement('div'); box.className = 'toast error'; box.setAttribute('role','alert');
  const text = document.createElement('span'); text.textContent = message;
  const close = document.createElement('button'); close.textContent = 'Dismiss'; close.onclick = () => box.remove(); box.append(text,close); document.body.appendChild(box);
}
async function checkedMessage(payload) { const response = await sendMessage(payload,true); if (!response || response.ok === false) throw new Error(response?.error || 'No response from the extension.'); return response; }
function showLoadError(message) { const el = document.getElementById('loadError'); el.hidden = false; el.querySelector('span').textContent = message + ' Previously loaded data may be out of date.'; }
function clearLoadError() { document.getElementById('loadError').hidden = true; }
function canReorder() { return !document.getElementById('ruleSearch').value.trim() && document.getElementById('enabledFilter').value === 'all' && document.getElementById('modeFilter').value === 'all'; }
function clearFilters() { document.getElementById('ruleSearch').value = ''; document.getElementById('enabledFilter').value = 'all'; document.getElementById('modeFilter').value = 'all'; renderRules(); }
let ordering = false;
async function persistOrder(ids,focusId) {
  if (ordering || !canReorder()) return; ordering = true;
  const payload = {type:'reorder-rules',ids}; if (selectedCategoryId !== ALL_RULES_ID) payload.categoryId = selectedCategoryId || null;
  try { await checkedMessage(payload); await refresh(true); }
  catch(e) { notify(e.message); renderRules(); }
  finally { ordering = false; const row = [...els.rulesList.querySelectorAll('.item')].find(el => el.dataset.id === focusId); row?.querySelector('summary')?.focus(); }
}
function moveRule(id,direction) { const ids = getVisibleRules().map(r => r.id); const from = ids.indexOf(id); const to = from + (direction === 'up' ? -1 : 1); if (to < 0 || to >= ids.length) return; [ids[from],ids[to]] = [ids[to],ids[from]]; return persistOrder(ids,id); }
function updateShell() {
  document.getElementById('pausedNotice').hidden = globalEnabled;
  const indicators = document.getElementById('overrideIndicators'); indicators.replaceChildren();
  [[userAgentOverride.enabled,'UA','ua'],[pwBotDetectionEnabled,'PW Bot','pw-bot'],[els.cspBypassToggle.checked,'CSP bypass','csp']].forEach(([enabled,label,target]) => {
    if (!enabled) return;
    const a = document.createElement('a');
    a.href = '#settings/' + target;
    a.className = 'badge cyan';
    a.textContent = label;
    a.setAttribute('aria-label', label + ' active. Configure ' + label);
    a.addEventListener('click', e => {
      if (location.hash === a.hash) { e.preventDefault(); navigate(); }
    });
    indicators.appendChild(a);
  });
  if (!uaDirty()) resetUserAgentEditor();
  updateUAActions();
  document.getElementById('uaSummary').textContent = (userAgentOverride.enabled ? 'Enabled' : 'Disabled') + ' · ' + userAgentOverride.mode + ' · ' + userAgentOverride.value;
  const select = document.getElementById('categoryFilter'); select.replaceChildren();
  [{id:ALL_RULES_ID,name:'All rules'},{id:'',name:'Uncategorized'},...categories].forEach(c => { const option = document.createElement('option'); option.value = c.id; option.textContent = c.name; select.appendChild(option); }); select.value = selectedCategoryId;
  if (activeView === 'logs' && !logsPaused) renderLogs();
}
function navigate() {
  const [requested, target] = location.hash.slice(1).split('/');
  const next = ['rules','logs','settings'].includes(requested) ? requested : 'rules';
  if (requested !== next) history.replaceState(null,'','#'+next);
  scrollPositions[activeView] = window.scrollY; activeView = next;
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== next+'View');
  document.querySelectorAll('.navigation a').forEach(a => { if(a.hash === '#'+next) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
  if(next === 'logs') { renderLogs(); if(!logsPaused) refresh(true).catch(e => showLoadError(e.message)); } window.scrollTo(0,scrollPositions[next] || 0);
  if (next === 'settings') {
    const targets = { ua: ['uaSettings', els.userAgentValue], 'pw-bot': ['pwBotSettings', els.pwBotDetectionToggle], csp: ['cspSettings', els.cspBypassToggle] };
    if (targets[target]) {
      const [cardId, control] = targets[target];
      control.focus({ preventScroll: true });
      document.getElementById(cardId).scrollIntoView({ block: 'start' });
    }
  }
}
const logsContent = [...els.logsModal.children]; document.getElementById('logsView').append(...logsContent); els.logsModal.remove(); els.btnCloseLogs.hidden = true;

document.getElementById('btnSaveUserAgent').textContent = 'Save changes';
document.getElementById('retryLoad').onclick = () => refresh(true).catch(e => showLoadError(e.message));
['ruleSearch','enabledFilter','modeFilter'].forEach(id => document.getElementById(id).addEventListener(id === 'ruleSearch' ? 'input' : 'change',renderRules));
document.getElementById('clearFilters').onclick = clearFilters;
document.getElementById('btnImportJson').onclick = () => els.fileImport.click();
document.getElementById('categoryFilter').onchange = e => { selectedCategoryId = e.target.value; renderCategories(); renderRules(); updateShell(); };
const renameCategoryButton = document.getElementById('btnRenameCategory');
renameCategoryButton.innerHTML = uiIcon('pencil');
els.btnDeleteCategory.innerHTML = uiIcon('trash');
renameCategoryButton.onclick = () => {
  const category = getCategoryById(selectedCategoryId);
  if (category) openCategoryModal(category);
};
document.getElementById('mobileNewCategory').onclick = () => openCategoryModal();
window.addEventListener('hashchange',navigate);
const originalPlaceholder = updateSourcePlaceholder;
updateSourcePlaceholder = function() {
  document.querySelectorAll('#modeButtons input[type="radio"]').forEach(input => { input.checked = input.value === els.mode.value; });
  originalPlaceholder(); const mode = els.mode.value; document.getElementById('sourceLabel').textContent = mode === 'domain' ? 'Source domain' : 'Source URL / pattern'; document.getElementById('destinationLabel').textContent = mode === 'domain' ? 'Destination domain' : 'Destination URL'; document.getElementById('modeHelp').textContent = {exact:'Matches the complete HTTP(S) URL, for example https://example.com/a.',wildcard:'Use * for any characters. Start with http:// or https://, for example https://*.example.com/*.',contain:'Matches a substring of the URL, for example example.com/path.',domain:'Enter bare domains. Matches the host and subdomains; preserves path and query.'}[mode]; };
document.getElementById('modeButtons').addEventListener('change', e => {
  if (e.target.type !== 'radio' || !e.target.checked) return;
  els.mode.value = e.target.value;
  els.mode.dispatchEvent(new Event('change'));
});
// Put category immediately after name.
els.name.closest('.field').after(els.category.closest('.field'));
['name','source','destination'].forEach(id => { els[id].setAttribute('aria-describedby',id+'Error'); els[id].addEventListener('input',() => els[id].removeAttribute('aria-invalid')); });
const originalNotifyRuleError = notifyRuleError;
notifyRuleError = function(message) { originalNotifyRuleError(message); ['name','source','destination'].forEach(id => els[id].setAttribute('aria-invalid',String(!!els[id+'Error'].textContent))); };
els.name.addEventListener('input',() => document.getElementById('nameCount').textContent = els.name.value.length + ' / 80');
const baseSetRuleSaving = setRuleSaving;
setRuleSaving = function(saving) { baseSetRuleSaving(saving); document.getElementById('modeButtons').disabled = saving; if(!saving) els.btnSaveRule.textContent = els.ruleId.value ? 'Save changes' : 'Create rule'; };
const originalOpenRule = openRuleModal;
openRuleModal = function(...args) { originalOpenRule(...args); document.getElementById('nameCount').textContent = els.name.value.length + ' / 80'; els.btnSaveRule.textContent = els.ruleId.value ? 'Save changes' : 'Create rule'; };
// Native dialogs retain focus and drafts while a discard decision is made.
let discardReturn = null;
els.btnNo.addEventListener('click',() => { const reopen = discardReturn; discardReturn = null; reopen?.(); });
els.btnYes.addEventListener('click',() => { discardReturn = null; });
els.confirmModal.addEventListener('cancel',() => { const reopen = discardReturn; discardReturn = null; if(reopen) setTimeout(reopen,0); });
const dirtyDialogs = new Map();
function draft(dialog) { return JSON.stringify([...dialog.querySelectorAll('input:not([type=hidden]),select,textarea:not([readonly])')].map(el => el.type === 'radio' ? [el.value, el.checked] : el.value)); }
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.setAttribute('aria-label',dialog.querySelector('h3')?.textContent || 'Confirmation');
  const open = dialog.showModal.bind(dialog); dialog.showModal = () => { dirtyDialogs.set(dialog,draft(dialog)); open(); };
  if(dialog.id === 'confirmModal') return;
  const requestClose = () => { if(ruleSaving && dialog === els.ruleModal) return; if(draft(dialog) !== dirtyDialogs.get(dialog)) { dialog.close(); openConfirm('Discard unsaved changes?',() => {}); discardReturn = () => open(); } else dialog.close(); };
  // Avoid duplicating the dismissal action already provided in the footer.
  const footerDismiss = dialog.querySelector('.modal-actions button[id^="btnCancel"], .modal-actions button[id^="btnClose"], .modal-actions #btnNo');
  if (!footerDismiss) {
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn text dialog-close';
    closeButton.textContent = 'Close';
    closeButton.setAttribute('aria-label','Close dialog');
    closeButton.onclick = requestClose;
    dialog.prepend(closeButton);
  }
  dialog.addEventListener('cancel',e => { e.preventDefault(); requestClose(); });
  dialog.querySelectorAll('button[id^="btnCancel"]').forEach(button => button.addEventListener('click',e => { e.stopImmediatePropagation(); requestClose(); },true));
});
// Keep menus usable with a keyboard and close after an action.
document.addEventListener('keydown',e => { const menu = e.target.closest('details.menu'); if(!menu) return; if(e.key === 'Escape') { menu.open = false; menu.querySelector('summary').focus(); } if(['ArrowDown','ArrowUp'].includes(e.key)) { e.preventDefault(); menu.open = true; const items = [...menu.querySelectorAll('button:not(:disabled),input[type=file]')]; const index = items.indexOf(document.activeElement); items[(index + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); } });
document.addEventListener('click',e => document.querySelectorAll('details.menu[open]').forEach(menu => { if(!menu.contains(e.target) || e.target.closest('button')) menu.open = false; }));
// Confirm every toggle response and recover the previously saved state on failure.
[els.globalToggle,els.userAgentToggle,els.pwBotDetectionToggle,els.cspBypassToggle].forEach((input,index) => input.addEventListener('change',async e => { e.stopImmediatePropagation(); input.disabled = true; const old = !input.checked; try { await checkedMessage({type:['set-global','set-user-agent-enabled','set-pw-bot-detection-enabled','set-csp-bypass-enabled'][index],enabled:input.checked}); await refresh(true); } catch(error) { input.checked = old; notify(error.message); } finally { input.disabled = false; } },true));
const originalRenderLogs = renderLogs;
renderLogs = function() { const top = els.logsBody.scrollTop; const following = top + els.logsBody.clientHeight >= els.logsBody.scrollHeight - 32; originalRenderLogs(); els.logsBody.scrollTop = following ? els.logsBody.scrollHeight : top; els.logsCount.textContent = (logsPaused ? 'Paused' : 'Live') + ' · ' + getVisibleLogs().length + ' of ' + logs.length + ' events'; };
// Lock the category form until its asynchronous submit handler finishes.
[els.categoryForm].forEach(form => {
  let busy = false;
  form.addEventListener('submit',e => { if(busy) { e.preventDefault(); e.stopImmediatePropagation(); return; } busy = true; const buttons = [...form.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true); const release = () => { busy = false; buttons.forEach(b => b.disabled = false); }; pendingFormReleases.push(release); setTimeout(() => { if(busy && !pendingMessages) release(); },0); },true);
});
let pendingMessages = 0; const pendingFormReleases = [];
const baseSendMessage = sendMessage;
sendMessage = async function(...args) { pendingMessages++; try { return await baseSendMessage(...args); } finally { pendingMessages--; if(!pendingMessages) setTimeout(() => pendingFormReleases.splice(0).forEach(release => release()),0); } };
window.addEventListener('beforeunload',e => { const dirty = [...document.querySelectorAll('dialog[open]')].some(d => draft(d) !== dirtyDialogs.get(d)) || uaDirty(); if(dirty) { e.preventDefault(); e.returnValue = ''; } });
function uaDirty() { return uaDraftBaseline !== null && (els.userAgentMode.value !== uaDraftBaseline.mode || els.userAgentValue.value !== uaDraftBaseline.value); }
function syncUAModeButtons() {
  document.querySelectorAll('#uaModeButtons input[type="radio"]').forEach(input => { input.checked = input.value === els.userAgentMode.value; });
}
function updateUAActions() {
  document.getElementById('uaActions').classList.toggle('has-changes',uaDirty());
}
els.userAgentValue.addEventListener('input', updateUAActions);
document.getElementById('uaModeButtons').addEventListener('change',e => {
  if (e.target.type !== 'radio' || !e.target.checked) return;
  els.userAgentMode.value = e.target.value;
  clearUserAgentErrors();
  syncUAModeButtons();
  updateUAActions();
});
document.querySelectorAll('.navigation a').forEach(link => link.addEventListener('click',e => { if(activeView === 'settings' && link.hash !== '#settings' && uaDirty()) { e.preventDefault(); openConfirm('Discard unsaved User-Agent changes?',() => { resetUserAgentEditor(); location.hash = link.hash; }); } }));
navigate();
refresh(true).catch(e => showLoadError(e.message));
