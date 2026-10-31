const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const helpers = require('../episode-list.js');

async function setup(fixtures, compact = false) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.attributes = {}; this.classList = { toggle() {} }; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); return child; }
    attachShadow() { return this.shadow = new Element('shadow'); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, fn) { this.events[name] = fn; }
    focus() {}
  }
  fixtures ||= [
    { id: '28572013', number: '第13話', title: 'クリスマスイヴ' },
    { id: '28572014', number: 'request 14.', title: '冬の夜' },
    { id: '28572999', number: '', title: '特別編「休日」' }
  ];
  const anchors = fixtures.map(item => ({
    href: `https://animestore.docomo.ne.jp/animestore/cd_pc?partId=${item.id}`,
    querySelector(selector) { return { textContent: selector === '.number' ? item.number : item.title }; }
  }));
  let root;
  let placement;
  const windowEvents = {};
  const compactRow = { after(node) { root = node; placement = 'after-information-row'; } };
  const countRow = { after(node) { root = node; placement = 'after-count-row'; } };
  const messages = [];
  const context = {
    URL, location: { href: 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=28572' },
    DAnimeEpisodes: helpers, window: { addEventListener(name, fn) { windowEvents[name] = fn; } },
    document: {
      getElementById() { return null; }, createElement: tag => new Element(tag),
      querySelectorAll(selector) {
        if (selector === '.episodeContainer a[href*="cd_pc"]') return anchors;
        if (selector === '.favoriteCount') return [{ getClientRects: () => [1], parentElement: countRow,
          closest: selector => compact && selector === '.titleInformationWrap' ? compactRow : null }];
        return [];
      }
    },
    chrome: { runtime: { onMessage: { addListener() {} }, async sendMessage(message) {
      messages.push(message);
      return message.type === 'START_JOB' ? { ok: true, job: {
        workId: '28572', items: message.items, index: 0, status: 'running', progress: '照会中'
      } } : { ok: true, job: null };
    } } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'work.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  function all(node) { return [node, ...node.children.flatMap(all)]; }
  const elements = all(root.shadow);
  return { messages, get placement() { return placement; },
    resize(value) { compact = value; windowEvents.resize(); },
    selects: elements.filter(e => e.tag === 'select'),
    launcher: elements.find(e => e.tag === 'button' && e.textContent === 'まとめて視聴済み登録'),
    start: elements.find(e => e.tag === 'button' && e.textContent === '登録'),
    status: elements.find(e => e.className === 'status') };
}

test('狭幅では横並びの情報行の外へ配置し、広幅では登録数の下へ配置する', async () => {
  const app = await setup(undefined, true);
  assert.equal(app.placement, 'after-information-row');
  app.selects[0].value = '2';
  app.resize(false);
  assert.equal(app.placement, 'after-count-row');
  app.resize(true);
  assert.equal(app.placement, 'after-information-row');
  assert.equal(app.selects[0].value, '2');
  assert.equal((await setup()).placement, 'after-count-row');
});

test('第25〜29話の一覧を開くと開始は第25話、終了は第29話が初期選択される', async () => {
  const fixtures = Array.from({ length: 5 }, (_, index) => ({
    id: `285720${index + 1}`, number: `第${index + 25}話`, title: `タイトル${index + 25}`
  }));
  const app = await setup(fixtures);
  app.launcher.events.click();
  const selectedText = select => select.children.find(option => option.value === select.value).textContent;
  assert.equal(selectedText(app.selects[0]), '第25話 タイトル25');
  assert.equal(selectedText(app.selects[1]), '第29話 タイトル29');
  await app.start.events.click();
  const message = app.messages.find(m => m.type === 'START_JOB');
  assert.equal(message.items.length, 5);
  assert.equal(message.items[0].partId, fixtures[0].id);
  assert.equal(message.items[4].partId, fixtures[4].id);
});

test('第13話から始まる一覧でも、実際の表記とタイトルを選択肢に表示する', async () => {
  const app = await setup();
  assert.deepEqual(app.selects[0].children.map(e => e.textContent), ['第13話 クリスマスイヴ', 'request 14. 冬の夜', '特別編「休日」']);
  assert.equal(app.selects[0].value, '1');
  assert.equal(app.selects[1].value, '3');
  await app.start.events.click();
  const message = app.messages.find(m => m.type === 'START_JOB');
  assert.equal(message.items[0].partId, '28572013');
  assert.ok(app.status.textContent.includes('第13話 クリスマスイヴ'));
});

test('独自表記から特別編まで、選択した範囲だけを登録する', async () => {
  const app = await setup();
  app.selects[0].value = '2';
  app.selects[1].value = '3';
  await app.start.events.click();
  assert.equal(app.messages.find(m => m.type === 'START_JOB').items.map(e => e.partId).join(','), '28572014,28572999');
  assert.ok(app.status.textContent.includes('request 14. 冬の夜'));
});

test('逆順や一覧にない値では開始しない', async () => {
  for (const [from, to] of [['3', '1'], ['0', '2'], ['1', '4'], ['bad', '2']]) {
    const app = await setup();
    app.selects[0].value = from; app.selects[1].value = to;
    await app.start.events.click();
    assert.equal(app.messages.some(m => m.type === 'START_JOB'), false);
  }
});
