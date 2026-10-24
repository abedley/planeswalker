/**
 * Combat tricks (instants that pump a creature), from Forge's AI:
 * - playing around them: not attacking into a block that a trick in the
 *   defender's hand would turn into a blowout, when they have the mana up and are
 *   likely enough to hold one (CHANCE_TO_ATKTRADE_WHEN_OPP_HAS_MANA);
 * - attacking with them: sending a creature into a block that looks good for the
 *   defender when our own trick wins that fight (TRY_TO_HOLD_COMBAT_TRICKS_UNTIL_BLOCK),
 *   one creature a turn.
 *
 * What the defender might hold is judged from their deck list (their hand and library
 * together, as Game#getPlayerView allows), not from their hand.
 */
import {
  isCreature, isInstant, isLand, manaValue, hasKeyword, EFFECT, AFFECTED, KEYWORD, effectAffects, COUNTER,
} from '../cards/cards.js';
import { manaPoolTotal } from '../engine/mana.js';
import { resolveCombat, canBlock, damageThrough, creatureValue } from './combat.js';

/**
 * A card's combat trick, `{ power, toughness, keywords, manaValue }`, or null: an
 * instant whose effects on its target creature add up to a bonus.
 */
export function trickOf(card) {
  // A card in a game has `spell`; a card definition has its effects directly.
  const effects = card.spell?.effects ?? card.effects;
  if (!isInstant(card) || !effects) return null;
  let power = 0;
  let toughness = 0;
  const keywords = [];
  for (const e of effects) {
    if (effectAffects(e) !== AFFECTED.TARGET) continue;
    if (e.type === EFFECT.PUMP) {
      power += e.power ?? 0;
      toughness += e.toughness ?? 0;
      keywords.push(...(e.keywords ?? []));
    } else if (e.type === EFFECT.ADD_COUNTERS && e.counter === COUNTER.PLUS_ONE) {
      power += e.count ?? 1;
      toughness += e.count ?? 1;
    }
  }
  if (power < 0 || toughness < 0 || power + toughness <= 0) return null;
  return { power, toughness, keywords, manaValue: manaValue(card.manaCost ?? {}) };
}

/** A creature as it would be with `trick` on it. */
export const pumped = (creature, trick) => ({
  ...creature,
  power: creature.power + trick.power,
  toughness: creature.toughness + trick.toughness,
  keywords: [...(creature.keywords ?? []), ...trick.keywords],
});

/** The mana a player could spend now: untapped lands and their mana pool. */
export function openMana(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  const lands = state.battlefield.filter((p) => p.controllerId === playerId && isLand(p) && !p.tapped).length;
  return lands + manaPoolTotal(player.manaPool);
}

/**
 * The chance that `playerId` holds at least one of the tricks they could cast now,
 * and the biggest of them: their hand is a random draw from their hand and library.
 */
export function trickThreat(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  const handSize = player.hand?.length ?? player.handSize ?? 0;
  const mana = openMana(state, playerId);
  const pool = [...(player.hand ?? []), ...(player.library ?? [])];
  const tricks = pool.map(trickOf).filter((t) => t && t.manaValue <= mana);
  if (handSize === 0 || tricks.length === 0) return { chance: 0, trick: null };
  // Hypergeometric: the chance that none of `handSize` cards is one of them.
  let none = 1;
  for (let i = 0; i < handSize; i++) none *= Math.max(0, pool.length - tricks.length - i) / (pool.length - i);
  const trick = tricks.reduce((best, t) => (t.power + t.toughness > best.power + best.toughness ? t : best));
  return { chance: 1 - none, trick };
}

/** Whether `blocker` holding off `attacker` would, with `trick` on the blocker, kill it and live. */
function blownOut(attacker, blocker, trick) {
  const before = resolveCombat(attacker, [blocker]);
  if (before.attackerDies) return false;
  const after = resolveCombat(attacker, [pumped(blocker, trick)]);
  return after.attackerDies && after.deadBlockers.length === 0;
}

/**
 * The attack `attackIds` without the attackers a trick would blow out, when the
 * defender is at least `threshold` likely to hold one (and the attack isn't lethal).
 */
export function playAroundTricks(state, me, attackIds, threshold = 0.3) {
  const opponent = state.players.find((p) => p.id !== me);
  const { chance, trick } = trickThreat(state, opponent.id);
  if (!trick || chance < threshold || attackIds.length === 0) return attackIds;
  const byId = (id) => state.battlefield.find((p) => p.id === id);
  const attackers = attackIds.map(byId);
  const blockers = state.battlefield.filter((p) => p.controllerId === opponent.id && isCreature(p) && !p.tapped);
  if (damageThrough(attackers, blockers) >= opponent.life) return attackIds;
  return attackers
    // A creature with menace needs two blockers, which this doesn't weigh.
    .filter((a) => hasKeyword(a, KEYWORD.MENACE) || !blockers.some((b) => canBlock(b, a) && blownOut(a, b, trick)))
    .map((a) => a.id);
}

/**
 * The attack `attackIds`, plus one of `candidates` that the defender would block
 * well but loses that fight to a trick in our hand we can pay for: the one whose
 * likely blocker is worth the most.
 */
export function baitWithTricks(state, me, attackIds, candidates) {
  const player = state.players.find((p) => p.id === me);
  const mana = openMana(state, me);
  const tricks = player.hand.map(trickOf).filter((t) => t && t.manaValue <= mana);
  if (tricks.length === 0) return attackIds;
  const opponent = state.players.find((p) => p.id !== me);
  const blockers = state.battlefield.filter((p) => p.controllerId === opponent.id && isCreature(p) && !p.tapped);
  let best = null;
  for (const attacker of candidates) {
    if (attackIds.includes(attacker.id) || attacker.power <= 0 || hasKeyword(attacker, KEYWORD.MENACE)) continue;
    const able = blockers.filter((b) => canBlock(b, attacker));
    // The blocks that look good to them: ours dies, theirs lives.
    const good = able.filter((b) => {
      const result = resolveCombat(attacker, [b]);
      return result.attackerDies && result.deadBlockers.length === 0;
    });
    if (good.length === 0) continue;
    // A trick that wins every one of those fights.
    const wins = tricks.some((t) => good.every((b) => {
      const result = resolveCombat(pumped(attacker, t), [b]);
      return !result.attackerDies && result.deadBlockers.length === 1;
    }));
    if (!wins) continue;
    const prize = Math.max(...good.map(creatureValue));
    if (!best || prize > best.prize) best = { id: attacker.id, prize };
  }
  return best ? [...attackIds, best.id] : attackIds;
}
