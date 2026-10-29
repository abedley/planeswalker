/**
 * How good spells, abilities and their costs would be for a player, in the same
 * "points" as creatureValue (src/ai/combat.js). Shared by the AIs.
 */
import {
  isCreature, isPermanentCard, hasKeyword, cantAttack, KEYWORD, EFFECT, AFFECTED, TARGET, PLAYER_TARGETS, SPELL_TARGETS,
  effectAffects, matchesPermanentKind, matchesFilter, countOf, scaleEffect, targetKindOf, targetFilterOf, isOptionalTarget,
  GRAVEYARD_TARGETS, abilityEffects, targetList,
} from '../cards/cards.js';
import { creatureValue, anthemValue } from './combat.js';
import { doomedSacrificeCost } from './doomed.js';

/** A permanent's worth: creatures by creatureValue, other permanents a flat amount. */
export const permanentValue = (p) => (isCreature(p) ? 2 + creatureValue(p) : 4);

/**
 * The ids a spell or ability of `kind` (a TARGET kind or a spec, see targetKindOf)
 * could target (an estimate: the engine decides legality). `sourceId` is the spell's
 * or ability's source ("another target").
 */
export function candidateTargets(state, me, kind, sourceId = null, x = null) {
  const base = targetKindOf(kind);
  const filter = targetFilterOf(kind);
  const passes = (object) => !filter || matchesFilter(object, { controller: 'any', ...filter }, {
    controllerId: me, sourceId, combat: state.combat, turn: state.turn, x,
  });
  if (GRAVEYARD_TARGETS.has(base)) {
    return state.players.find((p) => p.id === me).graveyard
      .filter((c) => (base !== TARGET.PERMANENT_CARD_IN_YOUR_GRAVEYARD || isPermanentCard(c)) && passes({ ...c, controllerId: me }))
      .map((c) => c.id);
  }
  if (SPELL_TARGETS.has(base)) {
    return state.stack.filter((s) => s.kind === 'spell'
      && (base !== TARGET.CREATURE_SPELL || isCreature(s.card)) && (base !== TARGET.NONCREATURE_SPELL || !isCreature(s.card))
      && passes({ ...s.card, controllerId: s.controllerId })).map((s) => s.id);
  }
  const players = state.players.filter((p) => !p.hasLost).map((p) => p.id);
  const other = typeof kind === 'object' && kind?.other;
  const permanents = state.battlefield.filter((p) => matchesPermanentKind(p, base, me, state.combat) && passes(p)
    && !(other && p.id === sourceId)
    // 702.11b: hexproof.
    && !(p.controllerId !== me && hasKeyword(p, KEYWORD.HEXPROOF)));
  if (base === TARGET.ANY) return [...permanents.map((p) => p.id), ...players];
  if (PLAYER_TARGETS.has(base)) return base === TARGET.OPPONENT ? players.filter((id) => id !== me) : players;
  return permanents.map((p) => p.id);
}

/**
 * Every combination of targets for these kinds (different objects, null for an optional
 * one left out), at most `limit` of them; [[]] when there are none to choose. `x` is X,
 * for "target creature with power X".
 */
export function targetCombos(state, me, kinds, sourceId = null, limit = 400, x = null) {
  let combos = [[]];
  for (const kind of kinds) {
    const candidates = candidateTargets(state, me, kind, sourceId, x);
    combos = combos.flatMap((chosen) => [
      ...candidates.filter((id) => !chosen.includes(id)).map((id) => [...chosen, id]),
      ...(isOptionalTarget(kind) ? [[...chosen, null]] : []),
    ]).slice(0, limit);
  }
  return combos;
}

