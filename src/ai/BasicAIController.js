import { EventEmitter } from '../engine/EventEmitter.js';
import { ACTION } from '../engine/actions.js';
import { DECISION } from '../engine/Game.js';
import { STEP, PHASE } from '../engine/turnStructure.js';
import {
  isCreature, isLand, isInstant, isAura, hasKeyword, manaValue, KEYWORD, EFFECT, isHarmfulEffect,
} from '../cards/cards.js';
import { manaPoolTotal, canPayMana } from '../engine/mana.js';
import {
  bestBy, manaSources, neededColors, canReach, chooseManaAction,
} from './manaPlanning.js';
import {
  creatureValue, planAttack, chooseBlocks, combatValue, damageWeight, BLOCKING,
} from './combat.js';
import {
  scoreEffects, bestScore, costScore, candidateTargets, permanentValue,
} from './scoring.js';
import { planLookaheadAttack } from './attacking.js';
import { BLOCK_PLAN } from './blocking.js';

export const AI_STRATEGY = Object.freeze({
  /** Plays its cards and fights sensibly; see BasicAIController. */
  BASIC: 'basic',
  /** Never acts on its own: passes priority and makes empty declarations. */
  PASSIVE: 'passive',
});

/** Moments when the AI considers acting (anything else it passes). */
const WINDOW = Object.freeze({
  /** Its own main phase with an empty stack: lands, creatures, sorceries, abilities. */
  MAIN: 'main',
  /** After blockers are declared, in anyone's combat: tricks and removal on combatants. */
  COMBAT: 'combat',
  /** The opponent has attacked: removal on attackers. */
  ATTACKED: 'attacked',
  /** The opponent's spell is on top of the stack: counterspells. */
  RESPONSE: 'response',
  /** The opponent's end step: instants held up for this. */
  END: 'end',
});

/**
 * A computer player that plays a fair game of Magic without looking ahead. It's
 * also the fast policy the search AI uses to play out its simulations.
 *
 * - **Mana:** in its main phase it picks the best set of spells and abilities it
 *   can afford this turn (a small knapsack over its hand), keeping mana up for
 *   instants it holds when they're worth more, and taps lands before Treasures.
 * - **Combat:** it attacks with creatures the opponent can't block profitably,
 *   with everything when that's lethal through the best blocks, and keeps enough
 *   blockers home to survive the crack-back. It blocks to kill attackers or trade
 *   up, double-blocks big threats, and chump-blocks only to survive.
 * - **Instants:** combat tricks when they win a fight, removal on attackers,
 *   counterspells on spells worth countering, and everything else at the end of
 *   the opponent's turn.
 * - **Targets:** removal at the biggest threat; burn at the face when it's lethal.
 *
 * It listens to the game's `state` events and, when it has something to do,
 * emits an `action` event that the game listens to. It only ever sends actions
 * from `validActions`, and it doesn't look at the opponent's hand or any library.
 * Without a game it's a plain policy: call chooseAction(state) yourself.
 *
 * `delayMs: null` acts synchronously (the game queues the action); any number
 * schedules the action with setTimeout so a viewer can follow along.
 * `swarm: false` attacks the way the previous version did, without swarming (see
 * planAttack), as a baseline for the arena (`basic-noswarm`).
 * `blocking` is how it blocks (see chooseBlocks): blockingPlans' `value` plan by
 * default, BLOCKING.GREEDY for planBlocks, or another plan (BLOCK_PLAN).
 * `predictBlocking` is how it expects the defender to block when it plans attacks.
 * Both default to BLOCKING.VALUE.
 * `attacking` is how it attacks: 'lookahead' (the default) by planLookaheadAttack,
 * thinking for up to `attackBudgetMs` per attack if it's given (more time, deeper
 * looks), or `attackTurns` of its turns ahead (default 3); 'basic' by planAttack.
 */
