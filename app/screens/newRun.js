import { h } from '../dom.js';
import { icon } from '../icons.js';
import { crest } from '../art.js';
import { startRun, startingDecks } from '../../src/campaign/campaign.js';
import { saveRun } from '../../src/campaign/save.js';
import { header, personInfo } from './common.js';
import { inlineSymbols } from '../symbols.js';
import { manaValue, isLand } from '../../src/cards/cards.js';

/** Choose a planeswalker (a swipeable carousel), then a starter deck. */
export function newRunScreen(app) {
  const { content } = app;
  const walkers = Object.entries(content.planeswalkers);
  let walkerId = walkers[0][0];
  let deckId = null;

  const body = h('div.newrun-body');
  const el = h('div', header({ title: 'Choose your planeswalker', onBack: () => app.go('title') }), body);

  function walkerCard([id, walker]) {
    const abilities = walker.emblems.flatMap((e) => content.emblems?.[e]?.abilities ?? []);
    return h('div.walker-card', { dataset: { id } },
      crest(personInfo(walker), { size: 'xl' }),
      h('h3', walker.name),
      h('p.walker-text', walker.text ?? ''),
      h('div.walker-stats', h('span', icon('heart'), ` ${walker.startingLife ?? 20} life`)),
      h('div.walker-abilities', abilities.map((a) => h('div.ability-line', inlineSymbols(a.text)))),
      h('div.walker-powers-title', 'Powers to earn'),
      h('div.walker-powers', (walker.powers ?? []).map((p) => h('span.power-chip', { onclick: () => app.overlays.sheet({ title: content.powers[p].name, text: content.powers[p].text, options: [], cancel: 'Close' }) }, content.powers[p].name))));
  }

  function showWalkers() {
    const track = h('div.carousel', walkers.map(walkerCard));
    const dots = h('div.dots', walkers.map(([id]) => h('span.dot', { dataset: { id } })));
    const markDots = () => {
      for (const dot of dots.children) dot.classList.toggle('on', dot.dataset.id === walkerId);
    };
    // The card nearest the middle is the chosen one.
    track.addEventListener('scroll', () => {
      const middle = track.scrollLeft + track.clientWidth / 2;
      let best = null;
      for (const card of track.children) {
        const distance = Math.abs(card.offsetLeft + card.offsetWidth / 2 - middle);
        if (!best || distance < best.distance) best = { id: card.dataset.id, distance };
      }
      if (best && best.id !== walkerId) {
        walkerId = best.id;
        markDots();
      }
    }, { passive: true });
    markDots();
    body.replaceChildren(track, dots, h('div.cta', h('button.btn.primary.big', { onclick: showDecks }, 'Choose deck')));
  }

  function showDecks() {
    const ids = startingDecks(content, walkerId);
    deckId = ids[0];
    el.querySelector('header h2').textContent = 'Choose a starting deck';
    const list = h('div.deck-list', ids.map((id) => {
      const deck = content.starterDecks[id];
      const spells = deck.cards.filter((c) => !isLand(app.definitions[c]));
      const curve = spells.reduce((sum, c) => sum + manaValue(app.definitions[c].manaCost ?? {}), 0) / Math.max(1, spells.length);
      const featured = [...new Set(spells)].slice(0, 3).map((c) => app.definitions[c].name);
      return h('button.deck-option', {
        dataset: { id },
        onclick: (event) => {
          deckId = id;
          for (const option of list.children) option.classList.toggle('chosen', option.dataset.id === id);
          if (event.detail > 1) app.overlays.deck(deck.cards, { title: deck.name });
        },
      }, h('div.deck-name', deck.name), h('div.deck-meta', `${deck.cards.length} cards · avg cost ${curve.toFixed(1)}`),
      h('div.deck-featured', featured.join(' · ')),
      h('span.deck-view-btn', {
        onclick: (event) => {
          event.stopPropagation();
          app.overlays.deck(deck.cards, { title: deck.name });
        },
      }, icon('cards'), ' View'));
    }));
    list.firstChild?.classList.add('chosen');
    const begin = () => {
      const run = startRun(content, { planeswalkerId: walkerId, deckId });
      saveRun(app.storage, run);
      app.sound('reward');
      app.go('runMap');
    };
    body.replaceChildren(h('div.chosen-walker', crest(personInfo(content.planeswalkers[walkerId]), { size: 'md' }), h('span', content.planeswalkers[walkerId].name),
      h('button.btn.small.ghost', { onclick: () => { el.querySelector('header h2').textContent = 'Choose your planeswalker'; showWalkers(); } }, 'Change')),
    list, h('div.cta', h('button.btn.primary.big', { onclick: begin }, 'Begin the climb')));
  }

  showWalkers();
  return { el };
}