/** The ids an effect applies to, for these targets. */
export function affectedIds(state, me, effect, targets, sourceId) {
  const opponentId = state.players.find((p) => p.id !== me).id;
  const creatures = state.battlefield.filter((p) => isCreature(p)
    && (!effect.filter || matchesFilter(p, { controller: 'any', ...effect.filter }, { controllerId: me, sourceId })));
  const aimed = (effect.targetIndex !== undefined ? [targets[effect.targetIndex]] : targets).filter(Boolean);
  switch (effectAffects(effect)) {
    case AFFECTED.TARGET: return aimed;
    case AFFECTED.YOU: return [me];
    case AFFECTED.EACH_OPPONENT: return [opponentId];
    case AFFECTED.EACH_PLAYER: return [me, opponentId];
    case AFFECTED.EACH_CREATURE: return creatures.map((p) => p.id);
    case AFFECTED.EACH_CREATURE_YOU_CONTROL: return creatures.filter((p) => p.controllerId === me).map((p) => p.id);
    case AFFECTED.EACH_CREATURE_OPPONENTS_CONTROL: return creatures.filter((p) => p.controllerId !== me).map((p) => p.id);
    case AFFECTED.SOURCE: return [sourceId];
    case AFFECTED.ATTACHED_PERMANENT: {
      const host = state.battlefield.find((p) => p.id === sourceId)?.attachedTo;
      return host ? [host] : [];
    }
    case AFFECTED.TARGET_CONTROLLER:
      return aimed.map((id) => state.battlefield.find((p) => p.id === id)?.controllerId ?? state.stack.find((o) => o.id === id)?.controllerId).filter(Boolean);
    case AFFECTED.YOU_AND_TARGET: return [me, ...aimed];
    default: return [];
  }
}

/**
 * An effect's "for each" / "where X is" amount as it would be now: X (`options.x`), a
 * target's power, or a count on the battlefield.
 */
function amountFor(state, me, per, targets, sourceId, options = {}) {
  if (per.sum) return per.sum.reduce((total, part) => total + amountFor(state, me, part, targets, sourceId, options), 0);
  if (per.of === 'x') return options.x ?? 0;
  if (per.of === 'powerOf') {
    const id = per.who === 'source' || per.who === 'subject' ? sourceId : targets[per.index ?? 0];
    return Math.max(0, state.battlefield.find((p) => p.id === id)?.power ?? 0);
  }
  // An Army that doesn't exist yet: amass usually makes it about as big as its count.
  if (per.of === 'amassedArmyPower') return 2;
  return countOf(per, { battlefield: state.battlefield, controllerId: me, sourceId, combat: state.combat, players: state.players });
}

/**
 * How good these effects would be for `me` with these targets: positive is good.
 * `options.preCombat` says whether combat-related bonuses count (tapping blockers,
 * pumping attackers).
 */
