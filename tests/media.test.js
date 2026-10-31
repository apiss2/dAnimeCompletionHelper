const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function setup(duration = 120) {
  let now = 0;
  let tick;
  const messages = [];
  class Video {
    duration = duration;
    currentTime = 0;
    paused = true;
    seeking = false;
    readyState = 4;
    isConnected = true;
    ended = false;
    addEventListener() {}
    async play() { this.paused = false; }
    pause() { this.paused = true; }
  }
  const video = new Video();
  const mainWindow = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'media.js'), 'utf8'), {
    self: mainWindow, top: mainWindow, location: { pathname: '/animestore/sc_d_pc' },
    document: { querySelectorAll: selector => selector === 'video' ? [video] : [] },
    HTMLVideoElement: Video, Date, performance: { now: () => now },
    setInterval: fn => { tick = fn; }, clearInterval() {},
    chrome: { runtime: { async sendMessage(message) {
      messages.push(message);
      return message.type === 'GET_ACTIVE_EPISODE' ? { episode: { partId: '28572008' } } : { ok: true };
    } } }
  });
  await new Promise(resolve => setImmediate(resolve));
  return { video, messages, async step(position, elapsed = 1000) {
    now += elapsed;
    video.currentTime = position;
    tick();
    await new Promise(resolve => setImmediate(resolve));
  } };
}

test('終了5秒前へ移動し、0.5秒の実再生後にだけ完了を通知する', async () => {
  const app = await setup();
  assert.equal(app.video.currentTime, 115);
  assert.equal(app.video.muted, true);
  await app.step(115.25, 250);
  assert.equal(app.messages.some(m => m.type === 'PLAYER_DONE'), false);
  await app.step(115.5, 250);
  const done = app.messages.filter(m => m.type === 'PLAYER_DONE');
  assert.equal(done.length, 1);
  assert.equal(done[0].position, 115.5);
  assert.equal(done[0].mediaDuration, 120);
  assert.equal(done[0].playedSeconds, 0.5);
  assert.equal(app.video.paused, true);
  await app.step(120);
  assert.equal(app.messages.filter(m => m.type === 'PLAYER_DONE').length, 1);
});

test('終端へのシークだけでは実再生とみなさない', async () => {
  const app = await setup();
  await app.step(119);
  assert.equal(app.messages.some(m => m.type === 'PLAYER_DONE'), false);
});

test('短い動画は冒頭から、長さ未確定ならシークせず待つ', async () => {
  const short = await setup(4);
  assert.equal(short.video.currentTime, 0);
  await short.step(0.5, 500);
  assert.equal(short.messages.filter(m => m.type === 'PLAYER_DONE').length, 1);
  const loading = await setup(NaN);
  assert.equal(loading.video.currentTime, 0);
  loading.video.duration = 120;
  await loading.step(1);
  assert.equal(loading.video.currentTime, 115);
});