export class BasicAIController extends EventEmitter {
  #game;
  #playerId;
  #delayMs;
  #strategy;
  #swarm;
  #heuristics;
  #blocking;
  #predictBlocking;
  #attacking;
  #attackBudgetMs;
  #attackTurns;
  #attackQuick;
  #timer = null;
  #unsubscribers;
  /**
   * The current attack or block declaration: its plan, made at its first step, and
   * the changes made so far, to stop any back-and-forth.
   */
  #declaration = { key: null, steps: 0, plan: null };

  constructor({
    game, playerId, delayMs = 0, strategy = AI_STRATEGY.BASIC, swarm = true, heuristics = {},
    blocking = BLOCKING.VALUE, predictBlocking = BLOCKING.VALUE, attacking = 'lookahead', attackBudgetMs = null, attackTurns = 3, attackQuick = true,
  }) {
    super();
    if (blocking !== BLOCKING.GREEDY && !Object.values(BLOCK_PLAN).includes(blocking)) throw new Error(`Unknown block plan: ${blocking}`);
    if (!['basic', 'lookahead'].includes(attacking)) throw new Error(`Unknown attacking: ${attacking}`);
    this.#attacking = attacking;
    this.#attackBudgetMs = attackBudgetMs;
    this.#attackTurns = attackTurns;
    this.#attackQuick = attackQuick;
    this.#swarm = swarm;
    this.#blocking = blocking;
    this.#predictBlocking = predictBlocking;
    // Creatures after combat (see permanentSpellOptions) is on unless turned off (`postCombat: false`).
    this.#heuristics = { postCombat: true, ...heuristics };
    this.#game = game;
    this.#playerId = playerId;
    this.#delayMs = delayMs;
    this.#strategy = strategy;
    this.#unsubscribers = game ? [
      game.on('state', (state) => this.#onState(state)),
      game.listenTo(this),
    ] : [];
  }

