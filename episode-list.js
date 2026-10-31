/* DOM-independent parsing helpers, also used by the automated tests. */
(function (root) {
  'use strict';
  function numberFromText(value) {
    const text = String(value || '').normalize('NFKC');
    const match = text.match(/第\s*(\d{1,4})\s*(?:話|回)/u);
    return match ? Number(match[1]) : null;
  }

  function parseEpisodeLink(href, text) {
    let url;
    try { url = new URL(href, 'https://animestore.docomo.ne.jp'); }
    catch (_) { return null; }
    if (url.origin !== 'https://animestore.docomo.ne.jp' ||
        url.pathname !== '/animestore/cd_pc') return null;
    const id = url.searchParams.get('partId');
    if (!id || !/^\d{5,16}$/.test(id)) return null;
    const number = numberFromText(text);
    if (!Number.isSafeInteger(number) || number < 1 || number > 9999) return null;
    // cd_pc links open the site's episode dialog; actual playback uses sc_d_pc.
    return { number, partId: id, url: `https://animestore.docomo.ne.jp/animestore/sc_d_pc?partId=${id}` };
  }

  function dedupeAndSort(list) {
    const map = new Map();
    for (const item of list) {
      if (!item || !Number.isSafeInteger(item.number) || map.has(item.number)) continue;
      map.set(item.number, item);
    }
    return [...map.values()].sort((a, b) => a.number - b.number);
  }

  root.DAnimeEpisodes = { numberFromText, parseEpisodeLink, dedupeAndSort };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DAnimeEpisodes;
})(typeof globalThis === 'object' ? globalThis : this);
