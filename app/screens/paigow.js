import { h, onPress } from '../dom.js';
import { crest } from '../art.js';
import { fullCard, cardBack } from '../cardView.js';
import { header, personInfo } from './common.js';
import {
  createMatch, setDecks, score, outcome, nextRound, playerStartsRound,
  PAIGOW_RULES, ROUND_RESULT, MATCH_OUTCOME,
} from '../../src/paigow/paigow.js';

const RESULT_LABEL = { [ROUND_RESULT.WON]: 'Won', [ROUND_RESULT.LOST]: 'Lost', [ROUND_RESULT.DRAWN]: 'Draw' };

/**
 * Pai Gow (src/paigow/paigow.js): split 15 cards into five decks of three, then a best of five against
 * the CPU. `view`: 'build' (the decks), 'scoreboard' (between rounds) or 'final'. Without a `match`, a
 * new one is dealt.
 */
export function paigowScreen(app, { match: given = null, view = null } = {}) {
  const match = given ?? createMatch(app.content);
  const shown = view ?? (match.decks ? (outcome(match) ? 'final' : 'scoreboard') : 'build');
  return shown === 'build' ? buildView(app, match) : scoreView(app, match, shown === 'final');
}

/**
 * A card the size of a slot: tap for `onTap`, long-press (or tap, without `onTap`) to read it.
 * `full`: the printed card's whole image (when it has one), for the deck builder.
 */
function miniCard(app, cardId, { onTap = null, full = false } = {}) {
  const card = { ...app.definitions[cardId], cardId, id: cardId };
  const el = h(`button.pg-card${full ? '.full' : ''}`, { type: 'button', 'aria-label': card.name, dataset: { card: cardId } }, fullCard(card, app.definitions, { big: full }));
  const inspect = () => app.overlays.inspect(card);
  onPress(el, { onTap: onTap ?? inspect, onLong: onTap ? inspect : null });
  // A long press on a phone would otherwise open the browser's own menu.
  el.addEventListener('contextmenu', (event) => event.preventDefault());
  return el;
}

const opponentLine = (app, match) => {
  const opponent = app.content.opponents[match.opponentId];
  return h('div.pg-opp', crest(personInfo(opponent), { size: 'sm' }), h('span', 'vs ', h('b', opponent.name)));
};

function buildView(app, match) {
  const { decks: count, deckSize } = PAIGOW_RULES;
  /** Each card's deck (0–4), or none while it's in the tray. */
  const placed = new Map();
  let selected = 0;

  const deckOf = (i) => match.cards.filter((id) => placed.get(id) === i);
  const free = (i) => deckOf(i).length < deckSize;
  const rows = h('div.pg-rows');
  const tray = h('div.pg-tray');
  const trayTitle = h('h4');
  const start = h('button.btn.primary.big', { onclick: () => play() }, 'Start match');
  const autoFill = h('button.btn', { onclick: () => fill() }, 'Auto-fill');
  const clear = h('button.btn.ghost', { onclick: () => { placed.clear(); selected = 0; render(); } }, 'Clear');

  const place = (cardId) => {
    const target = free(selected) ? selected : [...Array(count).keys()].find(free);
    if (target === undefined) return;
    placed.set(cardId, target);
    app.sound('select');
    // Keep filling the same deck until it's full, then move on to the next one with room.
    if (!free(target)) selected = [...Array(count).keys()].find(free) ?? target;
    render();
  };
  const unplace = (cardId) => {
    selected = placed.get(cardId);
    placed.delete(cardId);
    render();
  };
  const fill = () => {
    for (const cardId of match.cards) {
      if (placed.has(cardId)) continue;
      const target = [...Array(count).keys()].find(free);
      if (target === undefined) break;
      placed.set(cardId, target);
    }
    render();
  };
  const play = () => {
    const decks = [...Array(count).keys()].map(deckOf);
    app.go('battle', { mode: 'paigow', match: setDecks(match, decks) });
  };

  const render = () => {
    rows.replaceChildren(...[...Array(count).keys()].map((i) => {
      const cards = deckOf(i);
      return h('div.pg-row', { class: i === selected ? 'selected' : '', onclick: (event) => {
        if (event.target.closest('.pg-card')) return;
        selected = i;
        render();
      } },
      h('div.pg-row-label', h('span', 'Round'), h('b', String(i + 1))),
      h('div.pg-slots',
        ...cards.map((id) => miniCard(app, id, { onTap: () => unplace(id), full: true })),
        ...Array.from({ length: deckSize - cards.length }, () => h('div.pg-slot'))));
    }));
    const left = match.cards.filter((id) => !placed.has(id));
    trayTitle.textContent = left.length ? `Your cards · ${left.length} left` : 'All cards placed';
    tray.replaceChildren(...left.map((id) => miniCard(app, id, { onTap: () => place(id), full: true })));
    start.disabled = left.length > 0;
    autoFill.disabled = left.length === 0;
    clear.disabled = placed.size === 0;
  };
  render();

  const el = h('div',
    header({ title: 'Pai Gow', onBack: () => app.go('title') }),
    h('div.pg-body',
      opponentLine(app, match),
      h('p.pg-help', 'Make five decks of three. Each round you start with your deck in hand, 5 life and infinite mana. First to win three rounds takes the match. Tap a card to put it in the highlighted round (tap it again to take it back); hold a card to read it.'),
      h('section.pg-tray-wrap', trayTitle, tray),
      rows),
    h('div.cta', h('div.row', clear, autoFill), start));
  return { el };
}

