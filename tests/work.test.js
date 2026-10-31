const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const helpers = require('../episode-list.js');

async function setup() {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.attributes = {}; this.classList = { toggle() {} }; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); return child; }
    attachShadow() { return this.shadow = new Element('shadow'); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, fn) { this.events[name] = fn; }
    focus() {}
  }
  const fixtures = [
    { id: '28572013', number: '第13話', title: 'クリスマスイヴ' },
    { id: '28572014', number: 'request 14.', title: '冬の夜' },
    { id: '28572999', number: '', title: '特別編「休日」' }
  ];
  const anchors = fixtures.map(item => ({
    href: `https://animestore.docomo.ne.jp/animestore/cd_pc?partId=${item.id}`,
    querySelector(selector) { return { textContent: selector === '.number' ? item.number : item.title }; }
  }));
  let root;
  const messages = [];
  const context = {
    URL, location: { href: 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=28572' },
    DAnimeEpisodes: helpers, window: { addEventListener() {} },
    document: {
      getElementById() { return null; }, createElement: tag => new Element(tag),
      querySelectorAll(selector) {
        if (selector === '.episodeContainer a[href*="cd_pc"]') return anchors;
        if (selector === '.favoriteCount') return [{ getClientRects: () => [1], parentElement: { after(node) { root = node; } } }];
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
  return { messages, selects: elements.filter(e => e.tag === 'select'),
    start: elements.find(e => e.tag === 'button' && e.textContent === '登録'),
    status: elements.find(e => e.className === 'status') };
}

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