export function scoreEffects(state, me, effects, targets, sourceId, options = {}) {
  const { preCombat = false } = options;
  const byId = (id) => state.battlefield.find((p) => p.id === id);
  const playerById = (id) => state.players.find((p) => p.id === id);
  // +1 for things that are ours, -1 for things that are the opponent's.
  const side = (id) => ((id === me || byId(id)?.controllerId === me) ? 1 : -1);
  const canAttack = (c) => !c.tapped && (!c.summoningSick || hasKeyword(c, KEYWORD.HASTE)) && !cantAttack(c);
  // Damage and life loss to a player, more valuable as their life gets low; lethal is decisive.
  const lifeScore = (id, amount) => {
    const { life } = playerById(id);
    if (amount >= life) return side(id) > 0 ? -1000 : 1000;
    return -side(id) * amount * (life - amount <= 5 ? 1.5 : life - amount <= 10 ? 0.8 : 0.5) * (side(id) > 0 ? 1.5 : 1);
  };
  // Removing a permanent loses its controller the permanent, and what it gives their creatures (an anthem or lord).
  const worth = (p) => permanentValue(p) + anthemValue(state, p.controllerId, p);
  // Dying: lethal damage, counting damage already marked and deathtouch.
  const dies = (creature, amount, source) => amount > 0
    && (creature.toughness - creature.damage <= amount || hasKeyword(source, KEYWORD.DEATHTOUCH));
  let score = 0;
  for (const given of effects) {
    // "For each" amounts, as they'd be now.
    const effect = given.per ? scaleEffect(given, amountFor(state, me, given.per, targets, sourceId, { x: options.x })) : given;
    // Branches and choices: as good as what they'd do (for "if", the first branch).
    if (effect.type === EFFECT.IF) {
      score += Math.max(scoreEffects(state, me, effect.then, targets, sourceId, options), scoreEffects(state, me, effect.else ?? [], targets, sourceId, options));
      continue;
    }
    if (effect.type === EFFECT.MAY) {
      score += Math.max(0, scoreEffects(state, me, effect.effects, targets, sourceId, options));
      continue;
    }
    if (effect.type === EFFECT.REFLEXIVE_TRIGGER) {
      // "When you do, …": its best target, as it would be chosen then.
      const { ability } = effect;
      const modes = ability.modes ?? [ability];
      score += Math.max(0, ...modes.map((mode) => Math.max(...targetCombos(state, me, targetList(mode), sourceId)
        .map((t) => scoreEffects(state, me, abilityEffects(mode), t, sourceId, options)))));
      continue;
    }
    if (effect.type === EFFECT.FIGHT) {
      // 701.14: each deals damage equal to its power to the other.
      const [first, second] = (effect.targetIndexes ?? [0, 1]).map((i) => byId(targets[i]));
      if (!first || !second || !isCreature(first) || !isCreature(second)) continue;
      if (dies(second, first.power, first)) score -= side(second.id) * worth(second);
      if (dies(first, second.power, second)) score -= side(first.id) * worth(first);
      continue;
    }
    if (effect.type === EFFECT.RETURN_SOURCE_FROM_GRAVEYARD) {
      // This card back: to the hand (about a card drawn) or onto the battlefield.
      const card = state.players.flatMap((p) => p.graveyard).find((c) => c.id === sourceId);
      if (card) score += effect.to === 'battlefield' && isCreature(card) ? 2 + creatureValue(card) : 2.5;
      continue;
    }
    if (effect.type === EFFECT.RETURN_FROM_GRAVEYARD) {
      // A card back in hand: about as good as drawing one, better for a creature worth more.
      for (const id of targets) {
        const card = state.players.flatMap((p) => p.graveyard).find((c) => c.id === id);
        if (card) score += 2 + (isCreature(card) ? (effect.to === 'battlefield' ? creatureValue(card) : 0.2 * creatureValue(card)) : 1);
      }
      continue;
    }
    for (const id of affectedIds(state, me, effect, targets, sourceId)) {
      const spell = state.stack.find((s) => s.id === id);
      if (spell) {
        if (effect.type === EFFECT.COUNTER_SPELL) score += spell.controllerId === me ? -8 : spellThreat(state, me, spell);
        if (effect.type === EFFECT.RETURN_SPELL_TO_HAND) score += spell.controllerId === me ? -4 : 0.5 * spellThreat(state, me, spell);
        continue;
      }
      const permanent = byId(id);
      const isPlayer = !permanent && state.players.some((p) => p.id === id);
      if (!permanent && !isPlayer) continue;
      switch (effect.type) {
        case EFFECT.DEAL_DAMAGE:
          if (isPlayer) score += lifeScore(id, effect.amount);
          else if (isCreature(permanent) && permanent.toughness - permanent.damage <= effect.amount) {
            score -= side(id) * worth(permanent);
          }
          break;
        case EFFECT.DESTROY:
        case EFFECT.EXILE:
          score -= side(id) * worth(permanent);
          break;
        case EFFECT.RETURN_TO_HAND:
          score -= side(id) * (permanent.token ? worth(permanent) : worth(permanent) / 2);
          break;
        case EFFECT.TAP:
          // Tapping a would-be blocker before attacking.
          if (!permanent.tapped && isCreature(permanent) && preCombat) score -= side(id) * 2;
          break;
        case EFFECT.UNTAP: {
          if (!permanent.tapped) break;
          // An untapped creature can block (or attack again); one with a {T} ability can use it again.
          const reuse = (permanent.abilities ?? []).some((a) => a.cost?.tap) ? 2 : 0;
          score += side(id) * (1 + reuse + (isCreature(permanent) ? 0.2 * creatureValue(permanent) : 0));
          break;
        }
        case EFFECT.PUMP: {
          if (!isCreature(permanent)) break;
          // "Has base power and toughness 5/5": like a pump by the difference.
          if (effect.setBase) {
            score += side(id) * 0.3 * ((effect.setBase.power - permanent.power) + (effect.setBase.toughness - permanent.toughness));
            break;
          }
          if (effect.loseAbilities) score -= side(id) * 0.3 * (permanent.keywords?.length ?? 0);
          if (effect.keywordChoice) score += side(id) * 1;
          const toughness = permanent.toughness + (effect.toughness ?? 0);
          const granted = effect.keywords ?? [];
          if (toughness - permanent.damage <= 0) score -= side(id) * permanentValue(permanent);
          else if (side(id) > 0 && preCombat && canAttack(permanent) && (effect.power ?? 0) > 0) score += 2;
          // Before combat: a blocker that can't block, like a tapped one; an attacker that can't be blocked.
          if (granted.includes(KEYWORD.CANT_BLOCK) && preCombat && !permanent.tapped && !hasKeyword(permanent, KEYWORD.CANT_BLOCK)) {
            score -= side(id) * 2;
          }
          if (granted.includes(KEYWORD.CANT_BE_BLOCKED) && side(id) > 0 && preCombat && canAttack(permanent)
            && !hasKeyword(permanent, KEYWORD.CANT_BE_BLOCKED)) {
            score += 1 + 0.5 * Math.max(0, permanent.power + (effect.power ?? 0));
          }
          break;
        }
        case EFFECT.ADD_COUNTERS:
          if (isCreature(permanent)) score += side(id) * 3 * (effect.count ?? 1);
          break;
        case EFFECT.GAIN_LIFE: {
          const { life } = playerById(id);
          score += side(id) * effect.amount * (life <= 5 ? 1.5 : life <= 10 ? 1 : 0.4);
          break;
        }
        case EFFECT.LOSE_LIFE:
          score += lifeScore(id, effect.amount);
          break;
        case EFFECT.DRAW_CARDS:
          score += side(id) * 2 * effect.count;
          break;
        case EFFECT.MILL:
          score -= side(id) * 0.3 * effect.count;
          break;
        case EFFECT.CREATE_TOKEN: {
          const each = typeof effect.token === 'string' ? 2 : 2 + creatureValue({ ...effect.token, types: ['Creature'] });
          score += side(id) * each * (effect.count ?? 1);
          break;
        }
        case EFFECT.SCRY:
          score += side(id) * 0.5 * effect.count;
          break;
        case EFFECT.RING_TEMPTS: {
          // A Ring-bearer gets evasion, then card selection, then more: worth it with creatures around.
          const creatures = state.battlefield.filter((p) => p.controllerId === id && isCreature(p)).length;
          const level = playerById(id)?.ring?.level ?? 0;
          score += side(id) * (level >= 4 ? 0.5 : creatures ? 2.5 : 1);
          break;
        }
        case EFFECT.AMASS:
          score += side(id) * 3 * (effect.count ?? 1);
          break;
        case EFFECT.DISCARD:
          score -= side(id) * 1.5 * (effect.count ?? 1);
          break;
        case EFFECT.REVEAL_HAND_DISCARD:
          score -= side(id) * 3;
          break;
        case EFFECT.SEARCH_LIBRARY:
          score += side(id) * 2 * (effect.count ?? 1);
          break;
        case EFFECT.SACRIFICE: {
          // They lose their least valuable creature.
          const theirs = state.battlefield.filter((p) => p.controllerId === id && isCreature(p));
          if (theirs.length) score -= side(id) * Math.min(...theirs.map((p) => (p.token ? creatureValue(p) : worth(p))));
          break;
        }
        case EFFECT.PUT_INTO_LIBRARY:
        case EFFECT.EXILE_UNTIL_SOURCE_LEAVES:
          if (permanent) score -= side(id) * worth(permanent);
          break;
        case EFFECT.GAIN_CONTROL:
          if (permanent) score -= side(id) * (effect.untilEndOfTurn ? 2 + 0.5 * Math.max(0, permanent.power ?? 0) : 2 * worth(permanent));
          break;
        case EFFECT.EXILE_GRAVEYARD:
          score -= side(id) * 0.5;
          break;
        default:
          break; // Mana and attaching aren't worth anything on their own.
      }
    }
  }
  return score;
}