function scoreView(app, match, final) {
  const { won, lost, drawn } = score(match);
  const round = nextRound(match);
  const result = outcome(match);
  const opponent = app.content.opponents[match.opponentId];

  const roundRows = h('div.pg-rounds', match.decks.map((deck, i) => {
    const played = match.rounds[i];
    const revealed = played || final;
    const status = played ? RESULT_LABEL[played.result] : i === round ? 'Next' : '—';
    return h('div.pg-round', { class: played ? `r-${played.result}` : i === round ? 'r-next' : 'r-later' },
      h('div.pg-round-head', h('span', `Round ${i + 1}`), h('span.pg-status', status)),
      h('div.pg-match',
        h('div.pg-side', deck.map((id) => miniCard(app, id))),
        h('span.pg-vs', 'vs'),
        h('div.pg-side', match.cpuDecks[i].map((id) => (revealed ? miniCard(app, id) : h('div.pg-card.back', cardBack()))))));
  }));

  const title = final
    ? h(`div.result-title.${result === MATCH_OUTCOME.WON ? 'victory' : 'defeat'}`, { WON: 'Victory', LOST: 'Defeat', TIE: 'Tie' }[result.toUpperCase()])
    : null;
  const leave = async () => {
    if (final || await app.overlays.confirm({ title: 'Leave the match?', text: 'This match will be lost.', yes: 'Leave', danger: true })) app.go('title');
  };
  const el = h('div',
    header({ title: 'Pai Gow', onBack: leave }),
    h('div.pg-body',
      title,
      h('div.pg-score',
        h('div.pg-score-side', crest(personInfo(null, 'You'), { size: 'sm' }), h('span', 'You')),
        h('div.pg-score-num', `${won} – ${lost}`, drawn ? h('small', `${drawn} ${drawn === 1 ? 'draw' : 'draws'}`) : null),
        h('div.pg-score-side', crest(personInfo(opponent), { size: 'sm' }), h('span', opponent.name))),
      round !== null ? h('p.pg-help.center', playerStartsRound(match, round) ? 'You go first.' : `${opponent.name} goes first.`) : null,
      roundRows),
    h('div.cta', final
      ? [h('button.btn.primary.big', { onclick: () => app.go('paigow', {}) }, 'New match'), h('button.btn.ghost', { onclick: () => app.go('title') }, 'Title')]
      : h('button.btn.primary.big', { onclick: () => app.go('battle', { mode: 'paigow', match }) }, `Play round ${round + 1}`)));
  return {
    el,
    enter() {
      el.querySelector('.result-title')?.animate([{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 500, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    },
  };
}
