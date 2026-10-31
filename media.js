/* Looks for actual HTML5 playback. It does NOT forge any watch-history requests. */
(() => {
  'use strict';
  if (self === top && location.pathname !== '/animestore/cd_pc') return;
  if (globalThis.__dAnimeCompletionHelperMediaScript) return;
  globalThis.__dAnimeCompletionHelperMediaScript = true;
  let episode = null;
  let video = null;
  let measured = 0;
  let lastTime = null;
  let lastClock = 0;
  let lastReport = 0;
  let activated = false;
  let completed = false;
  let playError = '';
  let checking = false;
  let tailPrepared = false;

  function findVideos(root) {
    const found = [...root.querySelectorAll('video')];
    for (const e of root.querySelectorAll('*')) {
      if (e.shadowRoot) found.push(...findVideos(e.shadowRoot));
    }
    return found;
  }
  function status(text) {
    if (!episode || Date.now() - lastReport < 2500) return;
    lastReport = Date.now();
    chrome.runtime.sendMessage({ type: 'PLAYER_PROGRESS', partId: episode.partId, progress: text }).catch(() => {});
  }
  function monitorPlayback() {
    if (!episode || completed || !video || !tailPrepared) return;
    const now = performance.now();
    const position = video.currentTime;
    if (lastTime !== null && !video.paused && !video.seeking && video.readyState >= 2 && Number.isFinite(position)) {
      const advance = position - lastTime;
      const wall = (now - lastClock) / 1000;
      // Reject seeks: only count time that truly advanced while playing.
      if (advance > 0 && advance <= Math.max(2.5, wall * 2.1) && wall > 0 && wall < 4.5) {
        measured += Math.min(advance, wall);
      }
    }
    lastTime = position;
    lastClock = now;
    status(`終盤を再生中（残り${Math.ceil(Math.max(0, video.duration - position))}秒）`);
    if ((video.ended || position >= video.duration - 1) && measured >= Math.min(10, video.duration / 2)) {
      completed = true;
      video.pause();
      chrome.runtime.sendMessage({ type: 'PLAYER_DONE', partId: episode.partId,
        playedSeconds: measured, position, mediaDuration: video.duration }).then(response => {
        if (!response?.ok) { completed = false; status(response?.error || '完了を確認できません'); }
      }).catch(() => { completed = false; });
    }
  }
  async function tryPlay() {
    if (!video || !episode || completed || !video.paused) return;
    // Muted autoplay is normally permitted by Chrome. It can still require a click on some players.
    if (!activated) { video.muted = true; activated = true; }
    try {
      await video.play();
      playError = '';
    } catch (e) {
      playError = e?.name === 'NotAllowedError' ? '再生ボタンを押してください' : '再生準備中';
    }
  }
  async function tick() {
    if (checking || completed) return;
    checking = true;
    try {
      if (!episode) {
        const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_EPISODE' });
        episode = response?.episode || null;
        if (!episode) return;
        status('動画を読み込み中');
      }
      if (!video || !video.isConnected) {
        const candidates = findVideos(document).filter(v => v instanceof HTMLVideoElement);
        video = candidates.find(v => v.readyState > 0) || candidates[0] || null;
        lastTime = null;
        tailPrepared = false; measured = 0; activated = false;
        if (video) video.addEventListener('timeupdate', monitorPlayback);
      }
      if (!video) { status('動画プレーヤーを探索中'); return; }
      if (!tailPrepared) {
        if (!Number.isFinite(video.duration) || video.duration <= 0 || video.readyState < 1) {
          await tryPlay(); status('動画の長さを確認中'); return;
        }
        video.currentTime = Math.max(0, video.duration - 30);
        tailPrepared = true; lastTime = null;
      }
      if (video.paused) {
        await tryPlay();
        status(playError || '再生開始を確認中');
      }
      monitorPlayback();
    } catch (_) { /* navigation/extension shutdown */ }
    finally { checking = false; }
  }
  // This file runs in every frame on the d-anime origin. Only the tab selected by the worker starts playback.
  tick();
  const timer = setInterval(() => {
    if (completed) { clearInterval(timer); return; }
    tick();
  }, 1000);
})();
