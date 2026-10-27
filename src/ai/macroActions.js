/**
 * Macro actions: the meaningful choices a player has, rather than the engine's
 * raw actions (tap this land, toggle that attacker, ...). Search AIs choose among
 * macro actions, then play them out one raw action at a time with nextAction().
 *
 * - `{ kind: 'pass' }`
 * - `{ kind: 'land', cardId }`: play a land with that card id (definition id)
 * - `{ kind: 'cast', cardId, targetId }` / `{ kind: 'activate', cardId, abilityId, targetId }`,
 *   paying mana by tapping sources as needed; a spell with several targets (a fight)
 *   has `targets` instead of `targetId`
 * - `{ kind: 'attack', attackers: [ids] }` / `{ kind: 'block', blocks: { blockerId: attackerId } }`
 * - `{ kind: 'raw', action }`: any other decision (discarding, dividing damage, targets)
 *
 * Every macro has a `key` that identifies it within one decision.
 */
import { ACTION } from '../engine/actions.js';
import { DECISION } from '../engine/Game.js';
import { PHASE } from '../engine/turnStructure.js';
import { canPayMana } from '../engine/mana.js';
import {
  isCreature, isLand, isAura, isCurse, hasKeyword, castsAtInstantSpeed, KEYWORD, EFFECT,
} from '../cards/cards.js';
import {
  planAttack, planBlocks, chooseBlocks, creatureValue, curseValue, BLOCKING,
} from './combat.js';
import { candidateTargets, scoreEffects, costScore, wastedDamage } from './scoring.js';
import { planLookaheadAttack } from './attacking.js';
import {
  bestBy, manaSources, neededColors, canReach, chooseManaAction, castCost,
} from './manaPlanning.js';

/** How many targets per spell or ability are worth considering (the best-scoring ones). */
const TARGETS_PER_SPELL = 3;

const keyed = (macro) => ({ ...macro, key: macroKey(macro) });

export function macroKey(macro) {
  switch (macro.kind) {
    case 'pass': return 'pass';
    case 'land': return `land:${macro.cardId}`;
    case 'cast': return `cast:${macro.cardId}>${macro.targets?.join('+') ?? macro.targetId ?? ''}`;
    case 'activate': return `activate:${macro.cardId}:${macro.abilityId}>${macro.targetId ?? ''}`;
    case 'attack': return `attack:${[...macro.attackers].sort().join(',')}`;
    case 'block': return `block:${Object.entries(macro.blocks).sort().map(([b, a]) => `${b}>${a}`).join(',')}`;
    default: return `raw:${JSON.stringify(macro.action)}`;
  }
}

/**
 * The heuristics whose plans are offered to the search as extra candidates
 * (`heuristicPlans`): attacks and blocks from well-known rules of thumb (see
 * planAttack, planBlocks). The simulations decide when each is right.
 */
export const HEURISTIC_PLANS = Object.freeze({
  attack: [{ attrition: true }, { beatdown: 2 }, { home: true }],
  block: [{ danger: 7 }, { reinforce: true }],
});

/**
 * The macro actions `me` can choose from now (empty if it isn't their decision).
 * `heuristicPlans`: also offer the attacks and blocks of HEURISTIC_PLANS.
 * `attacking: 'lookahead'`: also offer planLookaheadAttack's attacks (each strategy's).
 */
export function listMacros(state, me, { heuristicPlans = false, attacking = 'basic' } = {}) {
  const mine = state.validActions.filter((a) => a.playerId === me);
  if (mine.length === 0) return [];
  const decision = state.pendingDecision;
  if (decision?.type === DECISION.DECLARE_ATTACKERS) return attackMacros(state, me, mine, heuristicPlans, attacking);
  if (decision?.type === DECISION.DECLARE_BLOCKERS) return blockMacros(state, me, mine, heuristicPlans);
  if (decision) return mine.map((action) => keyed({ kind: 'raw', action }));
  return priorityMacros(state, me, mine);
}

