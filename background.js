/* Manifest V3 service worker: serialized, resumable tab workflow. */
'use strict';
const STORE = 'rangePlayerJob';
let lock = Promise.resolve();
function exclusive(fn) {
  const next = lock.then(fn, fn);
  lock = next.catch(() => {});
  return next;
}
const allowedWork = url => {
  try {
    const u = new URL(url);
    return u.origin === 'https://animestore.docomo.ne.jp' &&
      u.pathname === '/animestore/ci_pc' && /^\d+$/.test(u.searchParams.get('workId') || '');
  } catch (_) { return false; }
};
function episodeUrl(partId) {
  return `https://animestore.docomo.ne.jp/animestore/sc_d_pc?partId=${partId}`;
}
async function getJob() { return (await chrome.storage.session.get(STORE))[STORE] || null; }
async function putJob(job) {
  await chrome.storage.session.set({ [STORE]: job });
  chrome.action.setBadgeText({ text: job.status === 'running' ? `${job.index + 1}/${job.items.length}` :
    job.status === 'error' ? '!' : '' }).catch(() => {});
  chrome.tabs.query({ url: 'https://animestore.docomo.ne.jp/animestore/ci_pc*' }).then(tabs => {
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'JOB_CHANGED', job }).catch(() => {});
  }).catch(() => {});
}
async function stopWithError(job, error) {
  job.status = 'error'; job.error = error; job.progress = '';
  await putJob(job);
}
async function advance(job) {
  job.index++;
  job.progress = 'ページを読み込み中';
  job.openedAt = Date.now();
  if (job.index >= job.items.length) {
    job.status = 'done';
    await putJob(job);
    return;
  }
  await putJob(job);
  try {
    await chrome.tabs.update(job.tabId, { url: job.items[job.index].url, active: true });
  } catch (_) { await stopWithError(job, '再生タブを開けませんでした。'); }
}
async function createJob(message, sender) {
  if (!sender.tab || !allowedWork(sender.tab.url)) throw new Error('dアニメストアの作品ページで開始してください。');
  const workId = new URL(sender.tab.url).searchParams.get('workId');
  if (workId !== message.workId) throw new Error('作品ページが一致しません。');
  if (!Array.isArray(message.items) || message.items.length < 1 || message.items.length > 300) throw new Error('話数の指定が不正です。');
  const items = [];
  let previous = 0;
  const seen = new Set();
  for (const item of message.items) {
    if (!Number.isInteger(item.number) || item.number <= previous || item.number > 9999 ||
        !/^\d{5,16}$/.test(String(item.partId)) ||
        item.url !== episodeUrl(item.partId) || seen.has(item.partId)) {
      throw new Error('話数またはURLが不正です。');
    }
    seen.add(item.partId); previous = item.number;
    items.push({ number: item.number, partId: item.partId, url: episodeUrl(item.partId) });
  }
  const existing = await getJob();
  if (existing?.status === 'running') throw new Error('別の再生処理が実行中です。');
  const job = {
    workId, title: String(message.title || '').slice(0, 120), items,
    index: 0, status: 'running',
    progress: 'ページを読み込み中', error: '', tabId: null, openedAt: Date.now()
  };
  await putJob(job);
  try {
    const tab = await chrome.tabs.create({ url: items[0].url, active: true });
    job.tabId = tab.id;
    job.openedAt = Date.now();
    await putJob(job);
    await chrome.alarms.create('danimeJobCheck', { periodInMinutes: 1 });
    return job;
  } catch (e) {
    await stopWithError(job, `再生タブを開けませんでした：${e.message}`);
    throw e;
  }
}
async function currentEpisodeForSender(sender) {
  const job = await getJob();
  if (!job || job.status !== 'running' || sender.tab?.id !== job.tabId) return null;
  const expected = job.items[job.index];
  try {
    const tab = await chrome.tabs.get(job.tabId);
    const main = new URL(tab.url || '');
    // A frame's URL may differ from the player URL, but the top-level tab must be the intended episode.
    if (main.origin !== 'https://animestore.docomo.ne.jp' ||
        main.pathname !== '/animestore/sc_d_pc' || main.searchParams.get('partId') !== expected.partId) return null;
  } catch (_) { return null; }
  return job;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message.type !== 'string') return;
  const read = ['GET_STATUS', 'GET_ACTIVE_EPISODE'].includes(message.type);
  const task = read ? (async () => {
    if (message.type === 'GET_STATUS') return { ok: true, job: await getJob() };
    const job = await currentEpisodeForSender(sender);
    return { ok: true, episode: job ? {
      partId: job.items[job.index].partId,
      number: job.items[job.index].number,
      tabId: job.tabId
    } : null };
  })() : exclusive(async () => {
    if (message.type === 'START_JOB') return { ok: true, job: await createJob(message, sender) };
    if (message.type === 'CANCEL_JOB') {
      if (!allowedWork(sender.tab?.url)) throw new Error('作品ページから停止してください。');
      const job = await getJob();
      if (job?.status === 'running') {
        job.status = 'cancelled'; job.progress = '';
        await putJob(job);
        if (Number.isInteger(job.tabId)) chrome.tabs.remove(job.tabId).catch(() => {});
      }
      return { ok: true, job };
    }
    if (message.type === 'PLAYER_PROGRESS' || message.type === 'PLAYER_DONE') {
      const job = await currentEpisodeForSender(sender);
      if (!job || message.partId !== job.items[job.index].partId) return { ok: false, error: '古い再生ページです。' };
      if (message.type === 'PLAYER_PROGRESS') {
        const value = String(message.progress || '').slice(0, 90);
        if (job.progress !== value) { job.progress = value; await putJob(job); }
      } else {
        const { playedSeconds, position, mediaDuration } = message;
        if (![playedSeconds, position, mediaDuration].every(Number.isFinite) || mediaDuration <= 0 ||
            playedSeconds < Math.min(0.5, mediaDuration / 2) || position < Math.max(0, mediaDuration - 5) ||
            position > mediaDuration + 1) return { ok: false, error: '終盤の再生を確認できません。' };
        await advance(job);
      }
      return { ok: true };
    }
    return { ok: false, error: '不明な処理です。' };
  });
  task.then(respond, e => respond({ ok: false, error: e.message || String(e) }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  exclusive(async () => {
    const job = await getJob();
    if (job?.status === 'running' && job.tabId === tabId) await stopWithError(job, '再生タブが閉じられました。');
  }).catch(() => {});
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'danimeJobCheck') return;
  exclusive(async () => {
    const job = await getJob();
    if (!job || job.status !== 'running') {
      chrome.alarms.clear('danimeJobCheck').catch(() => {});
      return;
    }
    if (Date.now() - job.openedAt > 150000) {
      await stopWithError(job, '再生を確認できませんでした。再生ページの表示とログイン状態を確認してください。');
    }
  }).catch(() => {});
});
chrome.action.onClicked.addListener(tab => {
  if (!allowedWork(tab.url)) {
    chrome.action.setBadgeText({ tabId: tab.id, text: '作品' }).catch(() => {});
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => {});
});
