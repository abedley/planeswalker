import { EventEmitter } from '../engine/EventEmitter.js';
import { ACTION } from '../engine/actions.js';
import { DECISION } from '../engine/Game.js';
import {
  isCreature, isLand, isAura, isEquipment, hasKeyword, manaValue, KEYWORD, EFFECT, HARMFUL_EFFECTS, TARGET,
} from '../cards/cards.js';
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
    const myCreatures = new Set(permanents.filter(isCreature).map((p) => p.id));
    const abilityOf = (a) => permanents.find((p) => p.id === a.cardId)?.abilities.find((ab) => ab.id === a.abilityId);
    const isManaSource = (a) => abilityOf(a)?.isManaAbility;
    // The sample Auras and Equipment are all bonuses: only put them on our own creatures.
    const onOwnCreatures = (a) => (a.targets ?? []).every((id) => myCreatures.has(id));
    const unattachedEquipment = permanents.filter((p) => isEquipment(p) && !p.attachedTo);
    const isEquipForLooseEquipment = (a) => abilityOf(a)?.id === 'equip'
      && unattachedEquipment.some((e) => e.id === a.cardId) && onOwnCreatures(a);
    // Emblem abilities that cost nothing are free value.
    const isFreeEmblemAbility = (a) => me.emblems.find((e) => e.id === a.cardId)
      ?.abilities.find((ab) => ab.id === a.abilityId && Object.keys(ab.cost).length === 0);

    return find(ACTION.PLAY_LAND)
      ?? this.#chooseCast(state, me, mine, myCreatures, onOwnCreatures)
      ?? find(ACTION.ACTIVATE_ABILITY, isEquipForLooseEquipment)
      ?? find(ACTION.ACTIVATE_ABILITY, isFreeEmblemAbility)
      // Only make mana when there's something affordable to spend it on.
      ?? (this.#wantsMana(state, me, permanents, myCreatures, unattachedEquipment, mine.filter(isManaSource).length)
        ? find(ACTION.ACTIVATE_ABILITY, isManaSource) : null)
      ?? find(ACTION.PASS_PRIORITY);
  }

  /**
   * Whether to tap another mana source: at sorcery timing, when there's a spell
   * (or an equip for loose Equipment) we'd use whose cost we could reach with the
   * sources still untapped, but can't pay from the pool yet.
   */
  #wantsMana(state, me, permanents, myCreatures, unattachedEquipment, untappedSources) {
    const sorceryTiming = state.activePlayerId === this.#playerId
      && ['precombatMain', 'postcombatMain'].includes(state.phase)
      && state.stack.length === 0;
    if (!sorceryTiming || untappedSources === 0) return false;
    const costs = [
      ...me.hand.filter((c) => !isLand(c) && this.#worthCasting(c, state, myCreatures)).map((c) => c.manaCost),
      ...(myCreatures.size > 0 ? unattachedEquipment : [])
        .map((e) => e.abilities.find((ab) => ab.id === 'equip')?.cost.mana).filter(Boolean),
    ];
    const available = manaPoolTotal(me.manaPool) + untappedSources;
    return costs.some((cost) => manaValue(cost) <= available && manaValue(cost) > manaPoolTotal(me.manaPool));
  }

  /** Whether a card in hand has a sensible use right now (used to decide whether to make mana). */
  #worthCasting(card, state, myCreatures) {
    const theirCreatures = state.battlefield.filter((p) => p.controllerId !== this.#playerId && isCreature(p));
    if (isAura(card)) return myCreatures.size > 0;
    if (!card.spell) return true;
    const harmful = card.spell.effects.some((e) => HARMFUL_EFFECTS.has(e.type));
    if (harmful) return card.spell.target === TARGET.ANY || theirCreatures.length > 0;
    if (card.spell.target) return myCreatures.size > 0;
    return true;
  }

  /**
   * Picks a spell to cast, and its target: harmful spells at the opponent (killing
   * their biggest creature it can, otherwise their face), helpful ones at our own
   * creatures that can still attack, and untargeted ones whenever.
   */
  #chooseCast(state, me, mine, myCreatures, onOwnCreatures) {
    const opponentId = state.players.find((p) => p.id !== this.#playerId).id;
    const byId = (id) => state.battlefield.find((p) => p.id === id);
    const theirs = (id) => id === opponentId || byId(id)?.controllerId === opponentId;
    let best = null;
    let bestScore = 0;
    for (const action of mine.filter((a) => a.type === ACTION.CAST_SPELL)) {
      const card = me.hand.find((c) => c.id === action.cardId);
      const targets = action.targets ?? [];
      let score = 0;
      if (!card.spell) {
        score = onOwnCreatures(action) ? 1 : 0;
      } else if (card.spell.effects.some((e) => HARMFUL_EFFECTS.has(e.type))) {
        if (!targets.every(theirs)) continue;
        const target = byId(targets[0]);
        const damage = card.spell.effects.find((e) => e.type === EFFECT.DEAL_DAMAGE)?.amount;
        const destroys = card.spell.effects.some((e) => e.type === EFFECT.DESTROY);
        if (!target) score = 1; // the opponent's face
        else if (destroys || (damage && target.toughness - target.damage <= damage)) score = 10 + target.power;
      } else if (targets.length) {
        // A pump: only before combat, on a creature of ours that can attack this turn.
        const target = byId(targets[0]);
        const canAttack = target && myCreatures.has(target.id) && !target.tapped
          && (!target.summoningSick || hasKeyword(target, KEYWORD.HASTE)) && !hasKeyword(target, KEYWORD.DEFENDER);
        score = canAttack && state.phase === 'precombatMain' ? 2 : 0;
      } else {
        score = 1;
      }
      if (score > bestScore) {
        best = action;
        bestScore = score;
      }
    }
    return best;
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