function attackMacros(state, me, mine, heuristicPlans, attacking) {
  const decision = state.pendingDecision;
  const ids = [...new Set([...decision.attackers, ...mine.filter((a) => a.type === ACTION.TOGGLE_ATTACKER).map((a) => a.cardId)])].sort();
  const creatures = ids.map((id) => state.battlefield.find((p) => p.id === id));
  const plan = planAttack(state, me, creatures);
  const sets = [plan, [], ids];
  if (heuristicPlans) for (const heuristics of HEURISTIC_PLANS.attack) sets.push(planAttack(state, me, creatures, { heuristics }));
  if (attacking === 'lookahead') {
    const lookahead = planLookaheadAttack(state, me, creatures);
    sets.push(lookahead.attackers, ...Object.values(lookahead.strategies));
  }
  if (ids.length <= 4) {
    // Every subset.
    for (let mask = 1; mask < 2 ** ids.length; mask++) sets.push(ids.filter((_, i) => mask & (2 ** i)));
  } else {
    for (const id of ids) sets.push(plan.includes(id) ? plan.filter((x) => x !== id) : [...plan, id]);
  }
  return dedupe(sets.map((attackers) => keyed({ kind: 'attack', attackers })));
}

function blockMacros(state, me, mine, heuristicPlans) {
  const decision = state.pendingDecision;
  const canBlockPair = (blockerId, attackerId) => decision.blocks[blockerId] === attackerId
    || mine.some((a) => a.type === ACTION.SET_BLOCKER && a.cardId === blockerId && a.attackerId === attackerId);
  // The basic AI's blocks, and planBlocks' greedy ones.
  const plan = chooseBlocks(state, me, canBlockPair);
  const options = [plan, {}, chooseBlocks(state, me, canBlockPair, { blocking: BLOCKING.GREEDY })];
  if (heuristicPlans) for (const heuristics of HEURISTIC_PLANS.block) options.push(planBlocks(state, me, canBlockPair, { heuristics }));
  // The plan without each blocker in turn (menace pairs stay together).
  for (const blockerId of Object.keys(plan)) {
    const attackerId = plan[blockerId];
    options.push(Object.fromEntries(Object.entries(plan).filter(([, a]) => a !== attackerId)));
  }
  // Each attacker blocked by each single blocker that's free in the plan.
  const free = state.battlefield.filter((p) => p.controllerId === me && isCreature(p) && !p.tapped && !plan[p.id]);
  for (const { cardId: attackerId } of state.combat.attackers) {
    for (const blocker of free) {
      if (canBlockPair(blocker.id, attackerId)) options.push({ ...plan, [blocker.id]: attackerId });
    }
  }
  return dedupe(options.map((blocks) => keyed({ kind: 'block', blocks })));
}

