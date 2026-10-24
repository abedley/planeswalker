/**
 * Creatures that will die anyway, so removal on them is wasted (Forge's
 * AVOID_TARGETING_CREATS_THAT_WILL_DIE):
 * - `combat`: the combatants the fight will kill: once blockers are declared, or,
 *   when we're attacked, with the blocks we plan (chooseBlocks);
 * - `stack`: creatures that a spell or ability already on the stack will destroy,
 *   exile, or deal lethal damage to.
 */
import { isCreature, EFFECT, AFFECTED, effectAffects } from '../cards/cards.js';
import { STEP } from '../engine/turnStructure.js';
import {
  resolveCombat, combatValue, damageWeight, creatureValue, chooseBlocks, canBlock,
} from './combat.js';

/** Whether `effect`, applied to `creature` as its target, kills it. */
export function kills(effect, creature) {
  if (effectAffects(effect) !== AFFECTED.TARGET) return false;
  const left = creature.toughness - (creature.damage ?? 0);
  switch (effect.type) {
    case EFFECT.DESTROY:
    case EFFECT.EXILE:
      return true;
    case EFFECT.DEAL_DAMAGE:
      return effect.amount >= left;
    case EFFECT.PUMP:
      return left + (effect.toughness ?? 0) <= 0;
    default:
      return false;
  }
}

const effectsOf = (stackObject) => stackObject.effects ?? stackObject.card?.spell?.effects ?? [];

/** The combat's attackers with their blockers, as resolveCombat takes them. */
function combatPairs(state, without = null) {
  const byId = (id) => (id === without ? null : state.battlefield.find((p) => p.id === id));
  return state.combat.attackers
    .map(({ cardId, blockerIds, blocked }) => ({
      attacker: byId(cardId),
      blockers: blockerIds.map(byId).filter(Boolean),
      blocked: blocked ?? blockerIds.length > 0,
    }))
    .filter((pair) => pair.attacker);
}

/**
 * The combat as it will be fought, seen by `me`: the declared blocks, or, while
 * `me` is being attacked and hasn't blocked yet, the blocks `me` plans. Null outside
 * combat.
 */
export function combatAhead(state, me) {
  if (state.combat.attackers.length === 0) return null;
  if (state.step === STEP.DECLARE_BLOCKERS) return state;
  if (state.step !== STEP.DECLARE_ATTACKERS || state.activePlayerId === me || state.pendingDecision) return null;
  const byId = (id) => state.battlefield.find((p) => p.id === id);
  const blocks = chooseBlocks(state, me, (b, a) => canBlock(byId(b), byId(a)));
  const attackers = state.combat.attackers.map((a) => {
    const blockerIds = Object.keys(blocks).filter((b) => blocks[b] === a.cardId);
    return { ...a, blockerIds, blocked: blockerIds.length > 0 };
  });
  return { ...state, combat: { ...state.combat, attackers } };
}

/**
 * Creatures that will die anyway, seen by `me`: id → `{ reason: 'combat' | 'stack', combat }`,
 * where `combat` is combatAhead's state for those dying in combat.
 */
export function doomedCreatures(state, me) {
  const doomed = new Map();
  for (const object of state.stack) {
    const target = state.battlefield.find((p) => p.id === object.targets?.[0]);
    if (target && isCreature(target) && effectsOf(object).some((e) => kills(e, target))) doomed.set(target.id, { reason: 'stack' });
  }
  const combat = combatAhead(state, me);
  if (combat) {
    for (const { attacker, blockers, blocked } of combatPairs(combat)) {
      if (doomed.has(attacker.id) || blockers.some((b) => doomed.has(b.id))) continue;
      const result = resolveCombat(attacker, blockers, { blocked });
      if (result.attackerDies) doomed.set(attacker.id, { reason: 'combat', combat });
      for (const id of result.deadBlockers) doomed.set(id, { reason: 'combat', combat });
    }
  }
  return doomed;
}

/**
 * What removing a doomed creature `targetId` before combat damage is still worth
 * to `me`, in the combat `state` (see combatAhead): the rest of the combat going
 * better for us (our creatures it would have killed, damage it would have dealt).
 * Its own death was coming anyway.
 */
export function savedByRemoving(state, me, targetId) {
  if (state.combat.attackers.length === 0) return 0;
  const defender = state.players.find((p) => p.id !== state.activePlayerId);
  const weight = { damageWeight: damageWeight(defender.life) };
  const sign = state.activePlayerId === me ? 1 : -1;
  const target = state.battlefield.find((p) => p.id === targetId);
  const before = sign * combatValue(combatPairs(state), weight);
  // Without it, the combat doesn't count its death: add that back.
  const ownerSign = target.controllerId === me ? -1 : 1;
  const after = sign * combatValue(combatPairs(state, targetId), weight) + ownerSign * creatureValue(target);
  return after - before;
}