/**
 * Whether these effects are only damage to the target and these targets wouldn't
 * die of it: burn (a Shock) is kept for a kill, a creature or the player, rather
 * than chipped in for a little damage.
 */
export function wastedDamage(state, me, effects, targets, sourceId) {
  if (!effects?.length || !effects.every((e) => e.type === EFFECT.DEAL_DAMAGE && effectAffects(e) === AFFECTED.TARGET)) return false;
  const source = state.battlefield.find((p) => p.id === sourceId);
  const amount = effects.reduce((sum, e) => sum + (e.per
    ? scaleEffect(e, countOf(e.per, { battlefield: state.battlefield, controllerId: me, sourceId, combat: state.combat })).amount
    : e.amount), 0);
  return targets.filter(Boolean).every((id) => {
    const player = state.players.find((p) => p.id === id);
    if (player) return amount < player.life;
    const permanent = state.battlefield.find((p) => p.id === id);
    if (!permanent || !isCreature(permanent)) return true;
    if (amount > 0 && source && hasKeyword(source, KEYWORD.DEATHTOUCH)) return false;
    return permanent.toughness - (permanent.damage ?? 0) > amount;
  });
}

/** How bad a spell on the stack is for `me` if it resolves (used for counterspells). */
export function spellThreat(state, me, spell) {
  const { card } = spell;
  if (!card) return 0;
  if (isCreature(card)) return 2 + creatureValue(card);
  if (!card.spell) return 4;
  // Its effects from its controller's point of view are its threat to us.
  return Math.max(0, scoreEffects(state, spell.controllerId, card.spell.effects, spell.targets ?? [], card.id));
}

