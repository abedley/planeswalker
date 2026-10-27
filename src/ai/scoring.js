/**
 * How good spells, abilities and their costs would be for a player, in the same
 * "points" as creatureValue (src/ai/combat.js). Shared by the AIs.
 */
import {
  isCreature, isPermanentCard, hasKeyword, cantAttack, KEYWORD, EFFECT, AFFECTED, TARGET, PLAYER_TARGETS, SPELL_TARGETS,
  effectAffects, matchesPermanentKind, matchesFilter, countOf, scaleEffect,
} from '../cards/cards.js';
import { creatureValue, anthemValue } from './combat.js';
import { doomedSacrificeCost } from './doomed.js';

/** A permanent's worth: creatures by creatureValue, other permanents a flat amount. */
export const permanentValue = (p) => (isCreature(p) ? 2 + creatureValue(p) : 4);

/** The ids a spell or ability of `kind` could target (an estimate: the engine decides legality). */
export function candidateTargets(state, me, kind) {
  if (kind === TARGET.PERMANENT_CARD_IN_YOUR_GRAVEYARD) {
    return state.players.find((p) => p.id === me).graveyard.filter(isPermanentCard).map((c) => c.id);
  }
  if (SPELL_TARGETS.has(kind)) return state.stack.filter((s) => s.kind === 'spell').map((s) => s.id);
  const players = state.players.filter((p) => !p.hasLost).map((p) => p.id);
  if (kind === TARGET.ANY) return [...state.battlefield.filter(isCreature).map((p) => p.id), ...players];
  if (PLAYER_TARGETS.has(kind)) return kind === TARGET.OPPONENT ? players.filter((id) => id !== me) : players;
  return state.battlefield.filter((p) => matchesPermanentKind(p, kind, me, state.combat)).map((p) => p.id);
}

/** The ids an effect applies to, for these targets. */
export function affectedIds(state, me, effect, targets, sourceId) {
  const opponentId = state.players.find((p) => p.id !== me).id;
  const creatures = state.battlefield.filter((p) => isCreature(p)
    && (!effect.filter || matchesFilter(p, { controller: 'any', ...effect.filter }, { controllerId: me, sourceId })));
  switch (effectAffects(effect)) {
    case AFFECTED.TARGET: return targets.filter(Boolean);
    case AFFECTED.YOU: return [me];
    case AFFECTED.EACH_OPPONENT: return [opponentId];
    case AFFECTED.EACH_PLAYER: return [me, opponentId];
    case AFFECTED.EACH_CREATURE: return creatures.map((p) => p.id);
    case AFFECTED.EACH_CREATURE_YOU_CONTROL: return creatures.filter((p) => p.controllerId === me).map((p) => p.id);
    case AFFECTED.EACH_CREATURE_OPPONENTS_CONTROL: return creatures.filter((p) => p.controllerId !== me).map((p) => p.id);
    case AFFECTED.SOURCE: return [sourceId];
    default: return [];
  }
}

/**
 * How good these effects would be for `me` with these targets: positive is good.
 * `options.preCombat` says whether combat-related bonuses count (tapping blockers,
 * pumping attackers).
 */
export function scoreEffects(state, me, effects, targets, sourceId, { preCombat = false } = {}) {
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
    const effect = given.per
      ? scaleEffect(given, countOf(given.per, { battlefield: state.battlefield, controllerId: me, sourceId, combat: state.combat }))
      : given;
    if (effect.type === EFFECT.FIGHT) {
      // 701.14: each deals damage equal to its power to the other.
      const [first, second] = targets.map(byId);
      if (!first || !second || !isCreature(first) || !isCreature(second)) continue;
      if (dies(second, first.power, first)) score -= side(second.id) * worth(second);
      if (dies(first, second.power, second)) score -= side(first.id) * worth(first);
      continue;
    }
    if (effect.type === EFFECT.RETURN_FROM_GRAVEYARD) {
      // A card back in hand: about as good as drawing one, better for a creature worth more.
      for (const id of targets) {
        const card = state.players.flatMap((p) => p.graveyard).find((c) => c.id === id);
        if (card) score += 2 + (isCreature(card) ? 0.2 * creatureValue(card) : 1);
      }
      continue;
    }
    for (const id of affectedIds(state, me, effect, targets, sourceId)) {
      const spell = state.stack.find((s) => s.id === id);
      if (spell) {
        if (effect.type === EFFECT.COUNTER_SPELL) score += spell.controllerId === me ? -8 : spellThreat(state, me, spell);
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
        default:
          break; // Mana and attaching aren't worth anything on their own.
      }
    }
  }
  return score;
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

/** The best score over the targets a spell or ability could have, with its cost. */
export function bestScore(state, me, effects, targetKind, cost = {}, sourceId, options) {
  // Outside combat, a spell for "target attacking (or blocking) creature" is judged on the
  // opponent's creatures, which may attack later.
  const laterKind = COMBAT_TARGETS.has(targetKind) && state.combat.attackers.length === 0 ? TARGET.CREATURE_OPPONENT_CONTROLS : targetKind;
  const candidates = laterKind ? candidateTargets(state, me, laterKind) : [null];
  if (candidates.length === 0) return -Infinity;
  // A "sacrifice a ..." cost: the cheapest thing that could be sacrificed.
  let sacrifice = 0;
  if (cost.sacrifice) {
    const fodder = state.battlefield.filter((p) => p.controllerId === me && matchesPermanentKind(p, cost.sacrifice, me));
    if (fodder.length === 0) return -Infinity;
    sacrifice = Math.min(...fodder.map((p) => -costScore(state, me, {}, { sacrifice: [p.id] }, sourceId)));
  }
  return Math.max(...candidates.map((id) => scoreEffects(state, me, effects, id ? [id] : [], sourceId, options)))
    + costScore(state, me, cost, { discard: Array(cost.discard ?? 0) }, sourceId) - sacrifice;
}
