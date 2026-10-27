import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, GAME_LIMITS, BasicAIController, CARDS, CAMPAIGN, REAL_DECKS, REWARD_ONLY_CARDS, REWARD, RUN_PHASE,
  validateCampaign, startRun, recordResult, chooseReward, poolFor, matchSetup, CARD_PRESENTATION, PATHFINDER_DECK, PATHFINDER_REWARDS,
} from '../src/index.js';
import { playout } from '../src/ai/simulate.js';

const colorsOf = (card) => card.colors ?? Object.keys(card.manaCost ?? {}).filter((c) => 'WUBRG'.includes(c));

test('the real campaign is consistent, and every card in it is real', () => {
  assert.deepEqual(validateCampaign(CAMPAIGN), []);
  for (const [name, deck] of Object.entries(REAL_DECKS)) {
    assert.equal(deck.length, 40, name);
    for (const id of deck) assert.ok(CARDS[id], `${name}: ${id}`);
  }
  for (const id of REWARD_ONLY_CARDS) assert.ok(CARDS[id]?.image, id);
  // Imported cards carry their art; the hand-written ones get it from CARD_PRESENTATION.
  for (const id of new Set(Object.values(REAL_DECKS).flat())) {
    assert.ok(CARDS[id].image ?? CARD_PRESENTATION[id]?.image, `${id} has art`);
  }
});

test('each real deck is one color', () => {
  for (const [name, deck] of Object.entries(REAL_DECKS)) {
    const colors = new Set(deck.flatMap((id) => colorsOf(CARDS[id])));
    assert.equal(colors.size, 1, `${name}: ${[...colors]}`);
  }
});

test('rewards stay in the planeswalker\'s colors', () => {
  for (const [walker, color] of [['warden', 'G'], ['sage', 'U']]) {
    for (const pool of ['early', 'late']) {
      const cards = poolFor(CAMPAIGN, walker, pool);
      assert.ok(cards.length >= 5, `${walker} ${pool}`);
      for (const id of cards) assert.ok(colorsOf(CARDS[id]).every((c) => c === color), `${walker} offered ${id}`);
    }
    for (let seed = 1; seed <= 20; seed++) {
      const run = recordResult(startRun(CAMPAIGN, { planeswalkerId: walker, deckId: CAMPAIGN.planeswalkers[walker].decks[0], seed }), CAMPAIGN, { won: true });
      assert.equal(run.phase, RUN_PHASE.REWARD);
      for (const offer of run.offers.filter((o) => o.kind === REWARD.CARD)) {
        assert.ok(colorsOf(CARDS[offer.cardId]).every((c) => c === color), `${walker} offered ${offer.cardId}`);
      }
    }
  }
});

test('every pair of real decks plays to the end', () => {
  const names = ['whiteWeenie', 'blueSkies', 'blackRemoval', 'redBurn', 'greenStompy', 'dragonlord'];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const game = new Game({
        players: [{ id: 'p1' }, { id: 'p2' }], seed: i * 10 + j, silent: true, limits: GAME_LIMITS,
        decks: { p1: REAL_DECKS[names[i]], p2: REAL_DECKS[names[j]] },
      });
      game.start();
      const policies = Object.fromEntries(['p1', 'p2'].map((id) => {
        const ai = new BasicAIController({ game: null, playerId: id });
        return [id, (state) => ai.chooseAction(state)];
      }));
      const final = playout(game, policies, { until: (state) => state.turn > 150 });
      assert.equal(final.status, GAME_STATUS.GAME_OVER, `${names[i]} vs ${names[j]}`);
    }
  }
});

