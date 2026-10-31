/* Work detail page UI. Only chosen episode IDs are sent to the worker. */
(() => {
  'use strict';
  if (!new URL(location.href).searchParams.get('workId')) return;
  if (document.getElementById('danime-completion-helper-root')) return;
  const helpers = globalThis.DAnimeEpisodes;
  const workId = new URL(location.href).searchParams.get('workId');
  const entries = [];
  for (const a of document.querySelectorAll('.episodeContainer a[href*="cd_pc"]')) {
    const item = helpers.parseEpisodeLink(a.href);
    if (item && item.partId.startsWith(workId)) {
      item.label = [a.querySelector('.number')?.textContent.trim(), a.querySelector('.line2')?.textContent.trim()]
        .filter(Boolean).join(' ');
      entries.push(item);
    }
  }
  const episodes = helpers.numberEpisodes(entries);
  if (!episodes.length) return;

  const root = document.createElement('div');
  root.id = 'danime-completion-helper-root';
  const shadow = root.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
  :host { all: initial; display:block; min-width:0; max-width:100%; margin-top:4px; font: 12px/1.5 -apple-system,BlinkMacSystemFont,"Yu Gothic",Meiryo,sans-serif; color:#333; text-align:right; }
  * { box-sizing: border-box; }
  .launcher { background:#fff8df; color:#594300; border:1px solid #c7a340;
    max-width:100%; border-radius:3px; font-size:12px; font-weight:600; padding:6px 12px; }
  .launcher:hover { background:#ffefb3; border-color:#9b7400; }
  .launcher:focus-visible { outline:2px solid #9b7400; outline-offset:2px; }
  .panel { width:100%; max-width:320px; margin:4px 0 0 auto; padding:10px;
    text-align:left; background:#fafafa; border:1px solid #e5e5e5; border-radius:3px; }
  .line { display:flex; gap:10px; align-items:center; margin-bottom:10px; }
  label { flex:1; min-width:0; font-size:12px; font-weight:600; }
  select { display:block; width:100%; padding:7px; margin-top:3px; border:1px solid #b8c4d1;
    border-radius:7px; font:inherit; background:#fff; color:#222; }
  button { cursor:pointer; padding: 9px 12px; border:0; border-radius:8px; font:inherit; font-weight:600; }
  button:disabled { opacity:0.5; cursor:not-allowed; }
  .primary { background:#f5b900; color:#333; flex:1; }
  .stop { background:#f1f3f5; color:#333; }
  .controls { display:flex; gap:8px; }
  .status { font-size:12px; white-space:pre-wrap; overflow-wrap:anywhere;
    border-radius:8px; background:#f2f6fc; padding:10px; margin-bottom:10px; }
  .error { color:#a32628; }
  [hidden] { display:none !important; }
  `;
  shadow.appendChild(style);
  const panel = document.createElement('section');
  panel.className = 'panel';
  const inner = document.createElement('div');
  const fields = document.createElement('div');
  fields.className = 'line';
  function field(labelText, value) {
    const label = document.createElement('label');
    label.textContent = labelText;
    const select = document.createElement('select');
    for (const item of episodes) {
      const option = document.createElement('option');
      option.value = String(item.number);
      option.textContent = item.label || `${item.number}番目`;
      select.appendChild(option);
    }
    select.value = String(value);
    label.appendChild(select);
    return { label, select };
  }
  const from = field('開始話', episodes[0].number);
  const to = field('終了話', episodes[episodes.length - 1].number);
  fields.append(from.label, to.label);
  const status = document.createElement('div');
  status.className = 'status';
  status.hidden = true;
  status.setAttribute('role', 'status');
  const controls = document.createElement('div');
  controls.className = 'controls';
  const start = document.createElement('button');
  start.className = 'primary'; start.textContent = '登録';
  const cancel = document.createElement('button');
  cancel.className = 'stop'; cancel.textContent = '停止'; cancel.disabled = true;
  controls.append(start, cancel);
  inner.append(fields, status, controls);
  const launcher = document.createElement('button');
  launcher.className = 'launcher'; launcher.textContent = 'まとめて視聴済み登録';
  launcher.setAttribute('aria-expanded', 'false');
  panel.append(inner); shadow.append(launcher, panel);
  function placeRoot() {
    const counts = [...document.querySelectorAll('.favoriteCount')];
    const anchor = counts.find(e => e.getClientRects().length) || counts[0];
    // The compact layout's information row is a non-wrapping flex container.
    if (anchor) (anchor.closest('.titleInformationWrap') || anchor.parentElement).after(root);
    else document.querySelector('h1')?.after(root);
  }
  placeRoot();
  window.addEventListener('resize', placeRoot);

  let shown = false;
  function setVisible(value) {
    shown = value;
    panel.hidden = !value;
    launcher.setAttribute('aria-expanded', String(value));
    if (value) from.select.focus();
    else launcher.focus();
  }
  panel.hidden = true;
  launcher.addEventListener('click', () => setVisible(!shown));
  shadow.addEventListener('keydown', e => { if (e.key === 'Escape') setVisible(false); });
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'TOGGLE_PANEL') setVisible(!shown);
    if (message.type === 'JOB_CHANGED') showJob(message.job);
  });

  function showJob(job) {
    if (!job || job.workId !== workId) {
      status.hidden = true;
      start.disabled = false; cancel.disabled = true;
      return;
    }
    const total = job.items.length;
    status.hidden = false;
    const num = job.items[job.index]?.number;
    const episode = episodes.find(item => item.partId === job.items[job.index]?.partId);
    const done = Math.min(job.index, total);
    let line = `${done} / ${total} 話を視聴済み確認済み`;
    if (job.status === 'running') line += `\n${episode?.label || `${num}番目`}：${job.progress || '読み込み中'}`;
    if (job.status === 'error') line += `\n停止：${job.error || '原因不明'}`;
    if (job.status === 'done') line += '\n全範囲の視聴済み登録を確認しました。';
    if (job.status === 'cancelled') line += '\n中断しました。';
    status.textContent = line;
    status.classList.toggle('error', job.status === 'error');
    const running = job.status === 'running';
    start.disabled = running; cancel.disabled = !running;
    from.select.disabled = running; to.select.disabled = running;
  }
  start.addEventListener('click', async () => {
    status.hidden = false;
    const first = Number(from.select.value), last = Number(to.select.value);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first > last ||
        first < 1 || last > episodes.length) {
      status.textContent = '開始話と終了話を正しく指定してください。';
      return;
    }
    const items = episodes.slice(first - 1, last);
    start.disabled = true;
    status.textContent = `${items.length}話の処理を開始しています。`;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'START_JOB', workId, items });
      if (!response?.ok) throw new Error(response?.error || '開始できませんでした。');
      showJob(response.job);
    } catch (e) { start.disabled = false; status.textContent = e.message; }
  });
  cancel.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CANCEL_JOB' });
      if (!response?.ok) throw new Error(response?.error || '停止できませんでした。');
      showJob(response.job);
    } catch (e) { status.hidden = false; status.textContent = e.message; }
  });
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }).then(r => showJob(r?.job)).catch(() => {});
})();
