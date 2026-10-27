/**
 * Minimal Scryfall API client (https://scryfall.com/docs/api).
 *
 * Scryfall asks for a descriptive User-Agent and Accept header, and for
 * 50–100 ms between requests.
 */
const API = 'https://api.scryfall.com';
const HEADERS = {
  'User-Agent': 'planeswalker-card-import/0.1 (+https://github.com/abedley/planeswalker)',
  Accept: 'application/json',
};
const REQUEST_GAP_MS = 150;
/** Most cards Scryfall's collection endpoint takes in one request. */
const COLLECTION_SIZE = 75;

let lastRequest = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url, { method = 'GET', body: payload } = {}, retried = false) {
  const wait = lastRequest + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: payload ? { ...HEADERS, 'Content-Type': 'application/json' } : HEADERS,
      body: payload ? JSON.stringify(payload) : undefined,
    });
  } catch (error) {
    throw new Error(`Couldn't reach Scryfall (${error.cause?.message ?? error.message}). Check your network connection.`);
  }
  // Rate limited: wait as asked (or a minute), then try once more.
  if (response.status === 429 && !retried) {
    const seconds = Number(response.headers.get('retry-after')) || 61;
    console.warn(`Scryfall asked us to slow down; waiting ${seconds}s.`);
    await sleep(seconds * 1000);
    return getJson(url, { method, body: payload }, true);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.details ?? `Scryfall returned HTTP ${response.status} for ${url}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

/** Looks a card up by its exact name; with `set` (e.g. "m21"), that set's printing. */
export function fetchCardByName(name, set) {
  return getJson(`${API}/cards/named?exact=${encodeURIComponent(name)}${set ? `&set=${encodeURIComponent(set)}` : ''}`);
}

/**
 * Many cards at once (https://scryfall.com/docs/api/cards/collection), 75 per
 * request: `identifiers` are `{ name, set? }` or `{ id }` (a Scryfall id). Returns `{ cards, notFound }`.
 */
export async function fetchCollection(identifiers) {
  const cards = [];
  const notFound = [];
  for (let i = 0; i < identifiers.length; i += COLLECTION_SIZE) {
    const chunk = identifiers.slice(i, i + COLLECTION_SIZE).map(({ id, name, set }) => (id ? { id } : set ? { name, set } : { name }));
    const page = await getJson(`${API}/cards/collection`, { method: 'POST', body: { identifiers: chunk } });
    cards.push(...page.data);
    notFound.push(...page.not_found);
  }
  return { cards, notFound };
}

/**
 * Runs a Scryfall search (https://scryfall.com/docs/syntax), following every page.
 * `unique` is Scryfall's: 'cards' (one printing of each), 'art' or 'prints'.
 */
export async function searchCards(query, { unique = 'cards' } = {}) {
  const cards = [];
  let url = `${API}/cards/search?unique=${unique}&q=${encodeURIComponent(query)}`;
  while (url) {
    const page = await getJson(url);
    cards.push(...page.data);
    url = page.has_more ? page.next_page : null;
  }
  return cards;
}
