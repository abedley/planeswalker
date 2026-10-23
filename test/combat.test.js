import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, ACTION, DECISION, PHASE, SAMPLE_CARDS, KEYWORD, CARD_TYPE,
  passPriority, castSpell, toggleAttacker, confirmAttackers, setBlocker, confirmBlockers,
} from '../src/index.js';
import { resolveCombat, planAttack, planBlocks, creatureValue, canBlock } from '../src/ai/combat.js';

const players = [{ id: 'p1' }, { id: 'p2' }];
// The keyword sampler's creatures, made free so any of them can be cast on turn 1.
const FREE = Object.fromEntries(Object.entries(SAMPLE_CARDS).map(([id, card]) => [id, { ...card, manaCost: {} }]));
FREE.ogre = { id: 'ogre', name: 'Ogre', manaCost: {}, types: [CARD_TYPE.CREATURE], power: 3, toughness: 3, keywords: [] };
FREE.sneak = { ...FREE.ogre, id: 'sneak', name: 'Sneak', keywords: [KEYWORD.CANT_BE_BLOCKED] };
FREE.coward = { ...FREE.ogre, id: 'coward', name: 'Coward', keywords: [KEYWORD.CANT_BLOCK] };

const state = (game) => game.getState();
const passRound = (game) => {
  for (let i = 0; i < 2; i++) game.dispatch(passPriority(state(game).priorityPlayerId));
};
/** Passes (and makes empty declarations) until `done(state)`. */
const advanceUntil = (game, done) => {
  for (let i = 0; i < 500 && !done(state(game)); i++) {
    const { pendingDecision, validActions } = state(game);
    if (pendingDecision) game.dispatch(validActions.find((a) => a.type.startsWith('CONFIRM')) ?? validActions[0]);
    else game.dispatch(passPriority(state(game).priorityPlayerId));
  }
  assert.ok(done(state(game)), 'advanceUntil gave up');
};

/** Plays one attacker into some blockers in a real game; returns the engine's outcome. */
function engineCombat(attackerId, blockerIds) {
  const deck = (ids) => [...ids, ...Array(40 - ids.length).fill('forest')];
  const game = new Game({
    players, cards: FREE, shuffleLibraries: false, emblems: { p1: [], p2: [] },
    decks: { p1: deck([attackerId]), p2: deck(blockerIds) },
  });
  let playerDamage = 0;
  game.on('combatDamageDealt', ({ damage }) => {
    playerDamage += damage.filter((d) => d.targetPlayerId).reduce((sum, d) => sum + d.amount, 0);
  });
  game.start();
  passRound(game);
  const hand = (id) => state(game).players.find((p) => p.id === id).hand;
  const cast = (id, card) => {
    game.dispatch(castSpell(id, card.id));
    passRound(game);
  };
  cast('p1', hand('p1')[0]);
  advanceUntil(game, (s) => s.turn === 2 && s.phase === PHASE.PRECOMBAT_MAIN && s.priorityPlayerId === 'p2');
  for (const card of hand('p2').filter((c) => c.cardId !== 'forest')) cast('p2', card);
  advanceUntil(game, (s) => s.turn === 3 && s.pendingDecision?.type === DECISION.DECLARE_ATTACKERS);
  const attacker = state(game).battlefield.find((p) => p.controllerId === 'p1');
  const blockers = state(game).battlefield.filter((p) => p.controllerId === 'p2');
  game.dispatch(toggleAttacker('p1', attacker.id));
  game.dispatch(confirmAttackers('p1'));
  passRound(game);
  if (blockers.length && state(game).pendingDecision?.type !== DECISION.DECLARE_BLOCKERS) return null; // none can block
  if (state(game).pendingDecision?.type === DECISION.DECLARE_BLOCKERS) {
    for (const b of blockers) {
      if (game.dispatch(setBlocker('p2', b.id, attacker.id)).ok === false) return null; // can't block (flying)
    }
    const confirm = state(game).validActions.find((a) => a.type === ACTION.CONFIRM_BLOCKERS);
    if (!confirm) return null; // e.g. a lone blocker against menace
    game.dispatch(confirm);
  }
  const lifeBefore = state(game).players.map((p) => p.life);
  // Through combat damage, assigning as much to the player as possible when asked (as the predictor does).
  for (let i = 0; i < 100 && state(game).phase === PHASE.COMBAT; i++) {
    const { pendingDecision, validActions } = state(game);
    if (pendingDecision?.type === DECISION.ASSIGN_COMBAT_DAMAGE) {
      // Kill the most valuable blockers possible, then as much to the player as possible.
      const lethalTo = (id) => {
        const b = state(game).battlefield.find((p) => p.id === id);
        return attacker.keywords.includes(KEYWORD.DEATHTOUCH) ? 1 : b.toughness - b.damage;
      };
      const score = (a) => Object.entries(a.assignment)
        .reduce((sum, [id, n]) => sum + (id === 'p2' ? n
          : (n > 0 && n >= lethalTo(id) ? 100 * creatureValue(state(game).battlefield.find((p) => p.id === id)) : 0)), 0);
      game.dispatch(validActions.reduce((best, a) => (score(a) > score(best) ? a : best)));
    } else {
      game.dispatch(passPriority(state(game).priorityPlayerId));
    }
  }
  const lifeAfter = state(game).players.map((p) => p.life);
  const alive = new Set(state(game).battlefield.map((p) => p.id));
  return {
    prediction: resolveCombat(attacker, blockers),
    attackerDies: !alive.has(attacker.id),
    deadBlockers: blockers.filter((b) => !alive.has(b.id)).map((b) => b.id),
    playerDamage,
    attackerLifelink: lifeAfter[0] - lifeBefore[0],
  };
}

