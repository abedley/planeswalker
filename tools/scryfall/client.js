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
const REQUEST_GAP_MS = 100;

let lastRequest = 0;

async function getJson(url) {
  const wait = lastRequest + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequest = Date.now();
  let response;
  try {
    response = await fetch(url, { headers: HEADERS });
  } catch (error) {
    throw new Error(`Couldn't reach Scryfall (${error.cause?.message ?? error.message}). Check your network connection.`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.details ?? `Scryfall returned HTTP ${response.status} for ${url}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

/** Looks a card up by its exact name. */
export function fetchCardByName(name) {
  return getJson(`${API}/cards/named?exact=${encodeURIComponent(name)}`);
}

/** Runs a Scryfall search (https://scryfall.com/docs/syntax), following every page. */
export async function searchCards(query) {
  const cards = [];
  let url = `${API}/cards/search?unique=cards&q=${encodeURIComponent(query)}`;
  while (url) {
    const page = await getJson(url);
    cards.push(...page.data);
    url = page.has_more ? page.next_page : null;
  }
  return cards;
}
