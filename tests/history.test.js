const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup({ alreadyViewed = false, alwaysUnviewed = false, playbackCode = '00', resume = 'https://animestore.docomo.ne.jp/resume?token=test', stopAfterStart = false } = {}) {
  const calls = [], posts = [];
  const controller = new AbortController();
  const context = { URL, AbortController, Date, setTimeout: (fn, ms) => setTimeout(fn, ms === 500 ? 1 : ms), clearTimeout };
  context.fetch = async (href, options) => {
    const url = new URL(href);
    calls.push({ url, options });
    let json;
    if (url.pathname.endsWith('WS100107')) json = { resultCd: '00', data: { workPartList: [
      { workPartId: '28572008', viewed: alreadyViewed || (!alwaysUnviewed && posts.length === 3) ? '1' : '0' }
    ] } };
    else if (url.pathname.endsWith('WS010105')) json = { resultCd: playbackCode, data: {
      partId: '28572008', multideviceState: 1, resumeInfoUrl: resume
    } };
    else if (url.pathname.endsWith('WS030101')) json = { resultCd: '1', partId: '28572008', partMeasure: '23分52秒' };
    else {
      posts.push(url);
      if (stopAfterStart) controller.abort();
    }
    return { ok: true, async json() { return json; } };
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'history.js'), 'utf8'), context);
  return { api: context.DAnimeHistory, calls, posts, controller };
}

test('開始・終了・リセットを送信し、サーバーの視聴済み状態まで確認する', async () => {
  const app = setup();
  await app.api.complete('28572008', app.controller.signal);
  assert.equal(app.posts.length, 3);
  assert.deepEqual(app.posts.map(u => u.searchParams.get('resume_point')), ['0', '1432000', '0']);
  assert.deepEqual(app.posts.map(u => u.searchParams.get('info_type')), ['0', '2', '2']);
  assert.deepEqual(app.posts.map(u => u.searchParams.get('playback_state')), ['3', '0', '0']);
  assert.deepEqual(app.posts.map(u => u.searchParams.get('number')), ['00000000', '00000001', '00000002']);
  assert.ok(app.posts.every(u => u.searchParams.get('token') === 'test'));
  assert.ok(app.calls.every(c => c.options.redirect === 'error'));
  assert.ok(app.calls.filter(c => c.options.method === 'POST').every(c => c.options.credentials === 'omit'));
  assert.equal(app.calls.at(-1).url.pathname, '/animestore/rest/WS100107');
});

test('HTTP成功でも視聴済みが反映されなければ失敗にする', async () => {
  const app = setup({ alwaysUnviewed: true });
  await assert.rejects(app.api.complete('28572008', app.controller.signal), /送信後も視聴済みを確認できません/);
});

test('API拒否・未許可の更新先はPOSTせず停止する', async () => {
  for (const options of [{ playbackCode: '86' }, { resume: 'https://example.org/?token=secret' }]) {
    const app = setup(options);
    await assert.rejects(app.api.complete('28572008', app.controller.signal), e => !e.message.includes('secret'));
    assert.equal(app.posts.length, 0);
  }
});

test('停止後は残りのPOSTを送らない', async () => {
  const app = setup({ stopAfterStart: true });
  await assert.rejects(app.api.complete('28572008', app.controller.signal));
  assert.equal(app.posts.length, 1);
});

test('長さは話情報から計算し、更新先URLを検証する', () => {
  const { api } = setup();
  assert.equal(api.durationFromMeasure('23分52秒'), 1432);
  assert.equal(api.durationFromMeasure('24分'), 1440);
  assert.equal(api.durationFromMeasure('2時間'), 7200);
  assert.equal(api.durationFromMeasure('1時間02分03秒'), 3723);
  assert.equal(api.durationFromMeasure('23��52�b'), 1432);
  for (const value of ['', null, '0秒', '23分99秒']) assert.throws(() => api.durationFromMeasure(value));
  for (const value of ['http://animestore.docomo.ne.jp/r', 'https://animestore.docomo.ne.jp.evil.test/r',
    'https://user:pass@animestore.docomo.ne.jp/r', 'https://animestore.docomo.ne.jp:8443/r']) {
    assert.throws(() => api.resumeUrl(value));
  }
});

test('すでに視聴済みなら更新通信を送らない', async () => {
  const app = setup({ alreadyViewed: true });
  await app.api.complete('28572008', app.controller.signal);
  assert.equal(app.calls.length, 1);
  assert.equal(app.posts.length, 0);
});
