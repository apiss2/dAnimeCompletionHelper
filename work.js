/* Work detail page UI. Only the chosen episode URLs are sent to the worker. */
(() => {
  'use strict';
  if (!new URL(location.href).searchParams.get('workId')) return;
  if (document.getElementById('danime-completion-helper-root')) return;
  const helpers = globalThis.DAnimeEpisodes;
  const workId = new URL(location.href).searchParams.get('workId');
  const entries = [];
  for (const a of document.querySelectorAll('a[href*="cd_pc"]')) {
    const src = a.textContent + ' ' + (a.querySelector('img')?.alt || '') + ' ' + (a.title || '');
    const item = helpers.parseEpisodeLink(a.href, src);
    if (item) entries.push(item);
  }
  const episodes = helpers.dedupeAndSort(entries);
  if (!episodes.length) return;
  const title = (document.title || '').split('|')[0].trim().slice(0, 120);

  const root = document.createElement('div');
  root.id = 'danime-completion-helper-root';
  const shadow = root.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
  :host { all: initial; font: 14px/1.5 -apple-system,BlinkMacSystemFont,"Yu Gothic",Meiryo,sans-serif; color: #20242b; }
  * { box-sizing: border-box; }
  .panel { position: fixed; z-index: 2147483646; bottom: 20px; right: 22px; width: 328px;
    max-width: calc(100vw - 24px); padding: 17px; background: #fff; border: 1px solid #d7dee7;
    box-shadow: 0 9px 30px #1d335b33; border-radius: 13px; }
  .heading { display:flex; justify-content:space-between; align-items:center; gap:10px; font-size:15px; font-weight:700; }
  .subtitle { font-size:12px; color:#637084; margin: 6px 0 12px; }
  .line { display:flex; gap:10px; align-items:center; margin-bottom:10px; }
  label { flex:1; font-size:12px; font-weight:600; }
  input { display:block; width:100%; padding:7px; margin-top:3px; border:1px solid #b8c4d1;
    border-radius:7px; font:inherit; background:#fff; color:#222; }
  button { cursor:pointer; padding: 9px 12px; border:0; border-radius:8px; font:inherit; font-weight:600; }
  button:disabled { opacity:0.5; cursor:not-allowed; }
  .primary { background:#2457ad; color:white; flex:1; }
  .stop { background:#f1f3f5; color:#333; }
  .controls { display:flex; gap:8px; }
  .hint { margin:10px 0 0; font-size:11px; color:#69778b; line-height:1.6; }
  .status { font-size:12px; white-space:pre-wrap; overflow-wrap:anywhere;
    border-radius:8px; background:#f2f6fc; padding:10px; margin-bottom:10px; }
  .error { color:#a32628; }
  .tiny { padding:2px 8px; background:transparent; color:#526076; }
  [hidden] { display:none !important; }
  `;
  shadow.appendChild(style);
  const panel = document.createElement('section');
  panel.className = 'panel';
  const heading = document.createElement('div');
  heading.className = 'heading';
  const headingText = document.createElement('span');
  headingText.textContent = 'dAnimeCompletionHelper';
  const toggle = document.createElement('button');
  toggle.className = 'tiny';
  toggle.textContent = '閉じる';
  heading.append(headingText, toggle);
  const inner = document.createElement('div');
  const subtitle = document.createElement('p');
  subtitle.className = 'subtitle';
  subtitle.textContent = `${title}｜検出 ${episodes.length} 話`;
  const fields = document.createElement('div');
  fields.className = 'line';
  function field(labelText, value, min, max) {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'number'; input.min = String(min); input.max = String(max);
    input.step = '1'; input.value = String(value);
    label.appendChild(input);
    return { label, input };
  }
  const from = field('開始話', episodes[0].number, 1, 9999);
  const to = field('終了話', episodes[episodes.length - 1].number, 1, 9999);
  fields.append(from.label, to.label);
  const secondsRow = document.createElement('div');
  secondsRow.className = 'line';
  const seconds = field('各話の再生秒数（実再生）', 15, 5, 60);
  secondsRow.append(seconds.label);
  const status = document.createElement('div');
  status.className = 'status';
  status.textContent = '開始話と終了話を指定してください。';
  const controls = document.createElement('div');
  controls.className = 'controls';
  const start = document.createElement('button');
  start.className = 'primary'; start.textContent = '指定範囲を再生';
  const cancel = document.createElement('button');
  cancel.className = 'stop'; cancel.textContent = '停止'; cancel.disabled = true;
  controls.append(start, cancel);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = '別タブで各話を無音再生し、再生進行を確認してから次の話へ移動します。視聴済み登録はサイト側の判定によるため、結果は別途確認してください。';
  inner.append(subtitle, fields, secondsRow, status, controls, hint);
  panel.append(heading, inner); shadow.appendChild(panel); document.documentElement.appendChild(root);

  let shown = true;
  function setVisible(value) {
    shown = value;
    inner.hidden = !value;
    toggle.textContent = value ? '閉じる' : '開く';
  }
  toggle.addEventListener('click', () => setVisible(!shown));
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'TOGGLE_PANEL') setVisible(!shown);
    if (message.type === 'JOB_CHANGED') showJob(message.job);
  });

  function showJob(job) {
    if (!job || job.workId !== workId) {
      status.textContent = '開始話と終了話を指定してください。';
      start.disabled = false; cancel.disabled = true;
      return;
    }
    const total = job.items.length;
    const num = job.items[job.index]?.number;
    const done = Math.min(job.index, total);
    let line = `${done} / ${total} 話を再生確認済み`;
    if (job.status === 'running') line += `\n第${num}話：${job.progress || '読み込み中'}`;
    if (job.status === 'error') line += `\n停止：${job.error || '原因不明'}`;
    if (job.status === 'done') line += '\n全範囲の再生確認が終了しました。';
    if (job.status === 'cancelled') line += '\n中断しました。';
    status.textContent = line;
    status.classList.toggle('error', job.status === 'error');
    const running = job.status === 'running';
    start.disabled = running; cancel.disabled = !running;
  }
  start.addEventListener('click', async () => {
    const first = Number(from.input.value), last = Number(to.input.value), duration = Number(seconds.input.value);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first > last ||
        first < 1 || last > 9999 || !Number.isInteger(duration) || duration < 5 || duration > 60) {
      status.textContent = '開始話、終了話、再生秒数を正しく指定してください。';
      return;
    }
    const items = episodes.filter(item => item.number >= first && item.number <= last);
    if (items.length !== last - first + 1) {
      const missing = [];
      const found = new Set(items.map(item => item.number));
      for (let n = first; n <= last && missing.length < 8; n++) if (!found.has(n)) missing.push(n);
      status.textContent = `範囲内に未検出の話があります：${missing.map(n => `第${n}話`).join('、')}`;
      return;
    }
    start.disabled = true;
    status.textContent = `${items.length}話の処理を開始しています。`;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'START_JOB', workId, title, items, duration });
      if (!response?.ok) throw new Error(response?.error || '開始できませんでした。');
      showJob(response.job);
    } catch (e) { start.disabled = false; status.textContent = e.message; }
  });
  cancel.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CANCEL_JOB' });
  });
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }).then(r => showJob(r?.job)).catch(() => {});
})();
