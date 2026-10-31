/* Experimental network-only history workflow; Session URLs and tokens are never persisted or logged. */
(function (root) {
  'use strict';
  const BASE = 'https://animestore.docomo.ne.jp/animestore/rest/';
  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  async function request(url, options, signal) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 15000);
    try {
      const response = await fetch(url, { ...options, cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new Error('HTTP');
      return response;
    } catch (_) {
      signal.throwIfAborted();
      throw new Error('通信に失敗しました。ログイン状態と接続を確認してください。');
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
    }
  }
  async function api(endpoint, signal) {
    const response = await request(BASE + endpoint, { credentials: 'include' }, signal);
    let json;
    try { json = await response.json(); } catch (_) { throw new Error('APIの応答がJSONではありません。'); }
    if (json?.resultCd !== '00' && !(endpoint.startsWith('WS100107?') && json?.resultCd === '01')) {
      const code = /^[0-9]{1,3}$/.test(json?.resultCd) ? json.resultCd : '不明';
      throw new Error(`APIが処理を拒否しました（結果コード：${code}）。`);
    }
    return json.data;
  }
  async function viewed(partId, signal) {
    const data = await api('WS100107?workPartIdList=' + partId, signal);
    if (!Array.isArray(data?.workPartList)) throw new Error('視聴済み状態の応答形式を確認できません。');
    const item = data.workPartList.find(item => String(item.workPartId) === partId);
    if (!item || !['0', '1'].includes(item.viewed)) throw new Error('対象話の視聴済み状態を確認できません。');
    return item.viewed === '1';
  }
  function durationFromMeasure(measure) {
    const canonical = typeof measure === 'string' && measure.match(/^(?:(\d+)時間)?(?:(\d+)分)?(?:(\d+)秒)?$/);
    let seconds;
    if (canonical && canonical.slice(1).some(Boolean)) {
      seconds = Number(canonical[1] || 0) * 3600 + Number(canonical[2] || 0) * 60 + Number(canonical[3] || 0);
      if (Number(canonical[3] || 0) >= 60 || (canonical[1] && Number(canonical[2] || 0) >= 60)) {
        throw new Error('動画の再生時間が不正です。');
      }
    } else {
      // Legacy partMeasure can have garbled labels; preserve its ordered h/m/s digit groups.
      const fields = typeof measure === 'string' ? measure.match(/\d+/g)?.map(Number) : null;
      if (!fields || fields.length < 2 || fields.length > 3 || fields.slice(1).some(n => n >= 60)) {
        throw new Error('動画の再生時間を確認できません。');
      }
      seconds = fields.reduce((total, value) => total * 60 + value, 0);
    }
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 86400) throw new Error('動画の再生時間が不正です。');
    return seconds;
  }
  function resumeUrl(value) {
    let url;
    try { url = new URL(value); } catch (_) { throw new Error('更新先URLが不正です。'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
        !(url.hostname === 'animestore.docomo.ne.jp' || url.hostname.endsWith('.animestore.docomo.ne.jp'))) {
      throw new Error('更新先が許可済みのdアニメストア配下ではありません。');
    }
    return url;
  }
  async function complete(partId, signal) {
    if (!/^\d{8}$/.test(partId)) throw new Error('話IDが不正です。');
    if (await viewed(partId, signal)) return;
    const data = await api('WS010105?partId=' + partId + '&defaultPlay=5&viewType=2&mpVersion=', signal);
    if (String(data?.partId) !== partId || ![1, '1'].includes(data.multideviceState) || !data.resumeInfoUrl) {
      throw new Error('視聴履歴を更新できる再生情報がありません。');
    }
    const base = resumeUrl(data.resumeInfoUrl);
    const response = await request(BASE + 'WS030101?partId=' + partId, { credentials: 'include' }, signal);
    let detail;
    try { detail = await response.json(); } catch (_) { throw new Error('話情報の応答がJSONではありません。'); }
    if (detail.resultCd !== '1' || String(detail.partId) !== partId) throw new Error('話情報を取得できません。');
    const seconds = durationFromMeasure(detail.partMeasure);
    async function post(number, infoType, position, state) {
      const url = new URL(base);
      const params = { type: 'MEDIAPLAYER_RESUMEINFO', number: String(number).padStart(8, '0'),
        info_type: infoType, version: '1.0.0', content_id: partId, play_content_type: 0,
        resume_point: Math.floor(position * 1000), resume_point_lastupdate: Math.floor(Date.now() / 1000),
        playback_state: state };
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      await request(url.href, { method: 'POST', credentials: 'omit' }, signal);
    }
    // shortcut: mirrors the public player's start/end sequence, verify against authenticated traffic before adoption.
    await post(0, 0, 0, 3);
    await post(1, 2, seconds, 0);
    await delay(500, signal);
    await post(2, 2, 0, 0);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await viewed(partId, signal)) return;
      if (attempt < 2) await delay(500, signal);
    }
    throw new Error('送信後も視聴済みを確認できませんでした。処理を停止しました。');
  }
  root.DAnimeHistory = { complete, durationFromMeasure, resumeUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DAnimeHistory;
})(globalThis);
