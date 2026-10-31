const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseEpisodeLink, numberEpisodes } = require('../episode-list.js');

test('dアニメストアのエピソードリンクのみを許可する', () => {
  assert.deepEqual(parseEpisodeLink('https://animestore.docomo.ne.jp/animestore/cd_pc?partId=28572013'), {
    partId: '28572013', url: 'https://animestore.docomo.ne.jp/animestore/sc_d_pc?partId=28572013'
  });
  for (const url of ['https://example.com/animestore/cd_pc?partId=28572013',
    '/animestore/ci_pc?partId=28572013', 'javascript:void(0)', '/animestore/cd_pc?partId=abc']) {
    assert.equal(parseEpisodeLink(url), null);
  }
});

test('表示文字列やIDの大小に依存せず、一覧順に重複を除いて採番する', () => {
  const first = parseEpisodeLink('/animestore/cd_pc?partId=28572013');
  const second = parseEpisodeLink('/animestore/cd_pc?partId=28572001');
  const third = parseEpisodeLink('/animestore/cd_pc?partId=28572999');
  const episodes = numberEpisodes([first, null, second, first, third]);
  assert.deepEqual(episodes.map(e => [e.number, e.partId]), [[1, '28572013'], [2, '28572001'], [3, '28572999']]);
  assert.deepEqual(numberEpisodes([]), []);
});

test('ホテル・インヒューマンズの一覧17件を表記解析なしで取得する', () => {
  const entries = Array.from({ length: 17 }, (_, index) =>
    parseEpisodeLink(`/animestore/cd_pc?partId=28099${String(index + 1).padStart(3, '0')}`));
  const episodes = numberEpisodes(entries);
  assert.deepEqual(episodes.map(e => e.number), Array.from({ length: 17 }, (_, i) => i + 1));
  assert.equal(episodes[16].partId, '28099017');
});
