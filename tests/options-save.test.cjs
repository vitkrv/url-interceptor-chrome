const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          value: '', textContent: '', disabled: false, hidden: false, open: true,
          listeners: {}, attributes: {},
          addEventListener(type, callback) { this.listeners[type] = callback; },
          setAttribute(name, value) { this.attributes[name] = value; },
          close() { this.open = false; }
        });
      }
      return elements.get(id);
    }
  };
  const pending = [];
  const runtime = {
    onMessage: { addListener() {} },
    sendMessage(message, callback) { pending.push({ message, callback }); }
  };
  const context = vm.createContext({ document, chrome: { runtime }, URL, console });
  const source = fs.readFileSync(path.join(__dirname, '../options/options.js'), 'utf8');
  vm.runInContext(source.replace(/refresh\(\);\s*$/, ''), context);
  // Rendering is unrelated to saving; keep the actual messaging/refresh logic.
  vm.runInContext('renderCategoryOptions = renderCategories = renderRules = () => {};', context);
  const el = id => document.getElementById(id);
  el('name').value = '  Example rule  ';
  el('source').value = '  https://example.com/a  ';
  el('destination').value = '  https://target.com/b  ';
  el('mode').value = 'exact';
  const submit = () => el('ruleForm').listeners.submit({ preventDefault() {} });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  return { el, pending, runtime, submit, tick };
}

test('rapid submissions create one request and unlock as soon as persistence succeeds', async () => {
  const { el, pending, submit, tick } = setup();
  const saving = submit();
  await submit();
  assert.equal(pending.length, 1);
  assert.equal(el('btnSaveRule').disabled, true);
  assert.equal(el('btnSaveRule').textContent, 'Saving…');
  assert.equal(el('btnCancelRule').disabled, true);
  assert.equal(el('source').disabled, true);
  assert.equal(el('ruleForm').attributes['aria-busy'], 'true');
  let escapePrevented = false;
  el('ruleModal').listeners.cancel({ preventDefault() { escapePrevented = true; } });
  assert.equal(escapePrevented, true);
  const rule = pending[0].message.rule;
  assert.equal(rule.name, 'Example rule');
  assert.equal(rule.source, 'https://example.com/a');
  assert.equal(rule.destination, 'https://target.com/b');
  assert.equal(el('source').value, rule.source);
  pending[0].callback({ ok: true, rule: { ...rule, id: 'new-rule' } });
  await tick();
  assert.equal(pending[1].message.type, 'get-state');
  assert.equal(el('btnSaveRule').disabled, false);
  assert.equal(el('ruleModal').open, false);
  assert.equal(pending.length, 2);
  pending[1].callback({ rules: [{ ...rule, id: 'new-rule' }], categories: [] });
  await saving;
  assert.equal(el('ruleModal').open, false);
  assert.equal(el('btnSaveRule').disabled, false);
  assert.equal(el('btnSaveRule').textContent, 'Save');
  assert.equal(el('ruleForm').attributes['aria-busy'], 'false');
});

test('updates send the existing rule ID', async () => {
  const { el, pending, submit } = setup();
  el('ruleId').value = 'existing-rule';
  const saving = submit();
  assert.equal(pending[0].message.rule.id, 'existing-rule');
  pending[0].callback({ ok: false, error: 'Storage unavailable' });
  await saving;
  assert.equal(el('ruleId').value, 'existing-rule');
});

for (const failure of ['backend', 'runtime', 'missing-response', 'exception']) {
  test(`${failure} failures show a notification and allow retry`, async () => {
    const { el, pending, runtime, submit } = setup();
    if (failure === 'exception') {
      runtime.sendMessage = () => { throw new Error('Extension context invalidated'); };
    }
    const saving = submit();
    if (failure === 'backend') pending[0].callback({ ok: false, error: 'Dynamic rule quota exceeded' });
    if (failure === 'runtime') {
      runtime.lastError = { message: 'Could not establish connection' };
      pending[0].callback();
      delete runtime.lastError;
    }
    if (failure === 'missing-response') pending[0].callback();
    await saving;
    assert.equal(el('ruleModal').open, true);
    assert.equal(el('ruleNotification').hidden, false);
    assert.match(el('ruleNotification').textContent, /^Failed to save rule: .+/);
    if (failure === 'runtime') assert.match(el('ruleNotification').textContent, /Could not establish connection/);
    if (failure === 'exception') assert.match(el('ruleNotification').textContent, /Extension context invalidated/);
    assert.equal(el('btnSaveRule').disabled, false);
    assert.equal(el('btnCancelRule').disabled, false);
    assert.equal(el('source').disabled, false);
  });
}

test('invalid trimmed input shows field errors and a notification without sending', async () => {
  const { el, pending, submit } = setup();
  el('source').value = '   ';
  await submit();
  assert.equal(pending.length, 0);
  assert.equal(el('source').value, '');
  assert.equal(el('sourceError').textContent, 'Source is required');
  assert.equal(el('ruleNotification').hidden, false);
  assert.equal(el('btnSaveRule').disabled, false);
});

test('an unanswered refresh does not hold the saved rule dialog open', async () => {
  const { el, pending, submit } = setup();
  const saving = submit();
  pending[0].callback({ ok: true, rule: { id: 'saved-rule' }, status: { ok: true, phase: 'queued', message: 'Saved · queued' } });
  await saving;
  assert.equal(el('ruleModal').open, false);
  assert.equal(el('btnSaveRule').disabled, false);
  assert.equal(el('ruleId').value, 'saved-rule');
  assert.equal(pending[1].message.type, 'get-state');
});

test('application failure does not reopen the saved dialog', async () => {
  const { el, pending, submit, tick } = setup();
  const saving = submit();
  pending[0].callback({ ok: true, rule: { id: 'saved-rule' } });
  await saving;
  pending[1].callback({ ruleStatuses: { 'saved-rule': { ok: false, message: 'Unsupported regex' } } });
  await tick();
  assert.equal(el('ruleModal').open, false);
  assert.equal(el('btnSaveRule').disabled, false);
});
