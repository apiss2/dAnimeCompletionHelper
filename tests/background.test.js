const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const workTab = { id: 10, url: 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=28572' };
const items = [{ number: 8, partId: '28572008' }, { number: 9, partId: '28572009' }];
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(complete = async () => {}) {
  const listeners = {}, store = {}, calls = [];
  const tabs = new Map([[workTab.id, { ...workTab }]]);
  const reloads = [];
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  const chrome = {
    storage: { session: {
      async get(k) { return { [k]: structuredClone(store[k]) }; },
      async set(value) { Object.assign(store, structuredClone(value)); }
    } },
    tabs: {
      async query() { return []; }, async sendMessage() {},
      async get(id) { if (!tabs.has(id)) throw new Error('closed'); return tabs.get(id); },
      async reload(id) { reloads.push(id); }
    },
    runtime: { onMessage: event('message') },
    action: { onClicked: event('action'), async setBadgeText() {} }
  };
  const context = { chrome, URL, AbortController, Promise, importScripts() {}, DAnimeHistory: {
    async complete(id, signal) { calls.push(id); await complete(id, signal); }
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), context);
  const send = (message, tab = workTab) => new Promise(resolve => listeners.message(message, { tab, frameId: 0 }, resolve));
  return { send, store, calls, tabs, reloads };
}

test('再生タブを使わず選択範囲を順に更新する', async () => {
  const app = setup();
  assert.equal((await app.send({ type: 'START_JOB', workId: '28572', items })).ok, true);
  await flush();
  assert.deepEqual(app.calls, ['28572008', '28572009']);
  const status = await app.send({ type: 'GET_STATUS' });
  assert.equal(status.job.status, 'done');
  assert.equal(status.job.index, 2);
  assert.equal(JSON.stringify(app.store).includes('token'), false);
  assert.deepEqual(app.reloads, [workTab.id]);
  await app.send({ type: 'GET_STATUS' });
  assert.deepEqual(app.reloads, [workTab.id]);
});

test('確認できない話で止まり、次話へ進まない', async () => {
  const app = setup(async () => { throw new Error('視聴済み未反映'); });
  await app.send({ type: 'START_JOB', workId: '28572', items });
  await flush();
  assert.deepEqual(app.calls, ['28572008']);
  const { job } = await app.send({ type: 'GET_STATUS' });
  assert.equal(job.status, 'error');
  assert.equal(job.index, 0);
  assert.deepEqual(app.reloads, []);
});

test('停止で通信を中断し、二重開始を拒否する', async () => {
  const app = setup((id, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  await app.send({ type: 'START_JOB', workId: '28572', items });
  assert.equal((await app.send({ type: 'START_JOB', workId: '28572', items })).ok, false);
  const response = await app.send({ type: 'CANCEL_JOB' });
  assert.equal(response.job.status, 'cancelled');
  assert.deepEqual(app.calls, ['28572008']);
  assert.deepEqual(app.reloads, []);
});

test('別ページへ移動したタブや閉じたタブは完了時に更新しない', async () => {
  for (const url of ['https://example.org/', 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=28099', null]) {
    let finish;
    const app = setup(() => new Promise(resolve => { finish = resolve; }));
    await app.send({ type: 'START_JOB', workId: '28572', items: [items[0]] });
    await flush();
    if (url) app.tabs.set(workTab.id, { id: workTab.id, url });
    else app.tabs.delete(workTab.id);
    finish();
    await flush();
    assert.equal((await app.send({ type: 'GET_STATUS' })).job.status, 'done');
    assert.deepEqual(app.reloads, []);
  }
});

test('別作品・重複・外部ページからの開始を拒否する', async () => {
  const app = setup();
  for (const invalid of [[{ number: 1, partId: '99999001' }], [items[0], items[0]],
    [{ number: 1, partId: 'https://example.org/' }]]) {
    assert.equal((await app.send({ type: 'START_JOB', workId: '28572', items: invalid })).ok, false);
  }
  assert.equal((await app.send({ type: 'START_JOB', workId: '28572', items }, { id: 20, url: 'https://example.org/' })).ok, false);
  assert.deepEqual(app.calls, []);
});

test('ワーカー再起動後は未確認の通信を自動再送しない', async () => {
  const app = setup();
  app.store.rangePlayerJob = { workId: '28572', items, index: 0, status: 'running' };
  const { job } = await app.send({ type: 'GET_STATUS' });
  assert.equal(job.status, 'error');
  assert.deepEqual(app.calls, []);
});
