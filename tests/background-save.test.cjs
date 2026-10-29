const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const tick = () => new Promise(setImmediate);
const rule = { name: 'PageOS', mode: 'wildcard', source: 'https://cdn.intergient.com/pageos/*/pageos.js', destination: 'https://cdn.intergientdev.com/pageos/RC.20261028.2/pageos.js', enabled: true };

function setup(initial = {}) {
  let listener;
  const data = structuredClone(initial);
  const updates = [], notifications = [], injections = [];
  const event = { addListener() {} };
  const chrome = {
    storage: { local: {
      async get(defaults) { return structuredClone({ ...defaults, ...data }); },
      async set(patch) { Object.assign(data, structuredClone(patch)); }
    } },
    runtime: {
      onMessage: { addListener(fn) { listener = fn; } }, onInstalled: event, onStartup: event,
      async sendMessage(message) { notifications.push(message); }
    },
    tabs: { onRemoved: event, onUpdated: event, async query() { return [{ id: 1 }]; } },
    action: { async setIcon() {}, async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} },
    declarativeNetRequest: {
      async isRegexSupported() { return { isSupported: true }; },
      async getDynamicRules() { return []; },
      updateDynamicRules(update) {
        return new Promise((resolve, reject) => updates.push({ update, resolve, reject }));
      }
    },
    scripting: {
      async getRegisteredContentScripts() { return [{ id: 'pw-bot-accessor' }]; },
      async unregisterContentScripts() {},
      executeScript(args) { injections.push(args); return new Promise(() => {}); }
    }
  };
  const context = vm.createContext({ chrome, console: { ...console, error() {} }, URL, crypto: webcrypto });
  vm.runInContext(fs.readFileSync('background/service-worker.js', 'utf8'), context);
  const send = message => new Promise(resolve => listener(message, {}, resolve));
  return { data, updates, notifications, injections, send, chrome };
}

test('save acknowledges storage before application and never waits for tab injections', async () => {
  for (const pwBotDetectionEnabled of [true, false]) {
    const app = setup({ pwBotDetectionEnabled });
    const saved = await app.send({ type: 'save-rule', rule: { ...rule } });
    assert.equal(saved.ok, true);
    assert.equal(saved.status.phase, 'queued');
    assert.equal(app.data.rules.length, 1);
    await tick();
    assert.equal(app.data.ruleStatuses[saved.rule.id].phase, 'applying');
    const state = await app.send({ type: 'get-state' });
    assert.equal(state.rules.length, 1);
    assert.equal(app.updates.length, 1);
    assert.equal(app.injections.length, 0);
    app.updates[0].resolve();
    await tick();
    assert.equal(app.data.ruleStatuses[saved.rule.id].message, 'Installed');
    assert.ok(app.notifications.some(message => message.type === 'rule-statuses-updated'));
  }
});

test('failed application keeps the saved rule and reports the error; saving again retries', async () => {
  const app = setup();
  const saved = await app.send({ type: 'save-rule', rule: { ...rule } });
  await tick();
  app.updates[0].reject(new Error('Dynamic rule quota exceeded'));
  await tick();
  assert.equal(app.data.rules[0].id, saved.rule.id);
  assert.equal(app.data.ruleStatuses[saved.rule.id].phase, 'failed');
  assert.match(app.data.ruleStatuses[saved.rule.id].message, /quota exceeded/);
  await app.send({ type: 'save-rule', rule: { ...saved.rule } });
  await tick();
  app.updates[1].resolve();
  await tick();
  assert.equal(app.data.rules.length, 1);
  assert.equal(app.data.ruleStatuses[saved.rule.id].ok, true);
});

test('rapid edits save during application and only the latest result completes their status', async () => {
  const app = setup();
  const saved = await app.send({ type: 'save-rule', rule: { ...rule } });
  await tick();
  const next = await app.send({ type: 'save-rule', rule: { ...saved.rule, destination: 'https://example.com/new.js' } });
  assert.equal(next.ok, true);
  assert.equal(app.updates.length, 1);
  assert.equal(app.data.ruleStatuses[saved.rule.id].phase, 'queued');
  app.updates[0].resolve();
  await tick();
  assert.equal(app.updates.length, 2);
  assert.equal(app.data.ruleStatuses[saved.rule.id].phase, 'applying');
  assert.equal(app.updates[1].update.addRules[0].action.redirect.url, 'https://example.com/new.js');
  app.updates[1].resolve();
  await tick();
  assert.equal(app.data.ruleStatuses[saved.rule.id].message, 'Installed');
});

test('worker restart resumes saved work', async () => {
  const app = setup({ rules: [{ ...rule, id: 'resume' }], ruleStatuses: { resume: { ok: true, phase: 'applying', operationId: 'previous-worker' } } });
  await tick();
  assert.equal(app.updates.length, 1);
  app.updates[0].resolve();
  await tick();
  assert.equal(app.data.ruleStatuses.resume.message, 'Installed');
});

test('deleting a rule during application queues removal after the in-flight build', async () => {
  const app = setup();
  const saved = await app.send({ type: 'save-rule', rule: { ...rule } });
  await tick();
  const deletion = app.send({ type: 'delete-rule', id: saved.rule.id });
  await tick();
  app.updates[0].resolve();
  await tick();
  assert.equal(app.updates[1].update.addRules.length, 0);
  app.updates[1].resolve();
  assert.equal((await deletion).ok, true);
  assert.equal(app.data.rules.length, 0);
  assert.equal(app.data.ruleStatuses[saved.rule.id], undefined);
});

test('concurrent creates preserve both rules', async () => {
  const app = setup();
  const saved = await Promise.all([
    app.send({ type: 'save-rule', rule: { ...rule, name: 'First' } }),
    app.send({ type: 'save-rule', rule: { ...rule, name: 'Second' } })
  ]);
  assert.equal(app.data.rules.length, 2);
  assert.notEqual(saved[0].rule.id, saved[1].rule.id);
  await tick();
  app.updates[0].resolve();
  await tick();
  if (app.updates[1]) { app.updates[1].resolve(); await tick(); }
  assert.ok(Object.values(app.data.ruleStatuses).every(status => status.message === 'Installed'));
});

test('invalid regex remains saved and reports validation failure after application', async () => {
  const app = setup();
  app.chrome.declarativeNetRequest.isRegexSupported = async () => ({ isSupported: false, reason: 'Unsupported regex' });
  const saved = await app.send({ type: 'save-rule', rule: { ...rule } });
  await tick();
  assert.equal(app.updates[0].update.addRules.length, 0);
  app.updates[0].resolve();
  await tick();
  assert.equal(app.data.rules.length, 1);
  assert.equal(app.data.ruleStatuses[saved.rule.id].ok, false);
});
