import { EventEmitter } from '../engine/EventEmitter.js';
import { ACTION } from '../engine/actions.js';
import { DECISION, CHOICE } from '../engine/Game.js';
import { STEP, PHASE } from '../engine/turnStructure.js';
import {
  isCreature, isLand, isAura, isCurse, hasKeyword, cantAttack, manaValue, KEYWORD, EFFECT, AFFECTED, isHarmfulEffect,
  castsAtInstantSpeed, targetList, withX, colorsOf, COLORS_OF_MANA, flattenEffects,
} from '../cards/cards.js';
import { manaPoolTotal, canPayMana } from '../engine/mana.js';
import {
  bestBy, manaSources, neededColors, canReach, chooseManaAction, manaAvailable, castCost,
} from './manaPlanning.js';
import {
  creatureValue, curseValue, anthemValue, planAttack, chooseBlocks, combatValue, damageWeight, BLOCKING, legalBlocks,
} from './combat.js';
import {
  scoreEffects, bestScore, costScore, candidateTargets, permanentValue, wastedDamage, targetCombos, sacrificeCandidates,
} from './scoring.js';
import { planLookaheadAttack } from './attacking.js';
import { BLOCK_PLAN } from './blocking.js';
import { keepsHand, bottomCard, landShare } from './mulligan.js';
import { playAroundTricks, baitWithTricks } from './tricks.js';
import { doomedCreatures, savedByRemoving, kills } from './doomed.js';

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
 * `noise: { amount, random }` makes it play less predictably, for search rollouts
 * (see rolloutPolicies): each main-phase or instant idea's score is scaled by up to
 * ±`amount`, and with probability `amount` an attack or block declaration follows
 * another plan (another strategy's attack, another BLOCK_PLAN's blocks).
 * `mulligans: false` keeps every opening hand (see mulligan.js for when it mulligans).
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
  #noise;
  #mulligans;
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
    noise = null, mulligans = true,
  }) {
    super();
    if (blocking !== BLOCKING.GREEDY && !Object.values(BLOCK_PLAN).includes(blocking)) throw new Error(`Unknown block plan: ${blocking}`);
    if (!['basic', 'lookahead'].includes(attacking)) throw new Error(`Unknown attacking: ${attacking}`);
    this.#attacking = attacking;
    this.#attackBudgetMs = attackBudgetMs;
    this.#attackTurns = attackTurns;
    this.#attackQuick = attackQuick;
    this.#noise = noise?.amount > 0 ? noise : null;
    this.#mulligans = mulligans;
    this.#swarm = swarm;
    this.#blocking = blocking;
    this.#predictBlocking = predictBlocking;
    // Creatures after combat (see permanentSpellOptions) and attacking with tricks (see
    // baitWithTricks) are on unless turned off (`postCombat: false`, `bait: false`).
    this.#heuristics = { postCombat: true, bait: true, ...heuristics };
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
        this.#declaration.plan ??= passive ? [] : this.#planAttack(state, me, candidates);
        return moveTowards(decision.attackers, this.#declaration.plan, find);
      }
      case DECISION.DECLARE_BLOCKERS: {
        const canBlockPair = (blockerId, attackerId) => decision.blocks[blockerId] === attackerId
          || mine.some((a) => a.type === ACTION.SET_BLOCKER && a.cardId === blockerId && a.attackerId === attackerId);
        // Planned once per declaration, as for attacks.
        // Even passive blocks must meet blocking requirements (a lure).
        this.#declaration.plan ??= passive ? legalBlocks(state, me, canBlockPair, {}) : chooseBlocks(state, me, canBlockPair, {
          blocking: this.#swerves() ? this.#pick(Object.values(BLOCK_PLAN).filter((p) => p !== this.#blocking)) : this.#blocking,
          heuristics: this.#heuristics,
        });
        return chooseBlock(decision.blocks, this.#declaration.plan, find);
      }
      case DECISION.ASSIGN_COMBAT_DAMAGE:
        return bestBy(mine, (a) => assignmentScore(state, decision, a.assignment));
      case DECISION.CHOOSE_TARGETS:
        // A triggered ability's target: the best one for us, even if every option is bad
        // (declining an optional one, with no targets, scores 0).
        return bestBy(mine, (a) => scoreEffects(state, me, decision.effects, a.targets, decision.sourceId));
      case DECISION.CHOOSE_MODE:
        return bestBy(mine, (a) => scoreEffects(state, me, decision.modes[a.mode].effects, a.targets ?? [], decision.sourceId));
      case DECISION.LEGEND_RULE:
        return bestBy(mine, (a) => legendValue(state, a.cardId));
      case DECISION.MULLIGAN: {
        const { hand } = state.players.find((p) => p.id === me);
        const keeps = !this.#mulligans || keepsHand(hand, decision.mulligans, landShare(state, me));
        return find(keeps ? ACTION.KEEP_HAND : ACTION.MULLIGAN) ?? find(ACTION.KEEP_HAND);
      }
      case DECISION.PUT_ON_BOTTOM: {
        const { hand } = state.players.find((p) => p.id === me);
        const card = bottomCard(hand, decision.count, landShare(state, me));
        return find(ACTION.PUT_ON_BOTTOM, (a) => a.cardId === card.id);
      }
      case DECISION.DISCARD_TO_HAND_SIZE: {
        const keep = (card) => keepValue(state, me, card);
        return bestBy(mine, (a) => -keep(state.players.find((p) => p.id === me).hand.find((c) => c.id === a.cardId)));
      }
      case DECISION.CHOOSE:
        return bestBy(mine, (a) => choiceScore(state, me, decision, a.choice));
      case DECISION.CHOOSE_MANY: {
        // Toggle towards the wanted selection (in order), then confirm.
        const wanted = wantedSelection(state, me, decision);
        const extra = decision.selected.find((id) => !wanted.includes(id));
        const next = extra ?? wanted.find((id) => !decision.selected.includes(id));
        const toggle = next !== undefined && find(ACTION.TOGGLE_CHOICE, (a) => a.choice === next);
        return toggle || find(ACTION.CONFIRM_CHOICE) || mine[0];
      }
      case undefined:
        break;
      default:
        return mine[0];
    }
    if (passive) return find(ACTION.PASS_PRIORITY);
    return chooseLand(state, me, mine) ?? this.#act(state, mine) ?? find(ACTION.PASS_PRIORITY);
  }

  /**
   * The attack, adjusted for combat tricks when those heuristics are on (see tricks.js):
   * `tricks` (a threshold, 0.3 if true) plays around the defender's, `bait` attacks with ours.
   */
  #planAttack(state, me, candidates) {
    let ids = this.#plannedAttack(state, me, candidates);
    const { tricks, bait } = this.#heuristics;
    if (tricks) ids = playAroundTricks(state, me, ids, tricks === true ? 0.3 : tricks);
    if (bait) ids = baitWithTricks(state, me, ids, candidates);
    return ids;
  }

  /** The attack: by lookahead or planAttack, or, when the noise swerves, another strategy's. */
  #plannedAttack(state, me, candidates) {
    if (this.#attacking !== 'lookahead') {
      return planAttack(state, me, candidates, { swarm: this.#swarm, heuristics: this.#heuristics, blocking: this.#predictBlocking });
    }
    const plan = planLookaheadAttack(state, me, candidates, { budgetMs: this.#attackBudgetMs, turns: this.#attackTurns, quick: this.#attackQuick });
    if (!this.#swerves()) return plan.attackers;
    const key = (ids) => [...ids].sort().join();
    const others = Object.values(plan.strategies).filter((ids) => key(ids) !== key(plan.attackers));
    return others.length ? this.#pick(others) : plan.attackers;
  }

  /** Whether the noise makes this declaration follow another plan. */
  #swerves() { return this.#noise !== null && this.#noise.random() < this.#noise.amount; }

  #pick(list) { return list[Math.floor(this.#noise.random() * list.length)]; }

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
      const plan = knapsack(candidates, manaAvailable(player.manaPool, sources));
      order = plan.filter((c) => c.now).sort((a, b) => manaValue(b.manaCost) - manaValue(a.manaCost) || b.score - a.score);
    }
    const fodder = order.some((intent) => intent.cost?.sacrifice) ? this.#doomedFodder(state) : null;
    for (const intent of order) {
      const actions = mine.filter((a) => intent.matches(a));
      if (actions.length) {
        return bestBy(actions, (a) => costScore(state, me, intent.cost, a.costChoices ?? {}, intent.sourceId, fodder)
          + (a.manaColor ? (neededColors(intent.manaCost, player.manaPool)[a.manaColor] ?? 0) : 0));
      }
      // Not castable yet: tap mana for it if that can work, otherwise try the next idea.
      if (canPayMana(player.manaPool, intent.manaCost) || !canReach(intent.manaCost, player.manaPool, sources)) continue;
      const tap = chooseManaAction(sources, neededColors(intent.manaCost, player.manaPool));
      if (tap) return tap;
    }
    return null;
  }

  /**
   * H8 (Forge): creatures that will die anyway aren't worth removal (`doomed: false`
   * turns it off). Null when off.
   */
  #doomed(state) {
    return this.#heuristics.doomed === false || this.#heuristics.doomed === 0 ? null : doomedCreatures(state, this.#playerId);
  }

  /**
   * H8b, off by default (`cashIn: true` turns it on): ours that will die anyway are
   * cheap to sacrifice, and worth sacrificing in response or in combat. Null when off.
   */
  #doomedFodder(state, doomed = this.#doomed(state)) {
    return this.#heuristics.cashIn ? doomed : null;
  }

  /**
   * Things worth doing in this window: `{ score, manaCost, cost, now, matches(action) }`.
   * `now: false` marks instants held for later, which only reserve mana in the plan.
   */
  #candidates(state, window, player, sources) {
    const me = this.#playerId;
    const preCombat = window === WINDOW.MAIN && state.phase === PHASE.PRECOMBAT_MAIN;
    const available = manaAvailable(player.manaPool, sources);
    const result = [];
    const noise = this.#noise;
    const doomed = this.#doomed(state);
    const fodder = this.#doomedFodder(state, doomed);
    const add = (candidate) => {
      if (candidate.score > 0 && manaValue(candidate.manaCost) <= available) {
        if (noise) candidate.score *= 1 + noise.amount * (2 * noise.random() - 1);
        result.push(candidate);
      }
    };

    // Cards we may cast from exile (Moria Marauder, Shadow of the Enemy) or the top of our library (Elven Chorus).
    const elsewhereIds = new Set(state.validActions.filter((a) => a.playerId === me && a.type === ACTION.CAST_SPELL && a.zone).map((a) => a.cardId));
    const elsewhere = [...state.players.flatMap((p) => p.exile ?? []), ...(player.library ?? []).slice(0, 1)].filter((c) => elsewhereIds.has(c.id));
    for (const card of [...player.hand, ...elsewhere]) {
      for (const ability of card.handAbilities ?? []) {
        // Cycling: a land we can spare, in our main phase or at the end of the opponent's turn.
        if (window !== WINDOW.MAIN && window !== WINDOW.END) continue;
        const spare = isLand(card) && landsInPlay(state, me) >= 5;
        if (!spare) continue;
        const matches = (a) => a.type === ACTION.ACTIVATE_ABILITY && a.cardId === card.id && a.abilityId === ability.id;
        add({ score: 1, manaCost: ability.cost.mana ?? {}, cost: {}, sourceId: card.id, now: true, matches });
      }
      if (isLand(card)) continue;
      const instant = castsAtInstantSpeed(card);
      if (!instant && window !== WINDOW.MAIN) continue;
      const cost = card.additionalCost ?? {};
      const manaCost = castCost(state, me, card);
      const castMatches = (targetId) => (a) => a.type === ACTION.CAST_SPELL && a.cardId === card.id
        && (targetId === null || a.targets?.[0] === targetId);
      if (!card.spell) {
        // A permanent spell; with flash, also as a surprise blocker or at the end of the opponent's turn.
        if (window !== WINDOW.MAIN && window !== WINDOW.END && window !== WINDOW.ATTACKED) continue;
        if (window === WINDOW.ATTACKED && !isCreature(card)) continue;
        for (const { targetId, score } of permanentSpellOptions(state, me, card, preCombat, this.#heuristics)) {
          add({ score, manaCost, cost, sourceId: card.id, now: true, matches: castMatches(targetId) });
        }
        continue;
      }
      // {X}: as big as the mana available allows (107.3).
      const x = card.manaCost?.X ? Math.max(0, available - manaValue(manaCost)) : undefined;
      const xCost = x !== undefined ? withX(card.manaCost, x) : manaCost;
      const sameX = (a) => x === undefined || a.x === x;
      // A modal spell (700.2): each mode is an idea of its own; several targets: the best combination.
      const modes = card.spell.modes ? card.spell.modes.map((m, i) => [i, m]) : [[undefined, card.spell]];
      if (card.spell.modes || card.spell.targets || x !== undefined) {
        for (const [mode, holder] of modes) {
          const best = bestTargets(state, me, holder.effects, targetList(holder), card.id, preCombat, x);
          const targetId = best?.targets.filter(Boolean).at(-1) ?? null;
          if (best && best.score > 0 && windowAllows(window, holder.effects, instant, targetId, state, me)) {
            const matches = (a) => a.type === ACTION.CAST_SPELL && a.cardId === card.id && a.mode === mode && sameX(a)
              && (a.targets ?? []).join() === best.targets.join();
            add({ score: best.score, manaCost: xCost, cost, sourceId: card.id, now: true, matches });
          } else if (best && best.score > 0 && instant && window === WINDOW.MAIN) {
            add({ score: 0.6 * best.score, manaCost: xCost, cost, sourceId: card.id, now: false, matches: () => false });
          }
        }
        continue;
      }
      const { effects, target } = card.spell;
      // Burn spells are kept for kills (wastedDamage).
      const best = bestTarget(state, me, effects, target, card.id, window, preCombat, doomed, true);
      if (best && this.#savesRemoval(state, effects, best.targetId, window)) continue;
      const allowed = best && (windowAllows(window, effects, instant, best.targetId, state, me)
        || (instant && cashesInDoomed(state, me, cost, card.id, window, fodder)));
      if (allowed) {
        const score = best.score + costScore(state, me, cost, {}, card.id) + cheapestSacrifice(state, me, cost, card.id, fodder);
        add({ score, manaCost, cost, sourceId: card.id, now: true, matches: castMatches(best.targetId) });
      } else if (instant && window === WINDOW.MAIN) {
        // Hold it: worth keeping mana up for, at a discount.
        const later = bestScore(state, me, effects, target, cost, card.id, { killsOnly: true });
        if (later > 0) add({ score: 0.6 * later, manaCost, cost, sourceId: card.id, now: false, matches: () => false });
      }
    }

    // Activated abilities of our permanents and emblems (mana abilities are only for paying),
    // and of cards in our graveyard.
    const permanents = state.battlefield.filter((p) => p.controllerId === me);
    const graveyard = player.graveyard.filter((c) => c.graveyardAbilities);
    for (const source of [...permanents, ...player.emblems, ...graveyard]) {
      if (source.emblemId && source.activationsThisTurn >= source.activationsPerTurn) continue;
      for (const ability of (graveyard.includes(source) ? source.graveyardAbilities : source.abilities) ?? []) {
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
        if (ability.cost.tap && preCombat && isCreature(source) && !cantAttack(source)) continue;
        if (ability.targets || manaCost.X) {
          // Several targets (Ioreth), or {X} (Ent-Draught Basin): the best combination, for each X we could pay.
          const xs = manaCost.X ? Array.from({ length: Math.max(0, available - manaValue(manaCost)) + 1 }, (_, i) => i) : [undefined];
          for (const x of xs) {
            const best = bestTargets(state, me, ability.effects, targetList(ability), source.id, preCombat, x);
            if (!best || best.score <= 0 || !windowAllows(window, ability.effects, ability.timing !== 'sorcery', best.targets.filter(Boolean).at(-1), state, me)) continue;
            const matches = (a) => a.type === ACTION.ACTIVATE_ABILITY && a.cardId === source.id && a.abilityId === ability.id
              && (x === undefined || a.x === x) && (a.targets ?? []).join() === best.targets.join();
            const score = best.score + costScore(state, me, ability.cost, {}, source.id) + cheapestSacrifice(state, me, ability.cost, source.id, fodder);
            add({ score, manaCost: x === undefined ? manaCost : withX(manaCost, x), cost: ability.cost, sourceId: source.id, now: true, matches });
          }
          continue;
        }
        const best = bestTarget(state, me, ability.effects, ability.target, source.id, window, preCombat, doomed);
        if (!best || !(windowAllows(window, ability.effects, ability.timing !== 'sorcery', best.targetId, state, me)
          || cashesInDoomed(state, me, ability.cost, source.id, window, fodder))) continue;
        const score = best.score + costScore(state, me, ability.cost, {}, source.id)
          + cheapestSacrifice(state, me, ability.cost, source.id, fodder);
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
function windowAllows(window, given, instantSpeed, targetId, state, me) {
  const effects = flattenEffects(given);
  const counters = effects.some((e) => e.type === EFFECT.COUNTER_SPELL);
  if (window === WINDOW.RESPONSE) return counters;
  if (counters) return false;
  const harmful = effects.some(isHarmfulEffect);
  const trick = effects.some((e) => e.type === EFFECT.PUMP && (e.power ?? 0) + (e.toughness ?? 0) > 0);
  const onCreature = targetId && state.battlefield.some((p) => p.id === targetId && isCreature(p));
  // Blocking restrictions only matter if they're in place before blockers are declared.
  const restricts = effects.some((e) => e.type === EFFECT.PUMP
    && (e.keywords ?? []).some((k) => k === KEYWORD.CANT_BLOCK || k === KEYWORD.CANT_BE_BLOCKED));
  switch (window) {
    case WINDOW.MAIN:
      // Sorcery-speed things now. Instants: removal (clearing the way) and blocking
      // restrictions now, the rest later.
      return !instantSpeed || restricts || (harmful && onCreature && targetId && isTheirs(state, me, targetId));
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

const landsInPlay = (state, me) => state.battlefield.filter((p) => p.controllerId === me && isLand(p)).length;

/**
 * Which land to play: one that enters untapped, unless the mana is already enough
 * for every spell in hand, when a land that enters tapped costs nothing.
 */
function chooseLand(state, me, mine) {
  const plays = mine.filter((a) => a.type === ACTION.PLAY_LAND);
  if (plays.length < 2) return plays[0];
  const { hand } = state.players.find((p) => p.id === me);
  const card = (a) => hand.find((c) => c.id === a.cardId);
  const untapped = state.battlefield.filter((p) => p.controllerId === me && isLand(p) && !p.tapped).length;
  const costliest = Math.max(0, ...hand.filter((c) => !isLand(c)).map((c) => manaValue(castCost(state, me, c) ?? {})));
  const tappedIsFree = untapped >= costliest;
  return plays.find((a) => Boolean(card(a)?.entersTapped) === tappedIsFree) ?? plays[0];
}

/** Which of several legendary permanents with the same name to keep (704.5j). */
function legendValue(state, id) {
  const permanent = state.battlefield.find((p) => p.id === id);
  const attached = state.battlefield.filter((p) => p.attachedTo === id).length;
  return permanentValue(permanent) + 3 * attached + (permanent.tapped ? 0 : 1) + (permanent.summoningSick ? 0 : 0.5);
}

/**
 * The best combination of targets for a spell or ability with several (a fight, "up to
 * two"), or none, `{ targets, score }`, or null if there's none. `x` is X, if it has one.
 */
function bestTargets(state, me, effects, kinds, sourceId, preCombat, x) {
  let best = null;
  for (const targets of targetCombos(state, me, kinds, sourceId, 200, x)) {
    const score = scoreEffects(state, me, effects, targets, sourceId, { preCombat, x });
    if (!best || score > best.score) best = { targets, score };
  }
  return best;
}

const isTheirs = (state, me, id) => state.battlefield.some((p) => p.id === id && p.controllerId !== me)
  || (state.players.some((p) => p.id === id) && id !== me);

/**
 * The best target for these effects in this window, `{ targetId, score }` (targetId
 * null for untargeted ones), or null if there's no target. In combat, pumps and
 * removal are judged by how they change the fight. `killsOnly`: burn only on
 * targets it kills (wastedDamage).
 */
function bestTarget(state, me, effects, targetKind, sourceId, window, preCombat, doomed = null, killsOnly = false) {
  const targets = (targetKind ? candidateTargets(state, me, targetKind) : [null])
    .filter((id) => !killsOnly || !wastedDamage(state, me, effects, id ? [id] : [], sourceId));
  if (targets.length === 0) return null;
  let best = null;
  for (const targetId of targets) {
    let score = scoreEffects(state, me, effects, targetId ? [targetId] : [], sourceId, { preCombat });
    if (window === WINDOW.COMBAT) score += combatSwing(state, me, effects, targetId, sourceId);
    if (doomed?.has(targetId)) score += doomedAdjustment(state, me, effects, targetId, sourceId, doomed.get(targetId));
    if (!best || score > best.score) best = { targetId, score };
  }
  return best;
}

/**
 * For an opponent's creature that will die anyway (see doomed.js), removal on it is
 * worth only what removing it first saves (our blockers, our life), not its death.
 */
function doomedAdjustment(state, me, effects, targetId, sourceId, { reason, combat }) {
  const target = state.battlefield.find((p) => p.id === targetId);
  if (!target || target.controllerId === me) return 0;
  const removal = effects.filter((e) => kills(e, target) || (e.type === EFFECT.RETURN_TO_HAND && !e.affected));
  if (removal.length === 0) return 0;
  const counted = scoreEffects(state, me, removal, [targetId], sourceId);
  return -counted + (reason === 'combat' ? Math.max(0, savedByRemoving(combat, me, targetId)) : 0);
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
  const pumps = flattenEffects(effects).filter((e) => e.type === EFFECT.PUMP);
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
  if (isCurse(card)) {
    // A curse goes on their creature that it hurts the most.
    return state.battlefield.filter((p) => p.controllerId !== me && isCreature(p))
      .map((p) => ({ targetId: p.id, score: 1 + curseValue(p, card) }));
  }
  if (isAura(card)) {
    // A bonus goes on our own creatures, the better the creature the better.
    return state.battlefield.filter((p) => p.controllerId === me && isCreature(p))
      .map((p) => ({ targetId: p.id, score: 3 + 0.2 * creatureValue(p) }));
  }
  // H6 (Limited wisdom): creatures that don't change this combat wait for the second
  // main phase, keeping mana up through combat and the hand hidden.
  const entersWithEffect = (card.triggeredAbilities ?? []).some((t) => t.trigger === 'entersBattlefield');
  // An anthem or lord: worth what it adds to our creatures (and a lord pumps this combat's attackers).
  const anthem = anthemValue(state, me, card);
  // Only when lands alone can pay for it: mana creatures may attack (and be tapped) meanwhile.
  const untappedLands = state.battlefield.filter((p) => p.controllerId === me && isLand(p) && !p.tapped).length;
  if (heuristics.postCombat && preCombat && isCreature(card) && !hasKeyword(card, KEYWORD.HASTE) && !entersWithEffect && !anthem
    && manaValue(card.manaCost ?? {}) <= untappedLands
    && state.battlefield.some((p) => p.controllerId === me && isCreature(p) && !p.summoningSick)) {
    return [];
  }
  const isAnthem = (card.staticAbilities ?? []).some((e) => e.affected === AFFECTED.EACH_CREATURE_YOU_CONTROL);
  let score = anthem + (isCreature(card) ? permanentValue(card) + (hasKeyword(card, KEYWORD.HASTE) && preCombat ? 1 : 0) : isAnthem ? 1 : 4);
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

/** What a "sacrifice a ..." cost could take. */
const sacrificeFodder = (state, me, cost, sourceId) => sacrificeCandidates(state, me, cost.sacrifice, sourceId)
  .filter((p) => p.id !== sourceId);

/** The cost of the cheapest thing a "sacrifice a ..." cost could take (zero or negative). */
function cheapestSacrifice(state, me, cost, sourceId, doomed = null) {
  if (!cost.sacrifice) return 0;
  const fodder = sacrificeFodder(state, me, cost, sourceId);
  if (fodder.length === 0) return -Infinity;
  return Math.max(...fodder.map((p) => costScore(state, me, {}, { sacrifice: [p.id] }, sourceId, doomed)));
}

/**
 * Whether a "sacrifice a creature" cost could take one of ours that's about to die
 * anyway: then it's worth paying now, in response or in combat, rather than losing
 * the creature for nothing (Village Rites, Witch's Cauldron).
 */
const cashesInDoomed = (state, me, cost, sourceId, window, doomed) => Boolean(doomed && cost.sacrifice
  && (window === WINDOW.RESPONSE || window === WINDOW.COMBAT)
  && sacrificeFodder(state, me, cost, sourceId).some((p) => doomed.has(p.id)));

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

/** How good a choice made while something resolves would be for `me` (DECISION.CHOOSE). */
function choiceScore(state, me, decision, choice) {
  const permanent = (id) => state.battlefield.find((p) => p.id === id);
  const hand = state.players.find((p) => p.id === me).hand;
  const cardIn = (cards, id) => cards?.find((c) => c.id === id);
  const lifeOf = (id) => state.players.find((p) => p.id === id).life;
  switch (decision.kind) {
    case CHOICE.RING_BEARER: {
      // An evasive, hard-hitting creature that can attack, and not a second copy of a legend.
      const p = permanent(choice);
      const twin = state.battlefield.some((o) => o.id !== p.id && o.controllerId === me && o.name === p.name);
      const evasion = hasKeyword(p, KEYWORD.FLYING) || hasKeyword(p, KEYWORD.CANT_BE_BLOCKED) ? 3 : hasKeyword(p, KEYWORD.MENACE) ? 1 : 0;
      const current = state.players.find((q) => q.id === me).ring?.bearerId === choice ? 0.5 : 0;
      return creatureValue(p) + evasion + current + (cantAttack(p) ? -4 : 0) + (twin ? -6 : 0);
    }
    case CHOICE.ARMY:
      return permanent(choice)?.power ?? 0;
    case CHOICE.SACRIFICE: {
      const p = permanent(choice);
      return -(isCreature(p) ? (p.token ? creatureValue(p) : permanentValue(p)) : p.token ? 1 : isLand(p) ? 3 : permanentValue(p));
    }
    case CHOICE.DISCARD:
    case CHOICE.BOTTOM_FROM_HAND:
      return -keepValue(state, me, cardIn(hand, choice));
    case CHOICE.REVEALED_CARD: {
      const card = cardIn(decision.cards, choice);
      return card ? (isCreature(card) ? permanentValue(card) : 3) + manaValue(card.manaCost ?? {}) : 0;
    }
    case CHOICE.CARD_TYPE: {
      // Pippin: protection from what threatens it most: the opponent's creatures, or their removal.
      const theirCreatures = state.battlefield.filter((p) => p.controllerId !== me && isCreature(p)).length;
      return choice === 'Creature' ? 1 + theirCreatures : choice === 'Instant' ? 1.5 : choice === 'Sorcery' ? 1 : 0;
    }
    case CHOICE.CAST_FREE: {
      if (choice === 'decline') return 0;
      const card = cardIn(hand, choice);
      return card ? 1 + manaValue(card.manaCost ?? {}) : 0;
    }
    case CHOICE.CAST_FREE_VARIANT: {
      const variant = decision.variants[Number(choice)];
      const card = cardIn(hand, decision.cardId);
      const holder = card?.spell?.modes && variant.mode !== undefined && !Array.isArray(variant.mode) ? card.spell.modes[variant.mode] : card?.spell;
      return holder ? scoreEffects(state, me, holder.effects ?? [], variant.targets ?? [], decision.cardId) : 0;
    }
    case CHOICE.COUNTER:
    case CHOICE.KEYWORD: {
      const creature = permanent(decision.ids?.[0]);
      const fighting = creature && state.combat.attackers.some((a) => a.cardId === creature.id || a.blockerIds.includes(creature.id));
      const threatened = creature && state.stack.some((o) => o.controllerId !== me && (o.targets ?? []).includes(creature.id));
      const scores = {
        [KEYWORD.FIRST_STRIKE]: fighting ? 3 : 1,
        [KEYWORD.VIGILANCE]: fighting ? 0 : 2,
        [KEYWORD.INDESTRUCTIBLE]: fighting || threatened ? 3 : 1,
        [KEYWORD.LIFELINK]: fighting ? 2 : 1.5,
        // A counter lasts: deathtouch makes any blocker a trade.
        [KEYWORD.DEATHTOUCH]: decision.kind === CHOICE.COUNTER ? 2.5 : 2,
      };
      return scores[choice] ?? 0;
    }
    case CHOICE.MAY: {
      // Palantír of Orthanc, asked of us: let them draw, or lose life for what they mill (about 2 per card).
      if (decision.playerId === me && state.resolving && state.resolving.controllerId !== me) {
        const counters = state.battlefield.find((p) => p.id === decision.sourceId)?.counters?.influence ?? 1;
        const lifeLoss = 2 * counters;
        const yes = lifeOf(me) - lifeLoss <= 5 ? 1 : 3 - lifeLoss / 2;
        return choice === 'yes' ? yes : 0;
      }
      if (choice === 'no') return 0;
      // Gorbag: sacrificing the creature that hit is worth a card only if it's a small one.
      const sacrifices = (decision.effects ?? []).some((e) => e.type === EFFECT.SACRIFICE);
      const subject = permanent(state.resolving?.context.subject?.id);
      if (sacrifices) return subject && (subject.token || creatureValue(subject) < 4) ? 1 : -1;
      return 1;
    }
    case CHOICE.OPTIONAL_COST: {
      if (choice === 'decline') return 0;
      // The effect it pays for is worth about a card; a sacrifice costs what it takes, mana a little.
      const [index, ids] = String(choice).split(':');
      const cost = decision.costs[Number(index)];
      const lost = (ids ? ids.split(',') : []).map(permanent).filter(Boolean)
        .reduce((sum, p) => sum + (p.token ? (isCreature(p) ? creatureValue(p) : 1) : permanentValue(p)), 0);
      const opponentsCreatures = state.battlefield.some((p) => p.controllerId !== me && isCreature(p));
      return (opponentsCreatures || !cost.sacrifice ? 3 : 1.5) - lost - (cost.mana ? 0.5 : 0);
    }
    case CHOICE.PAY: {
      if (choice === 'decline') return 0;
      // Ward—sacrifice a legend: worth it only for a cheap legend.
      if (String(choice).includes(':')) {
        const lost = String(choice).split(':')[1].split(',').map(permanent).filter(Boolean)
          .reduce((sum, p) => sum + (isCreature(p) ? creatureValue(p) : permanentValue(p)), 0);
        return 3 - lost;
      }
      // Life to keep a creature (Morgul-Knife Wound): only with life to spare. Mana (ward): worth it.
      if (decision.cost?.life) return lifeOf(me) - decision.cost.life > 6 ? 1 : -1;
      return 1;
    }
    case CHOICE.CREATURE_TYPE: {
      const library = state.players.find((p) => p.id === me).library ?? [];
      const count = (cards) => cards.filter((c) => isCreature(c) && (c.subtypes ?? []).includes(choice)).length;
      return 3 * count(hand) + 0.1 * count(library);
    }
    case CHOICE.GRAVEYARD_CARD:
    case CHOICE.HAND_CARD: {
      if (choice === 'decline') return 0;
      const card = cardIn(state.players.find((p) => p.id === me).graveyard, choice) ?? cardIn(hand, choice);
      return card ? 1 + (isCreature(card) ? permanentValue(card) : 3) : 0;
    }
    default:
      return 0;
  }
}

/** What to select for a DECISION.CHOOSE_MANY, in order. */
function wantedSelection(state, me, decision) {
  const player = state.players.find((p) => p.id === me);
  const cards = decision.cards ?? [];
  const card = (id) => cards.find((c) => c.id === id);
  const lands = state.battlefield.filter((p) => p.controllerId === me && isLand(p)).length + player.hand.filter(isLand).length;
  switch (decision.kind) {
    case CHOICE.SCRY: {
      // Keep what we'd want to draw next: lands while short of them, spells we can cast soon.
      const wanted = (c) => (isLand(c) ? lands < 6 : manaValue(c.manaCost ?? {}) <= lands + 2);
      return decision.options.filter((id) => card(id) && wanted(card(id)))
        .sort((a, b) => keepValue(state, me, card(b)) - keepValue(state, me, card(a)));
    }
    case CHOICE.SEARCH: {
      // Lands of the colors our hand needs most, else the most valuable cards.
      const needs = new Map(COLORS_OF_MANA.map((c) => [c, 0]));
      for (const c of player.hand) for (const color of colorsOf(c)) needs.set(color, needs.get(color) + 1);
      const value = (c) => (isLand(c)
        ? 5 + Math.max(0, ...(c.abilities ?? []).flatMap((ab) => ab.effects ?? []).flatMap((e) => Object.keys(e.mana ?? {})).map((t) => needs.get(t) ?? 0))
        : keepValue(state, me, c));
      return [...decision.options].filter((id) => card(id)).sort((a, b) => value(card(b)) - value(card(a))).slice(0, decision.max);
    }
    case CHOICE.GRAVEYARD_CARDS:
      // The Bath Song: everything goes back (a bigger library, and our spells to draw again).
      return [...decision.options];
    case CHOICE.LOOK:
      // Horn of the Mark, Radagast: the best creature card.
      return [...decision.options].filter((id) => card(id)).sort((a, b) => keepValue(state, me, card(b)) - keepValue(state, me, card(a))).slice(0, decision.max);
    case CHOICE.EXILE_FROM_HAND:
      // Isildur's Fateful Strike: the cards we'd least like to keep.
      return [...decision.options].sort((a, b) => keepValue(state, me, player.hand.find((c) => c.id === a)) - keepValue(state, me, player.hand.find((c) => c.id === b)))
        .slice(0, decision.min);
    case CHOICE.EXILE_COST:
      // Mines of Moria: the graveyard cards worth least (lands first; not ones with abilities there).
      return [...decision.options].sort((a, b) => graveyardWorth(card(a)) - graveyardWorth(card(b))).slice(0, decision.min);
    case CHOICE.KEEP: {
      // Mount Doom: our best creatures.
      const mine = decision.options.map((id) => state.battlefield.find((p) => p.id === id)).filter((p) => p?.controllerId === me);
      return mine.sort((a, b) => creatureValue(b) - creatureValue(a)).slice(0, decision.max).map((p) => p.id);
    }
    case CHOICE.HAND_CARDS:
      // Last March of the Ents: every creature we can.
      return [...decision.options];
    case CHOICE.COUNTERS:
      // Goldberry: one counter is enough for the card.
      return decision.options.slice(0, 1);
    case CHOICE.SACRIFICE_ANY: {
      // Hew the Entwood: lands beyond the fifth.
      const lands = decision.options.map((id) => state.battlefield.find((p) => p.id === id)).filter(Boolean);
      return lands.slice(5).map((p) => p.id);
    }
    default:
      return decision.selected.length >= (decision.min ?? 0) ? decision.selected
        : [...decision.selected, ...decision.options.filter((id) => !decision.selected.includes(id))].slice(0, decision.min);
  }
}

/** How much a card in a graveyard is worth there (to keep it from being exiled). */
function graveyardWorth(card) {
  if (!card) return 0;
  return (card.graveyardAbilities?.length ? 10 : 0) + (isLand(card) ? 0 : 1 + manaValue(card.manaCost ?? {}) / 10);
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
