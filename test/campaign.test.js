import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, BasicAIController, SearchAIController, SAMPLE_CAMPAIGN, RUN_PHASE, REWARD, RUN_VERSION,
  startRun, matchSetup, recordResult, chooseReward, skipReward, retryFight, skipFight, canSkipFight,
  runProgress, startingDecks, validateCampaign, saveRun, loadRun, clearRun, SAVE_KEY, createCpuController,
} from '../src/index.js';
import { playout } from '../src/ai/simulate.js';

const content = SAMPLE_CAMPAIGN;
const start = (options = {}) => startRun(content, { planeswalkerId: 'warden', deckId: 'effects', seed: 7, ...options });
const totalFights = content.ladder.reduce((sum, tier) => sum + tier.fights, 0);

/** Wins every fight, taking the first offer each time. */
function winOut(run) {
  let next = run;
  while (next.phase !== RUN_PHASE.VICTORY) {
    next = recordResult(next, content, { won: true });
    if (next.phase === RUN_PHASE.REWARD) {
      const index = next.offers.findIndex((o) => o.kind !== REWARD.REMOVE_CARD);
      next = index === -1 ? skipReward(next, content) : chooseReward(next, content, index);
    }
  }
  return next;
}

const withOffer = (run, offer) => ({ ...run, phase: RUN_PHASE.REWARD, offers: [offer] });

function memoryStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

test('the sample campaign is consistent', () => {
  assert.deepEqual(validateCampaign(content), []);
});

test('validateCampaign reports broken content', () => {
  const broken = {
    ...content,
    planeswalkers: { ...content.planeswalkers, ghost: { name: 'Ghost', emblems: ['nope'], powers: ['missing'] } },
    starterDecks: { ...content.starterDecks, tiny: { name: 'Tiny', cards: ['forest', 'notACard'] } },
    powers: { ...content.powers, odd: { kind: 'telepathy' } },
    ladder: [
      { id: 'final', boss: true, fights: 1, opponents: ['overlord'] },
      { id: 'after', fights: 2, opponents: ['nobody'], cardPool: 'gone' },
    ],
  };
  const problems = validateCampaign(broken);
  for (const expected of [
    'planeswalker ghost: unknown emblem "nope"',
    'planeswalker ghost: unknown power "missing"',
    'starter deck tiny: unknown card "notACard"',
    'starter deck tiny: 2 cards, fewer than 40',
    'power odd: unknown kind "telepathy"',
    'tier final: only the last tier can be a boss',
    'tier after: unknown opponent "nobody"',
    'tier after: fewer opponents than fights',
    'tier after: unknown card pool "gone"',
  ]) assert.ok(problems.includes(expected), `missing: ${expected}\n${problems.join('\n')}`);
});