function priorityMacros(state, me, mine) {
  const macros = [keyed({ kind: 'pass' })];
  const player = state.players.find((p) => p.id === me);
  const lands = new Set(mine.filter((a) => a.type === ACTION.PLAY_LAND)
    .map((a) => player.hand.find((c) => c.id === a.cardId)?.cardId));
  for (const cardId of lands) macros.push(keyed({ kind: 'land', cardId }));

  const sources = manaSources(state, mine);
  const affordable = (cost) => canPayMana(player.manaPool, cost) || canReach(cost ?? {}, player.manaPool, sources);
  const sorceryTiming = state.activePlayerId === me && state.stack.length === 0
    && (state.phase === PHASE.PRECOMBAT_MAIN || state.phase === PHASE.POSTCOMBAT_MAIN);
  // `killsOnly`: burn only on targets it kills (wastedDamage).
  const topTargets = (kind, effects, sourceId, killsOnly = false) => candidateTargets(state, me, kind)
    .filter((id) => !killsOnly || !wastedDamage(state, me, effects, [id], sourceId))
    .map((id) => ({ id, score: scoreEffects(state, me, effects, [id], sourceId) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGETS_PER_SPELL)
    .map((t) => t.id);

  // A "sacrifice a ..." cost needs something to sacrifice.
  const canSacrifice = (cost, sourceId) => !cost?.sacrifice || state.battlefield.some((p) => p.controllerId === me
    && p.id !== sourceId && (cost.sacrifice !== 'creature' || isCreature(p)));
  for (const card of player.hand) {
    // Cycling and other abilities that work from the hand.
    for (const ability of card.handAbilities ?? []) {
      if (affordable(ability.cost.mana) && (sorceryTiming || state.activePlayerId !== me)) {
        macros.push(keyed({ kind: 'activate', cardId: card.id, abilityId: ability.id, targetId: null }));
      }
    }
    if (isLand(card) || !(castsAtInstantSpeed(card) || sorceryTiming) || !affordable(castCost(state, me, card))) continue;
    if (!canSacrifice(card.additionalCost, card.id)) continue;
    if (card.spell?.targets) {
      // Several targets (a fight): the best few combinations.
      let combos = [[]];
      for (const kind of card.spell.targets) {
        combos = combos.flatMap((chosen) => candidateTargets(state, me, kind).filter((id) => !chosen.includes(id)).map((id) => [...chosen, id]));
      }
      combos.map((targets) => ({ targets, score: scoreEffects(state, me, card.spell.effects, targets, card.id) }))
        .sort((a, b) => b.score - a.score).slice(0, TARGETS_PER_SPELL)
        .forEach(({ targets }) => macros.push(keyed({ kind: 'cast', cardId: card.id, targetId: null, targets })));
      continue;
    }
    let targets = [null];
    if (isCurse(card)) {
      targets = state.battlefield.filter((p) => p.controllerId !== me && isCreature(p))
        .sort((a, b) => curseValue(b, card) - curseValue(a, card)).slice(0, 2).map((p) => p.id);
    } else if (isAura(card)) {
      targets = state.battlefield.filter((p) => p.controllerId === me && isCreature(p))
        .sort((a, b) => creatureValue(b) - creatureValue(a)).slice(0, 2).map((p) => p.id);
    } else if (card.spell?.target) {
      // Burn spells are kept for kills.
      targets = topTargets(card.spell.target, card.spell.effects, card.id, true);
    }
    for (const targetId of targets) macros.push(keyed({ kind: 'cast', cardId: card.id, targetId }));
  }

  const permanents = state.battlefield.filter((p) => p.controllerId === me);
  for (const source of [...permanents, ...player.emblems]) {
    if (source.emblemId && source.activationsThisTurn >= source.activationsPerTurn) continue;
    for (const ability of source.abilities ?? []) {
      if (ability.isManaAbility || (ability.timing === 'sorcery' && !sorceryTiming)) continue;
      if (ability.cost.tap && (source.tapped || (isCreature(source) && source.summoningSick && !hasKeyword(source, KEYWORD.HASTE)))) continue;
      if (!affordable(ability.cost.mana) || !canSacrifice(ability.cost, null)) continue;
      let targets = [null];
      if (ability.effects.some((e) => e.type === EFFECT.ATTACH)) {
        targets = permanents.filter((p) => isCreature(p) && p.id !== source.attachedTo)
          .sort((a, b) => creatureValue(b) - creatureValue(a)).slice(0, 2).map((p) => p.id);
      } else if (ability.target) {
        targets = topTargets(ability.target, ability.effects, source.id);
      }
      for (const targetId of targets) {
        macros.push(keyed({ kind: 'activate', cardId: source.id, abilityId: ability.id, targetId }));
      }
    }
  }
  return macros;
}

function dedupe(macros) {
  const seen = new Set();
  return macros.filter((m) => !seen.has(m.key) && seen.add(m.key));
}

/**
 * The next raw action that carries out `macro` for `me`: `{ action, done }`, where
 * `done` means the macro is complete once this action is taken. Returns null when
 * the macro can't be carried out (e.g. its target is gone or the mana isn't there).
 */
export function nextAction(state, me, macro) {
  const mine = state.validActions.filter((a) => a.playerId === me);
  const find = (predicate) => mine.find(predicate);
  switch (macro.kind) {
    case 'pass': {
      const action = find((a) => a.type === ACTION.PASS_PRIORITY);
      return action ? { action, done: true } : null;
    }
    case 'raw': {
      const action = find((a) => JSON.stringify(a) === JSON.stringify(macro.action));
      return action ? { action, done: true } : null;
    }
    case 'land': {
      const player = state.players.find((p) => p.id === me);
      const action = find((a) => a.type === ACTION.PLAY_LAND && player.hand.find((c) => c.id === a.cardId)?.cardId === macro.cardId);
      return action ? { action, done: true } : null;
    }
    case 'cast':
    case 'activate':
      return payAndAct(state, me, mine, macro);
    case 'attack': {
      const current = state.pendingDecision?.attackers;
      if (!current) return null;
      const next = [...current, ...macro.attackers].find((id) => current.includes(id) !== macro.attackers.includes(id));
      if (next) {
        const action = find((a) => a.type === ACTION.TOGGLE_ATTACKER && a.cardId === next);
        return action ? { action, done: false } : null;
      }
      const confirm = find((a) => a.type === ACTION.CONFIRM_ATTACKERS);
      return confirm ? { action: confirm, done: true } : null;
    }
    case 'block': {
      const blocks = state.pendingDecision?.blocks;
      if (!blocks) return null;
      for (const blockerId of new Set([...Object.keys(blocks), ...Object.keys(macro.blocks)])) {
        const wanted = macro.blocks[blockerId] ?? null;
        if ((blocks[blockerId] ?? null) !== wanted) {
          const action = find((a) => a.type === ACTION.SET_BLOCKER && a.cardId === blockerId && a.attackerId === wanted);
          return action ? { action, done: false } : null;
        }
      }
      const confirm = find((a) => a.type === ACTION.CONFIRM_BLOCKERS);
      return confirm ? { action: confirm, done: true } : null;
    }
    default:
      return null;
  }
}

/** Casting or activating: the action itself once it's affordable, otherwise a mana ability for it. */
function payAndAct(state, me, mine, macro) {
  const type = macro.kind === 'cast' ? ACTION.CAST_SPELL : ACTION.ACTIVATE_ABILITY;
  const matches = mine.filter((a) => a.type === type && a.cardId === macro.cardId
    && (macro.kind === 'cast' || a.abilityId === macro.abilityId)
    && (macro.targets ? a.targets?.join() === macro.targets.join() : macro.targetId === null || a.targets?.[0] === macro.targetId));
  const player = state.players.find((p) => p.id === me);
  const { manaCost, cost } = costsOf(state, me, macro);
  if (matches.length) {
    // The cheapest way to pay the cost's choices; for "any color", the color we need.
    const action = bestBy(matches, (a) => costScore(state, me, cost, a.costChoices ?? {}, macro.cardId)
      + (a.manaColor ? (neededColors(manaCost, player.manaPool)[a.manaColor] ?? 0) : 0));
    return { action, done: true };
  }
  if (manaCost === undefined) return null;
  const sources = manaSources(state, mine);
  if (canPayMana(player.manaPool, manaCost) || !canReach(manaCost, player.manaPool, sources)) return null;
  return { action: chooseManaAction(sources, neededColors(manaCost, player.manaPool)), done: false };
}

function costsOf(state, me, macro) {
  if (macro.kind === 'cast') {
    const card = state.players.find((p) => p.id === me).hand.find((c) => c.id === macro.cardId);
    return { manaCost: card ? castCost(state, me, card) ?? undefined : undefined, cost: card?.additionalCost ?? {} };
  }
  const player = state.players.find((p) => p.id === me);
  const inHand = player.hand.find((c) => c.id === macro.cardId);
  const source = state.battlefield.find((p) => p.id === macro.cardId) ?? player.emblems.find((e) => e.id === macro.cardId) ?? inHand;
  const ability = (source === inHand ? source?.handAbilities : source?.abilities)?.find((a) => a.id === macro.abilityId);
  return ability ? { manaCost: ability.cost.mana ?? {}, cost: ability.cost } : { manaCost: undefined, cost: {} };
}

/**
 * Plays a macro out in a (simulated) game with trusted actions. Returns true if it
 * was carried out completely.
 */
export function applyMacro(game, me, macro, maxSteps = 60) {
  for (let i = 0; i < maxSteps; i++) {
    const step = nextAction(game.peekState(), me, macro);
    if (!step) return false;
    game.applyTrusted(step.action);
    if (step.done) return true;
  }
  return false;
}
