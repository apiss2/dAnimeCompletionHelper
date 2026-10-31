const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  const listeners = {};
  const store = {};
  const tabs = new Map();
  let nextId = 100;
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  const chrome = {
    storage: { session: {
      async get(k) { return { [k]: store[k] }; },
      async set(value) { Object.assign(store, value); }
    } },
    tabs: {
      onRemoved: event('removed'),
      async create(input) { const tab = { id: ++nextId, url: input.url }; tabs.set(tab.id, tab); return tab; },
      async update(id, input) { const tab = tabs.get(id); if (!tab) throw Error('missing tab'); Object.assign(tab, input); return tab; },
      async get(id) { const tab = tabs.get(id); if (!tab) throw Error('missing tab'); return tab; },
      async remove(id) { tabs.delete(id); },
      async query() { return []; },
      async sendMessage() {}
    },
    runtime: { onMessage: event('message') },
    alarms: { onAlarm: event('alarm'), async create() {}, async clear() {} },
    action: { onClicked: event('action'), async setBadgeText() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), { chrome, URL, Date, Promise });
  const send = (msg, tab) => new Promise((resolve, reject) => {
    try { listeners.message(msg, { tab }, resolve); }
    catch (e) { reject(e); }
  });
  return { send, tabs, store };
}
const workTab = { id: 10, url: 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=28572' };
const url = id => `https://animestore.docomo.ne.jp/animestore/cd_pc?partId=${id}`;
const items = [
  { number: 1, partId: '28572001', url: url('28572001') },
  { number: 2, partId: '28572002', url: url('28572002') }
];
test('順に再生を完了し、対象外のタブからの完了報告を拒否', async () => {
  const app = setup();
  const response = await app.send({ type: 'START_JOB', workId: '28572', title: '作品', items }, workTab);
  assert.equal(response.ok, true);
  const playerTab = await app.tabs.get(response.job.tabId);
  assert.equal(playerTab.url, items[0].url);
  assert.equal((await app.send({ type: 'GET_ACTIVE_EPISODE' }, playerTab)).episode.partId, '28572001');
  const rejected = await app.send({ type: 'PLAYER_DONE', partId: '28572001', playedSeconds: 29, position: 1439, mediaDuration: 1440 }, workTab);
  assert.equal(rejected.ok, false);
  const tooShort = await app.send({ type: 'PLAYER_DONE', partId: '28572001', playedSeconds: 2, position: 1439, mediaDuration: 1440 }, playerTab);
  assert.equal(tooShort.ok, false);
  for (const proof of [
    { playedSeconds: 29, position: 29, mediaDuration: 1440 },
    { playedSeconds: 29, position: 1439 },
    { playedSeconds: NaN, position: 1439, mediaDuration: 1440 }
  ]) {
    assert.equal((await app.send({ type: 'PLAYER_DONE', partId: '28572001', ...proof }, playerTab)).ok, false);
  }
  assert.equal((await app.send({ type: 'PLAYER_DONE', partId: '28572001', playedSeconds: 29, position: 1439, mediaDuration: 1440 }, playerTab)).ok, true);
  assert.equal((await app.tabs.get(playerTab.id)).url, items[1].url);
  const stale = await app.send({ type: 'PLAYER_DONE', partId: '28572001', playedSeconds: 29, position: 1439, mediaDuration: 1440 }, playerTab);
  assert.equal(stale.ok, false);
  assert.equal((await app.send({ type: 'PLAYER_DONE', partId: '28572002', playedSeconds: 29, position: 1439, mediaDuration: 1440 }, playerTab)).ok, true);
  assert.equal((await app.send({ type: 'GET_STATUS' }, workTab)).job.status, 'done');
});
test('不正な外部 URL と重複話数を拒否', async () => {
  const app = setup();
  const badUrl = [{ number: 1, partId: '28572001', url: 'https://example.org/' }];
  assert.equal((await app.send({ type: 'START_JOB', workId: '28572', items: badUrl }, workTab)).ok, false);
  assert.equal((await app.send({ type: 'START_JOB', workId: '28572', items: [items[0], items[0]] }, workTab)).ok, false);
});
