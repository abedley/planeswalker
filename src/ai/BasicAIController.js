import { EventEmitter } from '../engine/EventEmitter.js';
import { ACTION } from '../engine/actions.js';
import { DECISION } from '../engine/Game.js';
import { isCreature, hasKeyword, KEYWORD } from '../cards/cards.js';
import { manaPoolTotal } from '../engine/mana.js';

export const AI_STRATEGY = Object.freeze({
  /** Plays lands, casts creatures, attacks when it has more creatures, blocks to trade. */
  BASIC: 'basic',
  /** Never acts on its own: passes priority and makes empty declarations. */
  PASSIVE: 'passive',
});

/**
 * A simple computer player. It listens to the game's `state` events and, when it
 * has something to do, emits an `action` event that the game listens to. It never
 * touches the game directly, and it only ever sends actions from `validActions`.
 *
 * `delayMs: null` acts synchronously (the game queues the action); any number
 * schedules the action with setTimeout so a viewer can follow along.
 */
export class BasicAIController extends EventEmitter {
  #game;
  #playerId;
  #delayMs;
  #strategy;
  #timer = null;
  #unsubscribers;

  constructor({ game, playerId, delayMs = 0, strategy = AI_STRATEGY.BASIC }) {
    super();
    this.#game = game;
    this.#playerId = playerId;
    this.#delayMs = delayMs;
    this.#strategy = strategy;
    this.#unsubscribers = [
      game.on('state', (state) => this.#onState(state)),
      game.listenTo(this),
    ];
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
    const mine = state.validActions.filter((a) => a.playerId === this.#playerId);
    if (mine.length === 0) return null;
    const find = (type, predicate = () => true) => mine.find((a) => a.type === type && predicate(a));
    const passive = this.#strategy === AI_STRATEGY.PASSIVE;

    switch (state.pendingDecision?.type) {
      case DECISION.DECLARE_ATTACKERS:
        return this.#moveTowards(state.pendingDecision.attackers, passive ? [] : this.#planAttack(state), find,
          ACTION.TOGGLE_ATTACKER, ACTION.CONFIRM_ATTACKERS);
      case DECISION.DECLARE_BLOCKERS:
        return this.#chooseBlock(state, passive ? {} : this.#planBlocks(state), find);
      case DECISION.ASSIGN_COMBAT_DAMAGE: {
        // Send as much damage as possible to the player (trample); otherwise take the first split.
        const toPlayer = (a) => Object.entries(a.assignment)
          .filter(([id]) => state.players.some((p) => p.id === id)).reduce((sum, [, n]) => sum + n, 0);
        return mine.reduce((best, a) => (toPlayer(a) > toPlayer(best) ? a : best));
      }
      case undefined:
        break;
      default:
        // Discarding, dividing combat damage, ...: any choice will do.
        return mine[0];
    }
    if (passive) return find(ACTION.PASS_PRIORITY);

    const permanents = state.battlefield.filter((p) => p.controllerId === this.#playerId);
    const me = state.players.find((p) => p.id === this.#playerId);
    const isManaSource = (a) => permanents.find((p) => p.id === a.cardId)
      ?.abilities.find((ab) => ab.id === a.abilityId)?.isManaAbility;
    const castable = me.hand.filter((c) => isCreature(c));
    const wantsToCast = castable.length > 0
      && state.activePlayerId === this.#playerId
      && [ 'precombatMain', 'postcombatMain' ].includes(state.phase)
      && state.stack.length === 0;

    return find(ACTION.PLAY_LAND)
      ?? find(ACTION.CAST_SPELL)
      // Only make mana when there's a creature to spend it on.
      ?? (wantsToCast && manaPoolTotal(me.manaPool) === 0 ? find(ACTION.ACTIVATE_ABILITY, isManaSource) : null)
      ?? find(ACTION.PASS_PRIORITY);
  }

  /** Attack with everything if we have more ready creatures than they have untapped blockers. */
  #planAttack(state) {
    const ready = state.validActions
      .filter((a) => a.playerId === this.#playerId && a.type === ACTION.TOGGLE_ATTACKER)
      .map((a) => a.cardId);
    const theirBlockers = state.battlefield
      .filter((p) => p.controllerId !== this.#playerId && isCreature(p) && !p.tapped);
    return ready.length > theirBlockers.length ? ready : [];
  }

  /**
   * Block each attacker with one creature that can legally block it (two for
   * menace), while creatures last. Blocks already chosen count as possible too.
   */
  #planBlocks(state) {
    const { blocks } = state.pendingDecision;
    const canBlock = (blockerId, attackerId) => blocks[blockerId] === attackerId || state.validActions.some((a) => (
      a.playerId === this.#playerId && a.type === ACTION.SET_BLOCKER && a.cardId === blockerId && a.attackerId === attackerId
    ));
    const available = new Set(state.validActions
      .filter((a) => a.playerId === this.#playerId && a.type === ACTION.SET_BLOCKER)
      .map((a) => a.cardId));
    const plan = {};
    for (const { cardId: attackerId } of state.combat.attackers) {
      const attacker = state.battlefield.find((p) => p.id === attackerId);
      const needed = hasKeyword(attacker, KEYWORD.MENACE) ? 2 : 1;
      const chosen = [...available].filter((id) => canBlock(id, attackerId)).slice(0, needed);
      if (chosen.length < needed) continue;
      for (const id of chosen) {
        plan[id] = attackerId;
        available.delete(id);
      }
    }
    return plan;
  }

  /** Toggle the first creature that differs from the plan, or confirm once they match. */
  #moveTowards(current, wanted, find, toggleType, confirmType) {
    const differs = (id) => current.includes(id) !== wanted.includes(id);
    const next = [...current, ...wanted].find(differs);
    return (next && find(toggleType, (a) => a.cardId === next)) || find(confirmType);
  }

  #chooseBlock(state, plan, find) {
    const { blocks } = state.pendingDecision;
    for (const blockerId of new Set([...Object.keys(blocks), ...Object.keys(plan)])) {
      const wanted = plan[blockerId] ?? null;
      if ((blocks[blockerId] ?? null) !== wanted) {
        const action = find(ACTION.SET_BLOCKER, (a) => a.cardId === blockerId && a.attackerId === wanted);
        if (action) return action;
      }
    }
    return find(ACTION.CONFIRM_BLOCKERS);
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
