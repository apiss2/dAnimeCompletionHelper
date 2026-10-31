/* Network-only experimental worker. Never opens a playback tab. */
'use strict';
importScripts('history.js');
const STORE = 'rangePlayerJob';
let activeRun = null;
let lock = Promise.resolve();
function exclusive(fn) {
  const next = lock.then(fn, fn);
  lock = next.catch(() => {});
  return next;
}
function workIdFor(sender) {
  try {
    const url = new URL(sender.tab.url);
    const id = url.searchParams.get('workId');
    if (sender.frameId && sender.frameId !== 0) return null;
    return url.origin === 'https://animestore.docomo.ne.jp' && url.pathname === '/animestore/ci_pc' &&
      /^\d{5}$/.test(id || '') ? id : null;
  } catch (_) { return null; }
}
async function getJob() { return (await chrome.storage.session.get(STORE))[STORE] || null; }
async function putJob(job) {
  await chrome.storage.session.set({ [STORE]: job });
  chrome.action.setBadgeText({ text: job.status === 'running' ? `${job.index + 1}/${job.items.length}` :
    job.status === 'error' ? '!' : '' }).catch(() => {});
  const tabs = await chrome.tabs.query({ url: 'https://animestore.docomo.ne.jp/animestore/ci_pc*' });
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'JOB_CHANGED', job }).catch(() => {});
}
async function run(job, controller) {
  try {
    while (job.index < job.items.length) {
      controller.signal.throwIfAborted();
      job.progress = '視聴履歴を更新・照会中';
      await putJob(job);
      await DAnimeHistory.complete(job.items[job.index].partId, controller.signal);
      controller.signal.throwIfAborted();
      job.index++;
    }
    job.status = 'done'; job.progress = '';
  } catch (e) {
    job.status = controller.signal.aborted ? 'cancelled' : 'error';
    job.error = controller.signal.aborted ? '' : e.message;
    job.progress = '';
  }
  await putJob(job);
  if (job.status === 'done') {
    try {
      const tab = await chrome.tabs.get(job.sourceTabId);
      if (workIdFor({ tab }) === job.workId) await chrome.tabs.reload(job.sourceTabId);
    } catch (_) { /* The source tab may have closed; history updates are already complete. */ }
  }
}
async function createJob(message, sender) {
  const workId = workIdFor(sender);
  if (!workId || workId !== message.workId) throw new Error('対象の作品ページから開始してください。');
  if (activeRun) throw new Error('別の登録処理が実行中です。');
  if (!Array.isArray(message.items) || message.items.length < 1 || message.items.length > 300) {
    throw new Error('話数の指定が不正です。');
  }
  const items = [];
  const seen = new Set();
  let previous = 0;
  for (const item of message.items) {
    if (!Number.isInteger(item.number) || item.number <= previous || item.number > 9999 ||
        typeof item.partId !== 'string' || !/^\d{8}$/.test(item.partId) ||
        !item.partId.startsWith(workId) || seen.has(item.partId)) throw new Error('話数または話IDが不正です。');
    items.push({ number: item.number, partId: item.partId });
    previous = item.number; seen.add(item.partId);
  }
  const job = { workId, sourceTabId: sender.tab.id, items, index: 0, status: 'running', progress: '開始しています', error: '' };
  await putJob(job);
  const controller = new AbortController();
  const current = { job, controller, promise: null };
  activeRun = current;
  current.promise = run(job, controller).catch(() => {}).finally(() => { if (activeRun === current) activeRun = null; });
  return job;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message.type !== 'string') return;
  const task = exclusive(async () => {
    const workId = workIdFor(sender);
    if (!workId) throw new Error('作品ページから操作してください。');
    if (message.type === 'START_JOB') return { ok: true, job: await createJob(message, sender) };
    if (message.type === 'CANCEL_JOB') {
      if (activeRun && activeRun.job.workId !== workId) throw new Error('実行中の作品ページから停止してください。');
      const current = activeRun;
      if (current) { current.controller.abort(); await current.promise; }
      return { ok: true, job: await getJob() };
    }
    if (message.type === 'GET_STATUS') {
      const job = await getJob();
      if (job?.status === 'running' && !activeRun) {
        job.status = 'error'; job.progress = '';
        job.error = '拡張機能が再起動したため停止しました。サイトの登録状態を確認してください。';
        await putJob(job);
      }
      return { ok: true, job: job?.workId === workId ? job : null };
    }
    return { ok: false, error: '不明な処理です。' };
  });
  task.then(respond, () => respond({ ok: false, error: '処理を開始・取得できませんでした。入力とログイン状態を確認してください。' }));
  return true;
});
chrome.action.onClicked.addListener(tab => {
  if (workIdFor({ tab })) chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => {});
});
