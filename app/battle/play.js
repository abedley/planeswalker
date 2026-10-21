/**
 * What the human player can do right now, worked out so each play is one tap:
 * the mana is tapped automatically (with the same choices the AI makes), and only
 * real choices (a target, which creature to sacrifice, ...) are left to the player.
 *
 * The engine only offers CAST_SPELL once the mana is in the pool, so each option is
 * found with a dry run on a clone of the game: tap mana until the spell or ability
 * appears, then read its variants (one per target and cost choice). Nothing is
 * tapped for real until the player commits (perform()), so cancelling is free.
 */
import { ACTION } from '../../src/engine/actions.js';
import { isLand } from '../../src/cards/cards.js';
import { nextAction } from '../../src/ai/macroActions.js';
import { actingPlayerId } from '../../src/ai/simulate.js';

/**
 * Everything `me` can start doing, when they have priority: `[{ kind, sourceId,
 * abilityId?, variants, targets }]`, where `kind` is 'land', 'cast' or 'activate',
 * `variants` are the final actions (after mana), and `targets` are the distinct
 * target ids (empty when it doesn't target). Mana abilities aren't listed: paying
 * is automatic.
 */
export function playOptions(game, me) {
  const state = game.peekState();
  if (state.pendingDecision || actingPlayerId(state) !== me) return [];
  const options = [];
  for (const action of state.validActions) {
    if (action.playerId === me && action.type === ACTION.PLAY_LAND) {
      options.push({ kind: 'land', sourceId: action.cardId, variants: [action], targets: [] });
    }
  }
  const player = state.players.find((p) => p.id === me);
  for (const card of player.hand) {
    if (isLand(card)) continue;
    const option = prepare(game, state, me, { kind: 'cast', cardId: card.id, targetId: null });
    if (option) options.push(option);
  }
  const sources = [...state.battlefield.filter((p) => p.controllerId === me), ...player.emblems];
  for (const source of sources) {
    for (const ability of source.abilities) {
      if (ability.isManaAbility) continue;
      const option = prepare(game, state, me, { kind: 'activate', cardId: source.id, abilityId: ability.id, targetId: null });
      if (option) options.push(option);
    }
  }
  return options;
}

const matching = (state, me, macro) => state.validActions.filter((a) => a.playerId === me
  && a.type === (macro.kind === 'cast' ? ACTION.CAST_SPELL : ACTION.ACTIVATE_ABILITY)
  && a.cardId === macro.cardId && (macro.kind === 'cast' || a.abilityId === macro.abilityId));

function option(macro, variants) {
  return {
    kind: macro.kind,
    sourceId: macro.cardId,
    ...(macro.abilityId ? { abilityId: macro.abilityId } : {}),
    variants,
    targets: [...new Set(variants.map((v) => v.targets?.[0]).filter((t) => t !== undefined))],
  };
}

/** The option for a cast or activation, if its cost can be paid; dry-runs the mana on a clone. */
function prepare(game, state, me, macro) {
  let step = nextAction(state, me, macro);
  if (!step) return null;
  if (step.done) return option(macro, matching(state, me, macro));
  const sim = game.clone();
  for (let i = 0; i < 30 && step && !step.done; i++) {
    sim.applyTrusted(step.action);
    step = nextAction(sim.peekState(), me, macro);
  }
  return step?.done ? option(macro, matching(sim.peekState(), me, macro)) : null;
}

/** The variants of an option for one target (`null` for an untargeted one). */
export const variantsFor = (option, targetId = null) => option.variants
  .filter((v) => (targetId === null ? !v.targets?.length : v.targets?.[0] === targetId));

/**
 * Carries out an option for real: taps mana as the dry run did, then dispatches
 * `variant` (one of the option's variants). Returns the engine's result.
 */
export function perform(game, me, option, variant) {
  if (option.kind === 'land') return game.dispatch(variant);
  const macro = {
    kind: option.kind, cardId: option.sourceId, abilityId: option.abilityId, targetId: variant.targets?.[0] ?? null,
  };
  for (let i = 0; i < 30; i++) {
    const state = game.peekState();
    if (state.validActions.some((a) => sameAction(a, variant))) return game.dispatch(variant);
    const step = nextAction(state, me, macro);
    if (!step || step.done) break;
    const result = game.dispatch(step.action);
    if (!result.ok) return result;
  }
  return { ok: false, reason: 'It can no longer be paid for.' };
}

/** Whether two actions are the same (the way the engine compares them). */
export function sameAction(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => sameAction(a[key], b[key]));
}