test('combat predictions match the engine for every attacker against no, one and two blockers', () => {
  const ids = Object.keys(FREE).filter((id) => id !== 'defenderWall');
  let compared = 0;
  for (const attackerId of ids) {
    const scenarios = [[], ...Object.keys(FREE).map((b) => [b]), ['ogre', 'deathtouchAsp'], ['reachSpider', 'firstStrikeElk']];
    for (const blockerIds of scenarios) {
      const outcome = engineCombat(attackerId, blockerIds);
      if (!outcome) continue;
      const { prediction } = outcome;
      const label = `${attackerId} vs [${blockerIds}]`;
      assert.equal(prediction.attackerDies, outcome.attackerDies, `${label}: attacker dies`);
      assert.deepEqual(prediction.deadBlockers.sort(), outcome.deadBlockers.sort(), `${label}: dead blockers`);
      assert.equal(prediction.playerDamage, outcome.playerDamage, `${label}: damage to the player`);
      assert.equal(prediction.attackerLifelink, outcome.attackerLifelink, `${label}: lifelink`);
      compared += 1;
    }
  }
  assert.ok(compared > 100, `compared ${compared} combats`);
});

const creature = (id, controllerId, power, toughness, keywords = [], extra = {}) => ({
  id, controllerId, power, toughness, keywords, types: ['Creature'], damage: 0, tapped: false, summoningSick: false, ...extra,
});
const board = (battlefield, { life = [20, 20], library = [30, 30], attackers = [] } = {}) => ({
  battlefield,
  players: [{ id: 'p1', life: life[0], library: Array(library[0]) }, { id: 'p2', life: life[1], library: Array(library[1]) }],
  combat: { attackers },
});

test('attacks: not into a bigger blocker, yes when it can\'t be blocked well, everything when lethal', () => {
  const bear = creature('bear', 'p1', 2, 2);
  const flyer = creature('flyer', 'p1', 2, 2, [KEYWORD.FLYING]);
  const wall = creature('wall', 'p2', 0, 5, [KEYWORD.DEFENDER]);
  const ogre = creature('ogre', 'p2', 3, 3);
  assert.deepEqual(planAttack(board([bear, flyer, ogre]), 'p1', [bear, flyer]), ['flyer']);
  assert.deepEqual(planAttack(board([bear, wall]), 'p1', [bear]), ['bear']); // the wall blocks but doesn't kill
  assert.deepEqual(planAttack(board([bear, flyer, ogre], { life: [20, 2] }), 'p1', [bear, flyer]).sort(), ['bear', 'flyer']);
});

test('attacks: keeps blockers home when the crack-back would be lethal', () => {
  const flyer = creature('flyer', 'p1', 1, 1, [KEYWORD.FLYING]);
  const wall = creature('wall', 'p1', 0, 4);
  const ogres = [creature('o1', 'p2', 3, 3), creature('o2', 'p2', 3, 3)];
  // Attacking with the flyer is safe, and the wall stays home anyway.
  assert.deepEqual(planAttack(board([flyer, wall, ...ogres], { life: [5, 20] }), 'p1', [flyer, wall]), ['flyer']);
});

test('blocks: kills attackers, trades up, and chumps only to survive', () => {
  const attack = (ids) => ids.map((cardId) => ({ cardId, blocked: false, blockerIds: [] }));
  const ogre = creature('ogre', 'p1', 3, 3);
  const bear = creature('bear', 'p1', 2, 2);
  const wall = creature('wall', 'p2', 0, 4);
  const elf = creature('elf', 'p2', 1, 1);
  const always = () => true;
  // The wall stops the ogre for free; the elf doesn't chump at 20 life.
  assert.deepEqual(planBlocks(board([ogre, wall, elf], { attackers: attack(['ogre']) }), 'p2', always), { wall: 'ogre' });
  assert.deepEqual(planBlocks(board([ogre, elf], { attackers: attack(['ogre']) }), 'p2', always), {});
  // At 3 life the elf chumps.
  assert.deepEqual(planBlocks(board([ogre, elf], { life: [20, 3], attackers: attack(['ogre']) }), 'p2', always), { elf: 'ogre' });
  // Two bears double-block the ogre and kill it.
  const bears = [creature('b1', 'p2', 2, 2), creature('b2', 'p2', 2, 2)];
  const plan = planBlocks(board([ogre, ...bears], { attackers: attack(['ogre']) }), 'p2', always);
  assert.deepEqual(plan, { b1: 'ogre', b2: 'ogre' });
  assert.ok(creatureValue(ogre) > creatureValue(bear));
});

test("creatures that can't block, and attackers that can't be blocked, aren't blocked", () => {
  assert.notEqual(engineCombat('ogre', ['ogre']), null);
  assert.equal(engineCombat('sneak', ['ogre']), null);
  assert.equal(engineCombat('ogre', ['coward']), null);
  const permanent = (id) => ({ ...FREE[id], tapped: false, damage: 0 });
  assert.equal(canBlock(permanent('ogre'), permanent('sneak')), false);
  assert.equal(canBlock(permanent('coward'), permanent('ogre')), false);
  assert.equal(canBlock(permanent('ogre'), permanent('ogre')), true);
});
