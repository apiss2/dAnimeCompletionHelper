/* Episode identity comes from URLs; numbering follows the site's episode list. */
(function (root) {
  'use strict';
  function parseEpisodeLink(href) {
    let url;
    try { url = new URL(href, 'https://animestore.docomo.ne.jp'); }
    catch (_) { return null; }
    if (url.origin !== 'https://animestore.docomo.ne.jp' ||
        url.pathname !== '/animestore/cd_pc') return null;
    const id = url.searchParams.get('partId');
    if (!id || !/^\d{5,16}$/.test(id)) return null;
    return { partId: id, url: `https://animestore.docomo.ne.jp/animestore/sc_d_pc?partId=${id}` };
  }
  function numberEpisodes(list) {
    const map = new Map();
    for (const item of list) {
      if (item && !map.has(item.partId)) map.set(item.partId, item);
    }
    return [...map.values()].map((item, index) => ({ ...item, number: index + 1 }));
  }
  root.DAnimeEpisodes = { parseEpisodeLink, numberEpisodes };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DAnimeEpisodes;
})(typeof globalThis === 'object' ? globalThis : this);