test('a run starts with the planeswalker, its deck and the first tier', () => {
  const run = start();
  assert.equal(run.version, RUN_VERSION);
  assert.equal(run.phase, RUN_PHASE.FIGHT);
  assert.deepEqual(run.deck, [...content.starterDecks.effects.cards]);
  assert.deepEqual(run.emblems, ['wardenGrowth']);
  assert.equal(run.lives, content.rules.lives);
  assert.ok(content.ladder[0].opponents.includes(run.encounter.opponentId));
  assert.deepEqual(runProgress(run, content), { tier: content.ladder[0], tierIndex: 0, tiers: 4, fight: 0, fights: 2 });
  assert.equal(start({ planeswalkerId: 'sage' }).startingLife, 18);
  assert.throws(() => start({ planeswalkerId: 'nobody' }), /Unknown planeswalker/);
  assert.throws(() => start({ deckId: 'nope' }), /can't start with deck/);
  const limited = { ...content, planeswalkers: { ...content.planeswalkers, warden: { ...content.planeswalkers.warden, decks: ['keywords'] } } };
  assert.deepEqual(startingDecks(limited, 'warden'), ['keywords']);
  assert.throws(() => startRun(limited, { planeswalkerId: 'warden', deckId: 'effects' }), /can't start/);
});

test('the same seed plays out the same run; functions never mutate the run', () => {
  const a = start({ seed: 99 });
  const before = JSON.stringify(a);
  const one = winOut(a);
  assert.equal(JSON.stringify(a), before);
  assert.deepEqual(winOut(start({ seed: 99 })), one);
  assert.notDeepEqual(winOut(start({ seed: 100 })).history, one.history);
});

test('winning every fight climbs the ladder to victory, without repeating opponents in a tier', () => {
  const run = winOut(start());
  assert.equal(run.phase, RUN_PHASE.VICTORY);
  assert.equal(run.history.length, totalFights);
  assert.ok(run.history.every((h) => h.result === 'won'));
  for (const tier of content.ladder) {
    const faced = run.history.filter((h) => h.tierId === tier.id).map((h) => h.opponentId);
    assert.equal(faced.length, tier.fights);
    assert.equal(new Set(faced).size, faced.length);
    assert.ok(faced.every((id) => tier.opponents.includes(id)));
  }
  assert.equal(run.history.at(-1).opponentId, 'overlord');
  assert.equal(run.history.at(-1).reward, undefined, 'no reward after the boss');
});

test('a win offers cards from the tier\'s pool and an unowned power', () => {
  const run = recordResult(start(), content, { won: true });
  assert.equal(run.phase, RUN_PHASE.REWARD);
  const cards = run.offers.filter((o) => o.kind === REWARD.CARD);
  const powers = run.offers.filter((o) => o.kind === REWARD.POWER);
  assert.equal(cards.length, 2);
  assert.equal(new Set(cards.map((o) => o.cardId)).size, 2);
  assert.ok(cards.every((o) => content.cardPools.early.includes(o.cardId)));
  assert.equal(powers.length, 1);
  assert.ok(content.planeswalkers.warden.powers.includes(powers[0].powerId));
  // The deck is at the minimum size, so removing a card isn't offered yet.
  assert.ok(!run.offers.some((o) => o.kind === REWARD.REMOVE_CARD));

  const chosen = chooseReward(run, content, 0);
  assert.equal(chosen.deck.length, run.deck.length + 1);
  assert.equal(chosen.deck.at(-1), cards[0].cardId);
  assert.deepEqual(chosen.history.at(-1).reward, cards[0]);
  assert.equal(chosen.phase, RUN_PHASE.FIGHT);
  assert.deepEqual(runProgress(chosen, content).fight, 1);
  assert.throws(() => chooseReward(run, content, 9), /no offer/);
  assert.throws(() => chooseReward(chosen, content, 0), /phase "fight"/);
  assert.equal(skipReward(run, content).deck.length, run.deck.length);
});

test('powers change the planeswalker in the next fight', () => {
  let run = recordResult(start(), content, { won: true });
  run = chooseReward(withOffer(run, { kind: REWARD.POWER, powerId: 'wardenSprouts' }), content, 0);
  run = chooseReward(withOffer(recordResult(run, content, { won: true }), { kind: REWARD.POWER, powerId: 'wardenTwice' }), content, 0);
  run = chooseReward(withOffer(recordResult(run, content, { won: true }), { kind: REWARD.POWER, powerId: 'toughHide' }), content, 0);
  run = chooseReward(withOffer(recordResult(run, content, { won: true }), { kind: REWARD.POWER, powerId: 'secondWind' }), content, 0);
  assert.deepEqual(run.powers, ['wardenSprouts', 'wardenTwice', 'toughHide', 'secondWind']);
  assert.equal(run.lives, content.rules.lives + 1);

  const setup = matchSetup(run, content);
  assert.deepEqual(setup.game.emblems.player, ['wardenGrowth+1', 'wardenSprouts']);
  const game = new Game(setup.game);
  game.start();
  const player = game.getState().players.find((p) => p.id === 'player');
  assert.equal(player.life, 23);
  assert.deepEqual(player.emblems.map((e) => [e.emblemId, e.activationsPerTurn]), [['wardenGrowth+1', 2], ['wardenSprouts', 1]]);

  // Owned powers aren't offered again, unless repeatable.
  for (let rng = 0; rng < 20; rng++) {
    const offers = recordResult({ ...run, rng }, content, { won: true }).offers;
    for (const o of offers.filter((x) => x.kind === REWARD.POWER)) {
      assert.ok(content.powers[o.powerId].repeatable, `offered ${o.powerId} again`);
    }
  }
});

test('removing a card is offered only above the minimum deck size', () => {
  let run = recordResult(start(), content, { won: true });
  run = chooseReward(run, content, run.offers.findIndex((o) => o.kind === REWARD.CARD));
  run = recordResult(run, content, { won: true });
  const at = run.offers.findIndex((o) => o.kind === REWARD.REMOVE_CARD);
  assert.notEqual(at, -1);
  assert.throws(() => chooseReward(run, content, at, { cardId: 'notInDeck' }), /no "notInDeck"/);
  const trimmed = chooseReward(run, content, at, { cardId: 'forest' });
  assert.equal(trimmed.deck.length, 40);
  assert.equal(trimmed.deck.filter((id) => id === 'forest').length, run.deck.filter((id) => id === 'forest').length - 1);
  assert.deepEqual(trimmed.history.at(-1).reward, { kind: REWARD.REMOVE_CARD, cardId: 'forest' });
  // At the minimum size it's refused even if offered.
  assert.throws(() => chooseReward(withOffer(start(), { kind: REWARD.REMOVE_CARD }), content, 0, { cardId: 'forest' }), /minimum size/);
});

test('a loss costs a life; the fight can be retried or skipped, but not a boss', () => {
  const run = start();
  const lost = recordResult(run, content, { won: false });
  assert.equal(lost.phase, RUN_PHASE.DEFEATED);
  assert.equal(lost.lives, run.lives - 1);
  assert.deepEqual(lost.history.at(-1), { tierId: 'outskirts', opponentId: run.encounter.opponentId, result: 'lost' });

  const retried = retryFight(lost);
  assert.equal(retried.phase, RUN_PHASE.FIGHT);
  assert.equal(retried.encounter.opponentId, run.encounter.opponentId);
  assert.notEqual(retried.encounter.seed, run.encounter.seed);

  assert.ok(canSkipFight(lost, content));
  const skipped = skipFight(lost, content);
  assert.equal(skipped.phase, RUN_PHASE.FIGHT);
  assert.equal(skipped.fightIndex, 1);
  assert.notEqual(skipped.encounter.opponentId, run.encounter.opponentId);
  assert.equal(skipped.history.at(-1).result, 'skipped');

  // Reach the boss, then lose to it.
  let atBoss = run;
  while (!content.ladder[atBoss.tierIndex].boss) {
    atBoss = recordResult(atBoss, content, { won: true });
    atBoss = skipReward(atBoss, content);
  }
  const lostToBoss = recordResult(atBoss, content, { won: false });
  assert.ok(!canSkipFight(lostToBoss, content));
  assert.throws(() => skipFight(lostToBoss, content), /boss/);
  assert.equal(retryFight(lostToBoss).encounter.opponentId, 'overlord');
});

test('losing the last life ends the run', () => {
  let run = start();
  for (let i = 1; i < content.rules.lives; i++) run = retryFight(recordResult(run, content, { won: false }));
  run = recordResult(run, content, { won: false });
  assert.equal(run.lives, 0);
  assert.equal(run.phase, RUN_PHASE.OVER);
  assert.throws(() => retryFight(run), /phase "over"/);
});

test('saved runs load back, unless they no longer fit the content', () => {
  const storage = memoryStorage();
  assert.equal(loadRun(storage, content), null);
  const run = recordResult(start(), content, { won: true });
  saveRun(storage, run);
  assert.deepEqual(loadRun(storage, content), run);

  storage.setItem(SAVE_KEY, JSON.stringify({ ...run, version: RUN_VERSION + 1 }));
  assert.equal(loadRun(storage, content), null);
  storage.setItem(SAVE_KEY, '{not json');
  assert.equal(loadRun(storage, content), null);
  saveRun(storage, { ...run, deck: [...run.deck, 'retiredCard'] });
  assert.equal(loadRun(storage, content), null);
  const { warden, ...others } = content.planeswalkers;
  saveRun(storage, run);
  assert.equal(loadRun(storage, { ...content, planeswalkers: others }), null);
  clearRun(storage);
  assert.equal(storage.getItem(SAVE_KEY), null);
});

test('a fight from matchSetup plays to the end', () => {
  const run = start({ planeswalkerId: 'sage', deckId: 'triggers' });
  const setup = matchSetup(run, content);
  assert.equal(setup.encounter.tierName, 'Outskirts');
  assert.equal(setup.cpu.playerId, 'cpu');
  const game = new Game({ ...setup.game, silent: true });
  game.start();
  const state = game.peekState();
  assert.deepEqual(state.players.map((p) => [p.id, p.life]), [['player', 18], ['cpu', 20]]);
  assert.deepEqual(state.players[0].emblems.map((e) => e.emblemId), ['sageInsight']);
  const policies = Object.fromEntries(['player', 'cpu'].map((id) => {
    const ai = new BasicAIController({ game: null, playerId: id });
    return [id, (s) => ai.chooseAction(s)];
  }));
  const final = playout(game, policies);
  assert.equal(final.status, GAME_STATUS.GAME_OVER);
  const next = recordResult(run, content, { won: final.winnerId === 'player' });
  assert.ok([RUN_PHASE.REWARD, RUN_PHASE.DEFEATED].includes(next.phase));
});

test('the boss fight uses the boss\'s emblems, life and search AI', () => {
  let run = start();
  while (!content.ladder[run.tierIndex].boss) run = skipReward(recordResult(run, content, { won: true }), content);
  const setup = matchSetup(run, content);
  assert.equal(setup.encounter.boss, true);
  assert.equal(setup.game.startingLife.cpu, 25);
  assert.deepEqual(setup.game.emblems.cpu, ['bossDominion', 'planeswalker']);
  assert.deepEqual(setup.cpu.ai, { kind: 'search', budgetMs: 2500, weights: 'overlord' });
});

test('createCpuController builds the opponent\'s AI', () => {
  const run = start();
  const setup = matchSetup(run, content);
  const game = new Game(setup.game);
  const basic = createCpuController(game, setup.cpu, { delayMs: null });
  assert.ok(basic instanceof BasicAIController);
  basic.detach();
  const search = createCpuController(game, { ...setup.cpu, ai: { kind: 'search', budgetMs: 100 } }, { responseMs: 50 });
  assert.ok(search instanceof SearchAIController);
  search.detach();
  assert.throws(() => createCpuController(game, { ...setup.cpu, ai: { kind: 'psychic' } }), /Unknown AI kind/);
});

test('Game takes a starting life per player', () => {
  const players = [{ id: 'p1' }, { id: 'p2' }];
  const game = new Game({ players, seed: 1, startingLife: { p2: 30 } });
  game.start();
  assert.deepEqual(game.getState().players.map((p) => p.life), [20, 30]);
});

test('campaign-sim plays whole runs and summarises them', async () => {
  const { simulateRun, summarize } = await import('../tools/campaign-sim.js');
  // Basic AIs only, to keep it quick.
  const quick = {
    ...content,
    opponents: Object.fromEntries(Object.entries(content.opponents).map(([id, o]) => [id, { ...o, ai: { kind: 'basic' } }])),
  };
  const runs = [1, 2].map((seed) => simulateRun({ content: quick, planeswalkerId: 'warden', deckId: 'effects', seed }));
  assert.ok(runs.every((r) => r.phase === RUN_PHASE.VICTORY || r.phase === RUN_PHASE.OVER));
  const summary = summarize(runs, quick);
  assert.equal(summary.runs, 2);
  assert.equal(summary.tiers[0].reached, 2);
  const fights = summary.tiers.reduce((sum, t) => sum + t.won + t.lost, 0);
  assert.equal(fights, runs.reduce((sum, r) => sum + r.history.filter((h) => h.result !== 'skipped').length, 0));
});
