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
import { manaSources, chooseManaAction } from '../../src/ai/manaPlanning.js';

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
    if (!isLand(card)) {
      const option = prepare(game, state, me, { kind: 'cast', cardId: card.id, targetId: null }, card.manaCost?.X);
      if (option) options.push(option);
    }
    // Abilities that work from the hand: cycling.
    for (const ability of card.handAbilities ?? []) {
      const option = prepare(game, state, me, { kind: 'activate', cardId: card.id, abilityId: ability.id, targetId: null });
      if (option) options.push({ ...option, fromHand: true, text: ability.text });
    }
  }
  const sources = [...state.battlefield.filter((p) => p.controllerId === me), ...player.emblems];
  for (const source of sources) {
    for (const ability of source.abilities) {
      if (ability.isManaAbility) continue;
      const option = prepare(game, state, me, { kind: 'activate', cardId: source.id, abilityId: ability.id, targetId: null }, ability.cost.mana?.X);
      if (option) options.push(option);
    }
  }
  // Abilities that work from the graveyard (Gollum, Patient Plotter).
  for (const card of player.graveyard) {
    for (const ability of card.graveyardAbilities ?? []) {
      const option = prepare(game, state, me, { kind: 'activate', cardId: card.id, abilityId: ability.id, targetId: null }, ability.cost.mana?.X);
      if (option) options.push({ ...option, fromGraveyard: true, text: ability.text });
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
    // Everything it could target, in any of its target slots.
    targets: [...new Set(variants.flatMap((v) => v.targets ?? []).filter(Boolean))],
  };
}

/**
 * The option for a cast or activation, if its cost can be paid; dry-runs the mana on a
 * clone. With {X} (`hasX`), every mana source is tapped in the dry run, so each X that
 * could be paid is offered.
 */
function prepare(game, state, me, macro, hasX = false) {
  let step = nextAction(state, me, macro);
  if (!step) return null;
  if (step.done && !hasX) return option(macro, matching(state, me, macro));
  const sim = game.clone();
  for (let i = 0; i < 30 && step && !step.done; i++) {
    sim.applyTrusted(step.action);
    step = nextAction(sim.peekState(), me, macro);
  }
  if (!step?.done) return null;
  for (let i = 0; hasX && i < 30; i++) {
    const simState = sim.peekState();
    const sources = manaSources(simState, simState.validActions.filter((a) => a.playerId === me)).filter((s) => !s.sacrifices);
    if (!sources.length) break;
    sim.applyTrusted(chooseManaAction(sources, {}));
  }
  return option(macro, matching(sim.peekState(), me, macro));
}

/**
 * The choices still open among some variants of a play (or a decision's actions), one
 * step at a time: `{ kind: 'mode' | 'x' | 'target' | 'targets', index?, values }` for the
 * first that has more than one value, or null when none is left (only cost choices, if any).
 * With `interchangeable` targets ("up to two target creatures"), they're picked as a set,
 * in any order (`kind: 'targets'`, `picked` so far, null meaning "no more"); otherwise each
 * position in turn (`kind: 'target'`, null meaning "none").
 */
export function nextChoice(variants, { interchangeable = false, picked = [] } = {}) {
  const distinct = (key) => [...new Set(variants.map(key))];
  const modes = distinct((v) => v.mode);
  if (modes.length > 1) return { kind: 'mode', values: modes };
  const xs = distinct((v) => v.x);
  if (xs.length > 1) return { kind: 'x', values: xs.sort((a, b) => a - b) };
  if (interchangeable) {
    const chosen = (v) => (v.targets ?? []).filter(Boolean);
    const values = [...new Set(variants.flatMap(chosen))].filter((id) => !picked.includes(id));
    const canStop = variants.some((v) => chosen(v).length === picked.length);
    if (values.length === 0 || (values.length === 1 && !canStop && variants.length === 1)) return null;
    return { kind: 'targets', values: canStop ? [...values, null] : values };
  }
  const length = Math.max(0, ...variants.map((v) => v.targets?.length ?? 0));
  for (let index = 0; index < length; index++) {
    const values = distinct((v) => v.targets?.[index] ?? null);
    if (values.length > 1) return { kind: 'target', index, values };
  }
  return null;
}

/** The variants that go with one value of a choice from nextChoice() (`picked`: targets picked before it). */
export function narrow(variants, choice, value, picked = []) {
  if (choice.kind === 'mode') return variants.filter((v) => v.mode === value);
  if (choice.kind === 'x') return variants.filter((v) => v.x === value);
  if (choice.kind === 'targets') {
    const chosen = (v) => (v.targets ?? []).filter(Boolean);
    return value === null ? variants.filter((v) => chosen(v).length === picked.length) : variants.filter((v) => chosen(v).includes(value));
  }
  return variants.filter((v) => (v.targets?.[choice.index] ?? null) === value);
}

/** Whether target kinds are all the same, so their order doesn't matter ("up to two target creatures"). */
export const interchangeableTargets = (kinds = []) => kinds.length > 1 && kinds.every((k) => JSON.stringify(k) === JSON.stringify(kinds[0]));

/** The variants of an option for one target (`null` for an untargeted one). */
export const variantsFor = (option, targetId = null) => option.variants
  .filter((v) => (targetId === null ? !v.targets?.length : v.targets?.[0] === targetId));

/**
 * For a spell with two targets (a fight), the second targets that go with `variants`
 * (those for one first target), or an empty list for one with a single target.
 */
export const secondTargets = (variants) => [...new Set(variants.map((v) => v.targets?.[1]).filter((t) => t !== undefined))];

/**
 * Carries out an option for real: taps mana as the dry run did, then dispatches
 * `variant` (one of the option's variants). Returns the engine's result.
 */
export function perform(game, me, option, variant) {
  if (option.kind === 'land') return game.dispatch(variant);
  const macro = {
    kind: option.kind,
    cardId: option.sourceId,
    abilityId: option.abilityId,
    targetId: null,
    // Exactly this variant: its targets (all of them), mode and X.
    targets: variant.targets ?? [],
    ...(variant.mode !== undefined ? { mode: variant.mode } : {}),
    ...(variant.x !== undefined ? { x: variant.x } : {}),
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