/**
 * What paying a cost's sacrifices, discards and life would lose `me` (zero or
 * negative). With `doomed` (doomedCreatures), a creature about to die anyway costs
 * little to sacrifice (doomedSacrificeCost).
 */
export function costScore(state, me, cost, costChoices, sourceId, doomed = null) {
  const byId = (id) => state.battlefield.find((p) => p.id === id);
  const sacrificed = [...(cost.sacrificeSelf ? [sourceId] : []), ...(costChoices.sacrifice ?? [])].map(byId);
  const life = state.players.find((p) => p.id === me).life;
  const value = (p) => doomedSacrificeCost(state, me, p.id, doomed)
    ?? (isCreature(p) ? (p.token ? creatureValue(p) : permanentValue(p)) : 1);
  return -(cost.life ?? 0) * (life <= 10 ? 1 : 0.4)
    - sacrificed.reduce((sum, p) => sum + (p ? value(p) : 0), 0)
    - (costChoices.discard?.length ?? 0) * 2;
}

const COMBAT_TARGETS = new Set([TARGET.ATTACKING_CREATURE, TARGET.ATTACKING_OR_BLOCKING_CREATURE]);

/** The best score over the targets a spell or ability could have, with its cost (`options`: see scoreEffects, and `killsOnly`). */
export function bestScore(state, me, effects, targetKind, cost = {}, sourceId, options) {
  // Outside combat, a spell for "target attacking (or blocking) creature" is judged on the
  // opponent's creatures, which may attack later.
  const later = (kind) => (COMBAT_TARGETS.has(kind) && state.combat.attackers.length === 0 ? TARGET.CREATURE_OPPONENT_CONTROLS : kind);
  const kinds = (Array.isArray(targetKind) ? targetKind : targetKind ? [targetKind] : []).map(later);
  const combos = targetCombos(state, me, kinds, sourceId);
  if (combos.length === 0) return -Infinity;
  // A "sacrifice a ..." cost: the cheapest thing that could be sacrificed.
  let sacrifice = 0;
  if (cost.sacrifice) {
    const fodder = sacrificeCandidates(state, me, cost.sacrifice, sourceId);
    if (fodder.length === 0) return -Infinity;
    sacrifice = Math.min(...fodder.map((p) => -costScore(state, me, {}, { sacrifice: [p.id] }, sourceId)));
  }
  // `options.killsOnly`: burn counts only on targets it kills (wastedDamage).
  const useful = options?.killsOnly ? combos.filter((targets) => !wastedDamage(state, me, effects, targets.filter(Boolean), sourceId)) : combos;
  if (useful.length === 0) return -Infinity;
  return Math.max(...useful.map((targets) => scoreEffects(state, me, effects, targets, sourceId, options)))
    + costScore(state, me, cost, { discard: Array(cost.discard ?? 0) }, sourceId) - sacrifice;
}

/** What a "sacrifice a ..." cost (a TARGET kind, or `{ kind, filter, other }`) could take of `me`'s. */
export function sacrificeCandidates(state, me, sacrifice, sourceId) {
  const spec = typeof sacrifice === 'string' ? { kind: sacrifice } : sacrifice;
  return state.battlefield.filter((p) => p.controllerId === me && matchesPermanentKind(p, spec.kind, me)
    && !(spec.other && p.id === sourceId)
    && (!spec.filter || matchesFilter(p, { controller: 'any', ...spec.filter }, { controllerId: me, sourceId })));
}
