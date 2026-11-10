// @ts-check
// Сайты — постоянные вкладки. Список задаётся строкой: «Имя=https://адрес/» или просто адрес, через запятую.

/** @typedef {{ name: string, url: string, host: string }} Site */
/** @typedef {{ id: string, url: string }} PageRef */
/** @typedef {{ site: Site, id: string | null, navigate: boolean }} SiteClaim id null — открыть новую вкладку */

export const DEFAULT_SITES = "Claude=https://claude.ai/,Алиса=https://alice.yandex.ru/,ChatGPT=https://chatgpt.com/";

/** @param {string} entry @returns {Site} */
function parseSite(entry) {
  const named = /^([^=/:]+)=(.+)$/.exec(entry);
  const url = new URL(named ? named[2] : entry);
  return { name: named ? named[1].trim() : url.hostname, url: url.href, host: url.hostname };
}

/** @param {string} value @returns {Site[]} */
export const parseSites = (value) => value.split(",").map((s) => s.trim()).filter(Boolean).map(parseSite);

/** @param {string} url @param {string} host */
export function hostMatches(url, host) {
  try {
    const { hostname } = new URL(url);
    return hostname === host || hostname.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

// Вкладки, оставшиеся с прошлого запуска: своя вкладка — сайту с тем же адресом, чужие переиспользуются под
// сайты без вкладки, лишние закрываются.
/** @param {Site[]} sites @param {PageRef[]} pages @returns {{ claims: SiteClaim[], extra: string[] }} */
export function planSites(sites, pages) {
  const free = [...pages];
  /** @param {(p: PageRef) => boolean} pred */
  const take = (pred) => {
    const i = free.findIndex(pred);
    return i < 0 ? null : free.splice(i, 1)[0];
  };
  const own = sites.map((site) => ({ site, page: take((p) => hostMatches(p.url, site.host)) }));
  const claims = own.map(({ site, page }) => ({ site, id: page?.id ?? take(() => true)?.id ?? null, navigate: !page }));
  return { claims, extra: free.map((p) => p.id) };
}