  get playerId() { return this.#playerId; }

  set delayMs(value) { this.#delayMs = value; }

  /** Stop listening to the game and cancel any pending action. */
  detach() {
    clearTimeout(this.#timer);
    this.#unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  /** Act on the game's current state, e.g. right after taking control mid-game. */
  actNow() {
    this.#onState(this.#game.getState());
  }

  chooseAction(state) {
    const me = this.#playerId;
    const mine = state.validActions.filter((a) => a.playerId === me);
    if (mine.length === 0) return null;
    const find = (type, predicate = () => true) => mine.find((a) => a.type === type && predicate(a));
    const passive = this.#strategy === AI_STRATEGY.PASSIVE;

    const decision = state.pendingDecision;
    if (decision?.type === DECISION.DECLARE_ATTACKERS || decision?.type === DECISION.DECLARE_BLOCKERS) {
      const key = `${state.turn}:${state.segmentIndex}:${decision.type}`;
      if (this.#declaration.key !== key) this.#declaration = { key, steps: 0, plan: null };
      // Plans are stable, so this never triggers in practice; it guarantees termination anyway.
      if (++this.#declaration.steps > 60) return find(ACTION.CONFIRM_ATTACKERS) ?? find(ACTION.CONFIRM_BLOCKERS) ?? mine[0];
    }
    switch (decision?.type) {
      case DECISION.DECLARE_ATTACKERS: {
        const candidates = [...new Set([...decision.attackers, ...mine.map((a) => a.cardId).filter(Boolean)])]
          .map((id) => state.battlefield.find((p) => p.id === id));
        // Planned once per declaration: it takes an action per attacker to carry out.
        this.#declaration.plan ??= passive ? []
          : this.#attacking === 'lookahead' ? planLookaheadAttack(state, me, candidates, { budgetMs: this.#attackBudgetMs, turns: this.#attackTurns, quick: this.#attackQuick }).attackers
            : planAttack(state, me, candidates, { swarm: this.#swarm, heuristics: this.#heuristics, blocking: this.#predictBlocking });
        return moveTowards(decision.attackers, this.#declaration.plan, find);
      }
      case DECISION.DECLARE_BLOCKERS: {
        const canBlockPair = (blockerId, attackerId) => decision.blocks[blockerId] === attackerId
          || mine.some((a) => a.type === ACTION.SET_BLOCKER && a.cardId === blockerId && a.attackerId === attackerId);
        // Planned once per declaration, as for attacks.
        this.#declaration.plan ??= passive ? {} : chooseBlocks(state, me, canBlockPair, { blocking: this.#blocking, heuristics: this.#heuristics });
        return chooseBlock(decision.blocks, this.#declaration.plan, find);
      }
      case DECISION.ASSIGN_COMBAT_DAMAGE:
        return bestBy(mine, (a) => assignmentScore(state, decision, a.assignment));
      case DECISION.CHOOSE_TARGETS:
        // A triggered ability's target: the best one for us, even if every option is bad.
        return bestBy(mine, (a) => scoreEffects(state, me, decision.effects, a.targets, decision.sourceId));
      case DECISION.DISCARD_TO_HAND_SIZE: {
        const keep = (card) => keepValue(state, me, card);
        return bestBy(mine, (a) => -keep(state.players.find((p) => p.id === me).hand.find((c) => c.id === a.cardId)));
      }
      case undefined:
        break;
      default:
        return mine[0];
    }
    if (passive) return find(ACTION.PASS_PRIORITY);
    return find(ACTION.PLAY_LAND) ?? this.#act(state, mine) ?? find(ACTION.PASS_PRIORITY);
  }

  /** What to do with priority: cast or activate the best thing for this moment, tapping mana first if needed. */
  #act(state, mine) {
    const window = windowOf(state, this.#playerId);
    if (!window) return null;
    const me = this.#playerId;
    const player = state.players.find((p) => p.id === me);
    const sources = manaSources(state, mine);
    const candidates = this.#candidates(state, window, player, sources);
    if (candidates.length === 0) return null;

    // In the main phase, plan the turn: the most valuable set we can afford, with
    // mana kept up for instants we'd rather cast later.
    let order = candidates.filter((c) => c.now).sort((a, b) => b.score - a.score);
    if (window === WINDOW.MAIN) {
      const plan = knapsack(candidates, manaPoolTotal(player.manaPool) + sources.length);
      order = plan.filter((c) => c.now).sort((a, b) => manaValue(b.manaCost) - manaValue(a.manaCost) || b.score - a.score);
    }
    for (const intent of order) {
      const actions = mine.filter((a) => intent.matches(a));
      if (actions.length) {
        return bestBy(actions, (a) => costScore(state, me, intent.cost, a.costChoices ?? {}, intent.sourceId)
          + (a.manaColor ? (neededColors(intent.manaCost, player.manaPool)[a.manaColor] ?? 0) : 0));
      }
      // Not castable yet: tap mana for it if that can work, otherwise try the next idea.
      if (canPayMana(player.manaPool, intent.manaCost) || !canReach(intent.manaCost, player.manaPool, sources)) continue;
      return chooseManaAction(sources, neededColors(intent.manaCost, player.manaPool));
    }
    return null;
  }

  /**
   * Things worth doing in this window: `{ score, manaCost, cost, now, matches(action) }`.
   * `now: false` marks instants held for later, which only reserve mana in the plan.
   */
  #candidates(state, window, player, sources) {
    const me = this.#playerId;
    const preCombat = window === WINDOW.MAIN && state.phase === PHASE.PRECOMBAT_MAIN;
    const available = manaPoolTotal(player.manaPool) + sources.length;
    const result = [];
    const add = (candidate) => {
      if (candidate.score > 0 && manaValue(candidate.manaCost) <= available) result.push(candidate);
    };

    for (const card of player.hand) {
      if (isLand(card)) continue;
      const instant = isInstant(card);
      if (!instant && window !== WINDOW.MAIN) continue;
      const cost = card.additionalCost ?? {};
      const castMatches = (targetId) => (a) => a.type === ACTION.CAST_SPELL && a.cardId === card.id
        && (targetId === null || a.targets?.[0] === targetId);
      if (!card.spell) {
        // A permanent spell.
        for (const { targetId, score } of permanentSpellOptions(state, me, card, preCombat, this.#heuristics)) {
          add({ score, manaCost: card.manaCost, cost, sourceId: card.id, now: true, matches: castMatches(targetId) });
        }
        continue;
      }
      const { effects, target } = card.spell;
      const best = bestTarget(state, me, effects, target, card.id, window, preCombat);
      if (best && this.#savesRemoval(state, effects, best.targetId, window)) continue;
      if (best && windowAllows(window, effects, instant, best.targetId, state, me)) {
        const score = best.score + costScore(state, me, cost, {}, card.id) + cheapestSacrifice(state, me, cost, card.id);
        add({ score, manaCost: card.manaCost, cost, sourceId: card.id, now: true, matches: castMatches(best.targetId) });
      } else if (instant && window === WINDOW.MAIN) {
        // Hold it: worth keeping mana up for, at a discount.
        const later = bestScore(state, me, effects, target, cost, card.id);
        if (later > 0) add({ score: 0.6 * later, manaCost: card.manaCost, cost, sourceId: card.id, now: false, matches: () => false });
      }
    }

    // Activated abilities of our permanents and emblems (mana abilities are only for paying).
    const permanents = state.battlefield.filter((p) => p.controllerId === me);
    for (const source of [...permanents, ...player.emblems]) {
      if (source.emblemId && source.activationsThisTurn >= source.activationsPerTurn) continue;
      for (const ability of source.abilities ?? []) {
        if (ability.isManaAbility) continue;
        if (ability.timing === 'sorcery' && window !== WINDOW.MAIN) continue;
        if (ability.cost.tap && (source.tapped || (isCreature(source) && source.summoningSick && !hasKeyword(source, KEYWORD.HASTE)))) continue;
        const abilityMatches = (targetId) => (a) => a.type === ACTION.ACTIVATE_ABILITY && a.cardId === source.id
          && a.abilityId === ability.id && (targetId === null || a.targets?.[0] === targetId);
        const manaCost = ability.cost.mana ?? {};
        if (ability.effects.some((e) => e.type === EFFECT.ATTACH)) {
          if (window !== WINDOW.MAIN) continue;
          for (const { targetId, score } of equipOptions(state, me, source, preCombat)) {
            add({ score, manaCost, cost: ability.cost, sourceId: source.id, now: true, matches: abilityMatches(targetId) });
          }
          continue;
        }
        // A creature that could attack shouldn't tap for an ability before combat.
        if (ability.cost.tap && preCombat && isCreature(source) && !hasKeyword(source, KEYWORD.DEFENDER)) continue;
        const best = bestTarget(state, me, ability.effects, ability.target, source.id, window, preCombat);
        if (!best || !windowAllows(window, ability.effects, ability.timing !== 'sorcery', best.targetId, state, me)) continue;
        const score = best.score + costScore(state, me, ability.cost, {}, source.id)
          + cheapestSacrifice(state, me, ability.cost, source.id);
        add({ score, manaCost, cost: ability.cost, sourceId: source.id, now: true, matches: abilityMatches(best.targetId) });
      }
    }
    return result;
  }

  /**
   * H7 ("save removal for a real threat"): in the main phase, removal isn't spent
   * on a creature worth less than `saveRemoval` (creatureValue; true means 6, about
   * a 2/2) unless we're under pressure.
   */
  #savesRemoval(state, effects, targetId, window) {
    const threshold = this.#heuristics.saveRemoval === true ? 6 : this.#heuristics.saveRemoval;
    if (!threshold || window !== WINDOW.MAIN || !effects.some(isHarmfulEffect)) return false;
    const target = state.battlefield.find((p) => p.id === targetId);
    if (!target || !isCreature(target) || target.controllerId === this.#playerId) return false;
    const me = state.players.find((p) => p.id === this.#playerId);
    return me.life > 8 && creatureValue(target) < threshold;
  }

  #onState(state) {
    clearTimeout(this.#timer);
    const action = this.chooseAction(state);
    if (!action) return;

    if (this.#delayMs === null) {
      this.emit('action', action);
      return;
    }
    this.#timer = setTimeout(() => {
      // Only act if nothing has changed since this state was emitted.
      if (this.#game.getState().version === state.version) this.emit('action', action);
    }, this.#delayMs);
  }
}

// -----------------------------------------------------------------------------
// Helpers

/** Which acting window this is for `me`, or null when it's a moment to pass. */
export function windowOf(state, me) {
  const myTurn = state.activePlayerId === me;
  const top = state.stack[state.stack.length - 1];
  if (top) return top.kind === 'spell' && top.controllerId !== me ? WINDOW.RESPONSE : null;
  if (myTurn && (state.phase === PHASE.PRECOMBAT_MAIN || state.phase === PHASE.POSTCOMBAT_MAIN)) return WINDOW.MAIN;
  if (state.step === STEP.DECLARE_BLOCKERS) return WINDOW.COMBAT;
  if (!myTurn && state.step === STEP.DECLARE_ATTACKERS) return WINDOW.ATTACKED;
  if (!myTurn && state.step === STEP.END) return WINDOW.END;
  return null;
}

/** Whether these effects are worth using in this window (rather than waiting for a better one). */
function windowAllows(window, effects, instantSpeed, targetId, state, me) {
  const counters = effects.some((e) => e.type === EFFECT.COUNTER_SPELL);
  if (window === WINDOW.RESPONSE) return counters;
  if (counters) return false;
  const harmful = effects.some(isHarmfulEffect);
  const trick = effects.some((e) => e.type === EFFECT.PUMP && (e.power ?? 0) + (e.toughness ?? 0) > 0);
  const onCreature = targetId && state.battlefield.some((p) => p.id === targetId && isCreature(p));
  switch (window) {
    case WINDOW.MAIN:
      // Sorcery-speed things now. Instants: removal (clearing the way) now, the rest later.
      return !instantSpeed || (harmful && onCreature && targetId && isTheirs(state, me, targetId));
    case WINDOW.COMBAT:
      return trick || (harmful && onCreature);
    case WINDOW.ATTACKED:
      return harmful && onCreature && state.combat.attackers.some((a) => a.cardId === targetId);
    case WINDOW.END:
      return !trick;
    default:
      return false;
  }
}

const isTheirs = (state, me, id) => state.battlefield.some((p) => p.id === id && p.controllerId !== me)
  || (state.players.some((p) => p.id === id) && id !== me);

/**
 * The best target for these effects in this window, `{ targetId, score }` (targetId
 * null for untargeted ones), or null if there's no target. In combat, pumps and
 * removal are judged by how they change the fight.
 */
function bestTarget(state, me, effects, targetKind, sourceId, window, preCombat) {
  const targets = targetKind ? candidateTargets(state, me, targetKind) : [null];
  if (targets.length === 0) return null;
  let best = null;
  for (const targetId of targets) {
    let score = scoreEffects(state, me, effects, targetId ? [targetId] : [], sourceId, { preCombat });
    if (window === WINDOW.COMBAT) score += combatSwing(state, me, effects, targetId, sourceId);
    if (!best || score > best.score) best = { targetId, score };
  }
  return best;
}

/**
 * How much these effects change the current combat in our favour (pumps and
 * removal on creatures in it), beyond their usual score.
 */
function combatSwing(state, me, effects, targetId, sourceId) {
  if (state.combat.attackers.length === 0) return 0;
  const attacking = state.activePlayerId === me;
  const defender = state.players.find((p) => p.id !== state.activePlayerId);
  const pairs = (modify) => state.combat.attackers.map(({ cardId, blockerIds, blocked }) => ({
    attacker: modify(state.battlefield.find((p) => p.id === cardId)),
    blockers: blockerIds.map((id) => modify(state.battlefield.find((p) => p.id === id))).filter(Boolean),
    blocked,
  })).filter((pair) => pair.attacker);
  const weight = { damageWeight: damageWeight(defender.life) };
  const before = combatValue(pairs((c) => c), weight);
  const affected = new Set(targetId ? [targetId] : []);
  const pumps = effects.filter((e) => e.type === EFFECT.PUMP);
  for (const e of pumps) {
    if (e.affected === 'eachCreatureYouControl') state.battlefield.filter((p) => p.controllerId === me && isCreature(p)).forEach((p) => affected.add(p.id));
    if (e.affected === 'source') affected.add(sourceId);
  }
  const after = combatValue(pairs((c) => {
    if (!c || !affected.has(c.id)) return c;
    let modified = c;
    for (const e of pumps) {
      modified = {
        ...modified,
        power: modified.power + (e.power ?? 0),
        toughness: modified.toughness + (e.toughness ?? 0),
        keywords: [...new Set([...modified.keywords, ...(e.keywords ?? [])])],
      };
    }
    return modified;
  }), weight);
  return (attacking ? 1 : -1) * (after - before);
}

/** Casting a permanent: `[{ targetId, score }]`, one per Aura target, or one for anything else. */
function permanentSpellOptions(state, me, card, preCombat, heuristics = {}) {
  if (isAura(card)) {
    // The Auras here are bonuses: on our own creatures, the better the creature the better.
    return state.battlefield.filter((p) => p.controllerId === me && isCreature(p))
      .map((p) => ({ targetId: p.id, score: 3 + 0.2 * creatureValue(p) }));
  }
  // H6 (Limited wisdom): creatures that don't change this combat wait for the second
  // main phase, keeping mana up through combat and the hand hidden.
  const entersWithEffect = (card.triggeredAbilities ?? []).some((t) => t.trigger === 'entersBattlefield');
  // Only when lands alone can pay for it: mana creatures may attack (and be tapped) meanwhile.
  const untappedLands = state.battlefield.filter((p) => p.controllerId === me && isLand(p) && !p.tapped).length;
  if (heuristics.postCombat && preCombat && isCreature(card) && !hasKeyword(card, KEYWORD.HASTE) && !entersWithEffect
    && manaValue(card.manaCost ?? {}) <= untappedLands
    && state.battlefield.some((p) => p.controllerId === me && isCreature(p) && !p.summoningSick)) {
    return [];
  }
  let score = isCreature(card) ? permanentValue(card) + (hasKeyword(card, KEYWORD.HASTE) && preCombat ? 1 : 0) : 4;
  for (const trigger of card.triggeredAbilities ?? []) {
    if (trigger.trigger === 'entersBattlefield') {
      score += Math.max(0, bestScore(state, me, trigger.effects, trigger.target, {}, card.id));
    }
  }
  return [{ targetId: null, score }];
}

/**
 * Equip: loose Equipment onto our best creature; attached Equipment moves only to
 * a clearly better creature (moving it every turn would just waste mana).
 */
function equipOptions(state, me, equipment, preCombat) {
  const host = state.battlefield.find((p) => p.id === equipment.attachedTo);
  // The host's value without the Equipment's bonus isn't known, so compare toughness-free power plus evasion roughly.
  const hostValue = host ? creatureValue(host) : 0;
  return state.battlefield
    .filter((p) => p.controllerId === me && isCreature(p) && p.id !== equipment.attachedTo)
    .map((p) => ({
      targetId: p.id,
      score: host
        ? (creatureValue(p) > hostValue + 4 ? 0.5 : 0)
        : 2.5 + 0.1 * creatureValue(p) + (preCombat && !p.summoningSick ? 0.5 : 0),
    }));
}

/** The cost of the cheapest thing a "sacrifice a ..." cost could take (zero or negative). */
function cheapestSacrifice(state, me, cost, sourceId) {
  if (!cost.sacrifice) return 0;
  const fodder = state.battlefield.filter((p) => p.controllerId === me && p.id !== sourceId
    && (cost.sacrifice !== 'creature' || isCreature(p)));
  if (fodder.length === 0) return -Infinity;
  return Math.max(...fodder.map((p) => costScore(state, me, {}, { sacrifice: [p.id] }, sourceId)));
}

/** The most valuable set of candidates whose mana costs fit in `capacity` (each card at most once). */
function knapsack(candidates, capacity) {
  // Keep only each card's best option, then search subsets (hands are small).
  const bySource = new Map();
  for (const c of candidates) {
    if (!bySource.has(c.sourceId) || bySource.get(c.sourceId).score < c.score) bySource.set(c.sourceId, c);
  }
  const items = [...bySource.values()].sort((a, b) => b.score - a.score).slice(0, 12);
  let best = [];
  let bestValue = 0;
  const visit = (i, chosen, used, value) => {
    if (value > bestValue) [best, bestValue] = [[...chosen], value];
    for (let j = i; j < items.length; j++) {
      const cost = manaValue(items[j].manaCost);
      if (used + cost > capacity) continue;
      chosen.push(items[j]);
      // Spending mana is good in itself, a little.
      visit(j + 1, chosen, used + cost, value + items[j].score + 0.1 * cost);
      chosen.pop();
    }
  };
  visit(0, [], 0, 0);
  return best;
}

/** How much a card in hand is worth keeping (for discarding down to hand size). */
function keepValue(state, me, card) {
  const lands = state.battlefield.filter((p) => p.controllerId === me && isLand(p)).length;
  if (isLand(card)) return lands < 6 ? 6 : 1;
  const castable = manaValue(card.manaCost) <= lands + 1 ? 0 : -2;
  if (isCreature(card)) return permanentValue(card) + castable;
  return 5 + castable;
}

/** For dividing combat damage: blockers killed (by value), then damage to the player. */
function assignmentScore(state, decision, assignment) {
  const attacker = state.battlefield.find((p) => p.id === decision.attackerId);
  let score = 0;
  for (const [id, amount] of Object.entries(assignment)) {
    const blocker = state.battlefield.find((p) => p.id === id);
    if (!blocker) {
      score += amount * 0.5;
      continue;
    }
    const lethal = hasKeyword(attacker, KEYWORD.DEATHTOUCH) ? 1 : blocker.toughness - blocker.damage;
    if (amount >= lethal && amount > 0) score += creatureValue(blocker);
  }
  return score;
}

/** Toggle the first creature that differs from the plan, or confirm once they match. */
function moveTowards(current, wanted, find) {
  const differs = (id) => current.includes(id) !== wanted.includes(id);
  const next = [...current, ...wanted].find(differs);
  return (next && find(ACTION.TOGGLE_ATTACKER, (a) => a.cardId === next)) || find(ACTION.CONFIRM_ATTACKERS);
}

/** Move the declared blocks towards the plan one blocker at a time, then confirm. */
function chooseBlock(blocks, plan, find) {
  for (const blockerId of new Set([...Object.keys(blocks), ...Object.keys(plan)])) {
    const wanted = plan[blockerId] ?? null;
    if ((blocks[blockerId] ?? null) !== wanted) {
      const action = find(ACTION.SET_BLOCKER, (a) => a.cardId === blockerId && a.attackerId === wanted);
      if (action) return action;
    }
  }
  return find(ACTION.CONFIRM_BLOCKERS);
}