test('the Pathfinder: its Elf deck, and rewards only from its sideboard', () => {
  assert.equal(PATHFINDER_DECK.length, 40);
  for (const id of [...PATHFINDER_DECK, ...PATHFINDER_REWARDS]) {
    assert.ok(CARDS[id], id);
    assert.ok(CARDS[id].image ?? CARD_PRESENTATION[id]?.image, `${id} has art`);
  }
  // Its cards stay out of the other planeswalkers' rewards.
  const others = new Set([...poolFor(CAMPAIGN, 'warden', 'late'), ...poolFor(CAMPAIGN, 'warden', 'early')]);
  for (const id of ['tauntingElf', 'pounce', 'elvishArchdruid', 'beastKinRanger']) assert.ok(!others.has(id), id);
  for (const tier of ['early', 'late']) assert.deepEqual(poolFor(CAMPAIGN, 'pathfinder', tier), PATHFINDER_REWARDS);
  for (let seed = 1; seed <= 20; seed++) {
    const run = recordResult(startRun(CAMPAIGN, { planeswalkerId: 'pathfinder', deckId: 'elfTribe', seed }), CAMPAIGN, { won: true });
    for (const offer of run.offers.filter((o) => o.kind === REWARD.CARD)) assert.ok(PATHFINDER_REWARDS.includes(offer.cardId), offer.cardId);
  }
});

test('the Pathfinder\'s untap, its free upgrade, and its Elf summons', () => {
  let run = startRun(CAMPAIGN, { planeswalkerId: 'pathfinder', deckId: 'elfTribe', seed: 3 });
  assert.deepEqual(run.emblems, ['pathfinderUntap']);
  // Win until the upgrade is offered, and take it.
  for (let i = 0; i < 20 && !run.emblems.includes('pathfinderFreeUntap'); i++) {
    run = recordResult(run, CAMPAIGN, { won: true });
    if (run.phase !== RUN_PHASE.REWARD) break;
    const upgrade = run.offers.findIndex((o) => o.kind === REWARD.POWER && o.powerId === 'pathfinderFreeUntap');
    run = chooseReward(run, CAMPAIGN, upgrade >= 0 ? upgrade : run.offers.findIndex((o) => o.kind === REWARD.CARD));
  }
  assert.deepEqual(run.emblems, ['pathfinderFreeUntap']);
  const { game: options } = matchSetup(run, CAMPAIGN);
  const game = new Game({ ...options, mulligans: false });
  game.start();
  const emblem = game.getState().players.find((p) => p.id === 'player').emblems[0];
  assert.deepEqual([emblem.abilities[0].text, emblem.abilities[0].cost], ['0: Untap target creature.', {}]);
  assert.deepEqual(CAMPAIGN.emblems.pathfinderUntap.abilities[0].cost, { mana: { G: 1 } });
  assert.equal(CAMPAIGN.emblems.pathfinderElves.abilities[0].text, '{2}: Create a 1/1 green Elf Warrior creature token.');
});

test('the Elves, with every sideboard card and the Pathfinder\'s powers, play to the end', () => {
  const elves = [...PATHFINDER_DECK, ...PATHFINDER_REWARDS];
  const emblems = ['pathfinderFreeUntap', 'pathfinderElves'];
  const opponents = ['elves', 'whiteWeenie', 'blueSkies', 'blackRemoval', 'redBurn', 'greenStompy', 'dragonlord'];
  opponents.forEach((name, i) => {
    for (let seed = 0; seed < 2; seed++) {
      const game = new Game({
        players: [{ id: 'p1' }, { id: 'p2' }], seed: 100 + i * 10 + seed, silent: true, limits: GAME_LIMITS,
        decks: { p1: elves, p2: name === 'elves' ? elves : REAL_DECKS[name] },
        emblems: { p1: emblems, p2: name === 'elves' ? emblems : [] },
        emblemDefinitions: CAMPAIGN.emblems,
      });
      game.start();
      const policies = Object.fromEntries(['p1', 'p2'].map((id) => {
        const ai = new BasicAIController({ game: null, playerId: id });
        return [id, (state) => ai.chooseAction(state)];
      }));
      const final = playout(game, policies, { until: (state) => state.turn > 150 });
      assert.equal(final.status, GAME_STATUS.GAME_OVER, `elves vs ${name}, seed ${seed}`);
    }
  });
});
