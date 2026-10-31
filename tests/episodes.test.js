const { test } = require('node:test');
const assert = require('node:assert/strict');
const { numberFromText, parseEpisodeLink, dedupeAndSort } = require('../episode-list.js');
test('話数文字列を解析する', () => {
  assert.equal(numberFromText('第1話 正反対な君'), 1);
  assert.equal(numberFromText('正反対な君と僕_第１３話_2'), 13);
  assert.equal(numberFromText('第 25 話 最終話'), 25);
  assert.equal(numberFromText('第5回'), 5);
  assert.equal(numberFromText('エピソード（全25話）'), null);
});
test('dアニメストアのエピソードリンクのみを許可する', () => {
  assert.deepEqual(parseEpisodeLink('https://animestore.docomo.ne.jp/animestore/cd_pc?partId=28572013', '第13話'), {
    number: 13, partId: '28572013', url: 'https://animestore.docomo.ne.jp/animestore/sc_d_pc?partId=28572013'
  });
  assert.equal(parseEpisodeLink('https://example.com/animestore/cd_pc?partId=28572013','第13話'), null);
  assert.equal(parseEpisodeLink('https://animestore.docomo.ne.jp/animestore/ci_pc?partId=28572013','第13話'), null);
  assert.equal(parseEpisodeLink('javascript:void(0)','第13話'), null);
  assert.equal(parseEpisodeLink('https://animestore.docomo.ne.jp/animestore/cd_pc?partId=abc','第13話'), null);
});
test('重複する話を除去して話数順に並べる', () => {
  const input = [
    parseEpisodeLink('/animestore/cd_pc?partId=28572003','第3話'),
    parseEpisodeLink('/animestore/cd_pc?partId=28572001','第1話'),
    parseEpisodeLink('/animestore/cd_pc?partId=28572003','第3話')
  ];
  assert.deepEqual(dedupeAndSort(input).map(x => x.number), [1,3]);
});
