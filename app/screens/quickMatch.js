import { h } from '../dom.js';
import { crest } from '../art.js';
import { startRun, startingDecks, currentTier } from '../../src/campaign/campaign.js';
import { header, personInfo, difficultyOf, difficultyPips } from './common.js';

/** One battle outside a run: pick a planeswalker, any deck (starter or opponent's) and an opponent. */
export function quickMatchScreen(app) {
  const { content } = app;
  const decks = {
    ...Object.fromEntries(Object.entries(content.starterDecks).map(([id, d]) => [id, { name: d.name, cards: d.cards }])),
    ...Object.fromEntries(Object.entries(content.opponents).map(([id, o]) => [`opponent:${id}`, { name: `${o.name}'s deck`, cards: o.deck }])),
  };
  const choice = {
    walker: Object.keys(content.planeswalkers)[0],
    deck: null,
    opponent: Object.keys(content.opponents)[0],
  };
  choice.deck = startingDecks(content, choice.walker)[0];
  const bossIds = new Set(content.ladder.filter((t) => t.boss).flatMap((t) => t.opponents));

  const group = (title, items, key) => h('section.qm-group',
    h('h4', title),
    h('div.qm-options', items.map(({ id, label, extra }) => h('button.qm-option', {
      class: choice[key] === id ? 'chosen' : '',
      dataset: { id },
      onclick: (event) => {
        choice[key] = id;
        for (const b of event.currentTarget.parentElement.children) b.classList.toggle('chosen', b.dataset.id === id);
      },
    }, extra ?? null, h('span', label)))));

  const play = () => {
    // A throwaway run with the chosen deck, whose first fight is against the chosen opponent; nothing is saved.
    const run = startRun(content, { planeswalkerId: choice.walker, deckId: startingDecks(content, choice.walker)[0] });
    run.deck = [...decks[choice.deck].cards];
    run.encounter = { ...run.encounter, opponentId: choice.opponent, tierId: currentTier(run, content).id };
    app.go('battle', { mode: 'quick', quick: { run } });
  };

  const el = h('div',
    header({ title: 'Quick match', onBack: () => app.go('title') }),
    h('div.qm-body',
      group('Planeswalker', Object.entries(content.planeswalkers).map(([id, w]) => ({ id, label: w.name, extra: crest(personInfo(w), { size: 'sm' }) })), 'walker'),
      group('Deck', Object.entries(decks).map(([id, d]) => ({ id, label: d.name })), 'deck'),
      group('Opponent', Object.entries(content.opponents).map(([id, o]) => ({
        id, label: o.name, extra: h('span.qm-opp', crest(personInfo(o), { size: 'sm' }), difficultyPips(difficultyOf(o, bossIds.has(id)))),
      })), 'opponent')),
    h('div.cta', h('button.btn.primary.big', { onclick: play }, 'Play')));
  return { el };
}
