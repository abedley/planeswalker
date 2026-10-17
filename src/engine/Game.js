import { EventEmitter } from './EventEmitter.js';
import { ACTION } from './actions.js';
import { TURN_STRUCTURE, PHASE, STEP, PHASE_NAMES, STEP_NAMES } from './turnStructure.js';
import { seededRandom, shuffle } from './random.js';
import {
  CARDS, DEFAULT_DECK, EFFECT, isLand, isCreature, isManaAbility,
} from '../cards/cards.js';
import { emptyManaPool, addMana, planManaPayment, manaPoolTotal, MANA_TYPES } from './mana.js';

export const GAME_STATUS = Object.freeze({
  NOT_STARTED: 'notStarted',
  IN_PROGRESS: 'inProgress',
  GAME_OVER: 'gameOver',
});

export const DECISION = Object.freeze({
  DISCARD_TO_HAND_SIZE: 'discardToHandSize',
  DECLARE_ATTACKERS: 'declareAttackers',
  DECLARE_BLOCKERS: 'declareBlockers',
  ASSIGN_COMBAT_DAMAGE: 'assignCombatDamage',
});

export const STARTING_LIFE = 20; // 103.4
export const OPENING_HAND_SIZE = 7; // 103.5
export const MAX_HAND_SIZE = 7; // 402.2
export const LAND_PLAYS_PER_TURN = 1; // 305.2

const MAIN_PHASES = new Set([PHASE.PRECOMBAT_MAIN, PHASE.POSTCOMBAT_MAIN]);

/** Recursive structural equality for plain JSON-like values. */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => deepEqual(a[key], b[key]));
}

/** Every way to split `amount` among `ids`, as `{ [id]: n }` objects. */
function distributions(amount, ids) {
  if (ids.length === 1) return [{ [ids[0]]: amount }];
  const [first, ...rest] = ids;
  const result = [];
  for (let n = amount; n >= 0; n--) {
    for (const tail of distributions(amount - n, rest)) result.push({ [first]: n, ...tail });
  }
  return result;
}

/**
 * The game engine.
 *
 * Output: the game is an EventEmitter. Fine-grained events (`turnStarted`,
 * `stepStarted`, `cardsDrawn`, `spellCast`, `combatDamageDealt`, ...) describe each
 * transition, and a `state` event is emitted whenever the game settles and waits
 * for player input. Every `state` payload is a full snapshot that includes
 * `validActions`.
 *
 * The game waits for input in one of two ways: a player has priority, or a player
 * must make a decision (`pendingDecision`), such as declaring attackers.
 *
 * Input: player actions arrive through `dispatch(action)`, or by having the game
 * listen to any emitter that emits `action` events (see `listenTo`). Actions
 * dispatched while another action is being processed (e.g. by a listener
 * reacting to a `state` event) are queued and processed in order.
 */
export class Game extends EventEmitter {
  #players;
  #cardDefinitions;
  #zones = new Map(); // playerId -> { library, hand, graveyard, manaPool, life, ... }
  #battlefield = [];
  #startingPlayerId;
  #random;
  #status = GAME_STATUS.NOT_STARTED;
  #winnerId = null;
  #turn = 0;
  #activePlayerId = null;
  #priorityPlayerId = null;
  #pendingDecision = null;
  #segmentIndex = -1;
  #playersPassed = [];
  #stack = []; // last element is the top of the stack
  #nextStackObjectId = 1;
  #combat = { attackers: [] };
  #version = 0;
  #eventSeq = 0;
  #queue = [];
  #processing = false;

  /**
   * @param {object} options
   * @param {{id: string, name?: string}[]} options.players Players in turn order.
   * @param {string} [options.startingPlayerId] Defaults to the first player.
   * @param {Record<string, string[]>} [options.decks] Card ids per player id.
   *   Players without a deck get DEFAULT_DECK (5 Forests, 5 Llanowar Elves).
   * @param {number} [options.seed] Seed for shuffling; random when omitted.
   * @param {Record<string, object>} [options.cards] Extra card definitions, merged over CARDS.
   */
  constructor({ players, startingPlayerId, decks = {}, seed, cards = {} } = {}) {
    super();
    if (!Array.isArray(players) || players.length < 2) {
      throw new Error('A game needs at least two players.');
    }
    const ids = new Set(players.map((p) => p.id));
    if (ids.size !== players.length) throw new Error('Player ids must be unique.');
    this.#players = players.map(({ id, name }) => Object.freeze({ id, name: name ?? id }));
    this.#startingPlayerId = startingPlayerId ?? this.#players[0].id;
    if (!ids.has(this.#startingPlayerId)) {
      throw new Error(`Unknown starting player: ${this.#startingPlayerId}`);
    }
    this.#random = seededRandom(seed ?? Math.floor(Math.random() * 2 ** 32));
    this.#cardDefinitions = { ...CARDS, ...cards };

    for (const { id } of this.#players) {
      const deck = decks[id] ?? DEFAULT_DECK;
      const library = deck.map((cardId, i) => this.#createCard(cardId, id, i + 1));
      this.#zones.set(id, {
        library,
        hand: [],
        graveyard: [],
        manaPool: emptyManaPool(),
        life: STARTING_LIFE,
        landsPlayedThisTurn: 0,
        attemptedDrawFromEmptyLibrary: false,
        hasLost: false,
      });
    }
  }

  // Read-only views used by turn-structure skip rules.
  get turn() { return this.#turn; }
  get combat() { return this.#combat; }

  start() {
    if (this.#status !== GAME_STATUS.NOT_STARTED) throw new Error('Game already started.');
    this.#runExclusive(() => {
      this.#status = GAME_STATUS.IN_PROGRESS;
      this.#emitEvent('gameStarted', {
        players: this.#players.map((p) => ({ ...p })),
        startingPlayerId: this.#startingPlayerId,
      });
      for (const { id } of this.#players) {
        // 103.3: each player shuffles their deck; 103.5: then draws an opening hand.
        shuffle(this.#zones.get(id).library, this.#random);
        this.#emitEvent('libraryShuffled', { playerId: id });
        this.#drawCards(id, OPENING_HAND_SIZE);
      }
      this.#beginTurn(this.#startingPlayerId);
      this.#advance();
      this.#emitState();
    });
  }

  /**
   * Submit a player action. Returns `{ ok, reason? }` when processed immediately,
   * or `{ ok: true, queued: true }` when dispatched from inside an event listener.
   */
  dispatch(action) {
    this.#queue.push(action);
    if (this.#processing) return { ok: true, queued: true };
    return this.#runExclusive();
  }

  /** Dispatch every `eventName` event emitted by `emitter`. Returns an unsubscribe function. */
  listenTo(emitter, eventName = 'action') {
    return emitter.on(eventName, (action) => this.dispatch(action));
  }

  getValidActions(playerId) {
    let actions = [];
    if (this.#status !== GAME_STATUS.IN_PROGRESS) return actions;
    if (this.#pendingDecision) {
      actions = this.#decisionActions(this.#pendingDecision);
    } else if (this.#priorityPlayerId) {
      actions = this.#priorityActions(this.#priorityPlayerId);
    }
    return playerId === undefined ? actions : actions.filter((a) => a.playerId === playerId);
  }

  getState() {
    const segment = this.#segment;
    return structuredClone({
      version: this.#version,
      status: this.#status,
      winnerId: this.#winnerId,
      turn: this.#turn,
      players: this.#players.map((player) => {
        const zone = this.#zones.get(player.id);
        return {
          ...player,
          life: zone.life,
          library: zone.library,
          hand: zone.hand,
          graveyard: zone.graveyard,
          manaPool: zone.manaPool,
          landsPlayedThisTurn: zone.landsPlayedThisTurn,
          hasLost: zone.hasLost,
        };
      }),
      battlefield: this.#battlefield,
      startingPlayerId: this.#startingPlayerId,
      activePlayerId: this.#activePlayerId,
      priorityPlayerId: this.#priorityPlayerId,
      pendingDecision: this.#pendingDecision,
      phase: segment?.phase ?? null,
      phaseName: segment ? PHASE_NAMES[segment.phase] : null,
      step: segment?.step ?? null,
      stepName: segment?.step ? STEP_NAMES[segment.step] : null,
      segmentIndex: this.#segmentIndex,
      playersPassed: this.#playersPassed,
      stack: this.#stack,
      combat: this.#combat,
      validActions: this.getValidActions(),
    });
  }

  // ---------------------------------------------------------------------------
  // Valid actions

  #priorityActions(holder) {
    const actions = [{ type: ACTION.PASS_PRIORITY, playerId: holder }];
    const hand = this.#zones.get(holder).hand;
    if (this.#canPlayLand(holder)) {
      for (const card of hand.filter(isLand)) {
        actions.push({ type: ACTION.PLAY_LAND, playerId: holder, cardId: card.id });
      }
    }
    if (this.#hasSorceryTiming(holder)) {
      const pool = this.#zones.get(holder).manaPool;
      for (const card of hand.filter((c) => !isLand(c))) {
        if (planManaPayment(pool, card.manaCost)) {
          actions.push({ type: ACTION.CAST_SPELL, playerId: holder, cardId: card.id });
        }
      }
    }
    // 602.2 / 605.3a: a player with priority may activate abilities of permanents
    // they control, as long as they can pay the cost.
    for (const permanent of this.#battlefield) {
      if (permanent.controllerId !== holder) continue;
      for (const ability of this.#abilitiesOf(permanent)) {
        if (this.#canPayCost(holder, permanent, ability.cost)) {
          actions.push({
            type: ACTION.ACTIVATE_ABILITY, playerId: holder, cardId: permanent.id, abilityId: ability.id,
          });
        }
      }
    }
    return actions;
  }

  #decisionActions(decision) {
    const { playerId } = decision;
    switch (decision.type) {
      case DECISION.DISCARD_TO_HAND_SIZE:
        return this.#zones.get(playerId).hand
          .map((card) => ({ type: ACTION.DISCARD, playerId, cardId: card.id }));
      case DECISION.DECLARE_ATTACKERS:
        return [
          ...this.#eligibleAttackers(playerId)
            .map((creature) => ({ type: ACTION.TOGGLE_ATTACKER, playerId, cardId: creature.id })),
          { type: ACTION.CONFIRM_ATTACKERS, playerId },
        ];
      case DECISION.DECLARE_BLOCKERS: {
        const actions = [];
        for (const blocker of this.#eligibleBlockers(playerId)) {
          const current = decision.blocks[blocker.id] ?? null;
          for (const { cardId: attackerId } of this.#combat.attackers) {
            if (attackerId !== current) {
              actions.push({ type: ACTION.SET_BLOCKER, playerId, cardId: blocker.id, attackerId });
            }
          }
          if (current) actions.push({ type: ACTION.SET_BLOCKER, playerId, cardId: blocker.id, attackerId: null });
        }
        actions.push({ type: ACTION.CONFIRM_BLOCKERS, playerId });
        return actions;
      }
      case DECISION.ASSIGN_COMBAT_DAMAGE:
        return distributions(decision.power, decision.blockerIds).map((assignment) => ({
          type: ACTION.ASSIGN_COMBAT_DAMAGE, playerId, attackerId: decision.attackerId, assignment,
        }));
      default:
        throw new Error(`Unknown decision type: ${decision.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Action processing

  /**
   * Run `work`, then drain the action queue. Actions dispatched by listeners in
   * the meantime are queued rather than re-entering the engine. Returns the
   * outcome of the first queued action.
   */
  #runExclusive(work) {
    this.#processing = true;
    let result;
    try {
      work?.();
      while (this.#queue.length > 0) {
        const outcome = this.#process(this.#queue.shift());
        result ??= outcome;
      }
    } finally {
      this.#processing = false;
    }
    return result;
  }

  #process(action) {
    const reason = this.#validate(action);
    if (reason) {
      this.#emitEvent('actionRejected', { action, reason });
      return { ok: false, reason };
    }
    this.#emitEvent('actionAccepted', { action });
    const { playerId, cardId } = action;
    switch (action.type) {
      case ACTION.PASS_PRIORITY: this.#passPriority(playerId); break;
      case ACTION.PLAY_LAND: this.#playLand(playerId, cardId); break;
      case ACTION.CAST_SPELL: this.#castSpell(playerId, cardId); break;
      case ACTION.ACTIVATE_ABILITY: this.#activateAbility(playerId, cardId, action.abilityId); break;
      case ACTION.TOGGLE_ATTACKER: this.#toggleAttacker(cardId); break;
      case ACTION.CONFIRM_ATTACKERS: this.#confirmAttackers(); break;
      case ACTION.SET_BLOCKER: this.#setBlocker(cardId, action.attackerId); break;
      case ACTION.CONFIRM_BLOCKERS: this.#confirmBlockers(); break;
      case ACTION.ASSIGN_COMBAT_DAMAGE: this.#assignCombatDamage(action.assignment); break;
      case ACTION.DISCARD: this.#discardToHandSize(playerId, cardId); break;
    }
    this.#emitState();
    return { ok: true };
  }

  #validate(action) {
    if (!action || typeof action !== 'object') return 'Action must be an object.';
    if (this.#status !== GAME_STATUS.IN_PROGRESS) return 'Game is not in progress.';
    if (!Object.values(ACTION).includes(action.type)) return `Unknown action type: ${action.type}`;
    if (!this.#zones.has(action.playerId)) return `Unknown player: ${action.playerId}`;

    // An action is valid when it equals one of the valid actions.
    if (this.getValidActions(action.playerId).some((valid) => deepEqual(valid, action))) return null;
    const target = action.cardId ? ` with card ${action.cardId}` : '';
    return `${action.type}${target} is not a valid action for ${action.playerId} right now.`;
  }

  // ---------------------------------------------------------------------------
  // Priority (Comprehensive Rules 117)

  #passPriority(playerId) {
    this.#playersPassed.push(playerId);
    this.#emitEvent('priorityPassed', { playerId });

    if (this.#playersPassed.length < this.#players.length) {
      // 117.3d: the next player in turn order receives priority.
      this.#givePriority(this.#nextPlayerId(playerId));
      return;
    }

    // 117.4: all players passed in succession. The top object of the stack
    // resolves; with an empty stack the step or phase ends.
    this.#priorityPlayerId = null;
    if (this.#stack.length > 0) {
      this.#resolveTopOfStack();
    } else {
      this.#advance();
    }
  }

  /** Returns false if state-based actions ended the game instead. */
  #givePriority(playerId) {
    // 117.5 / 704.3: state-based actions are checked before a player receives priority.
    if (this.#checkStateBasedActions()) return false;
    this.#priorityPlayerId = playerId;
    this.#emitEvent('priorityGranted', { playerId });
    return true;
  }

  /** 117.4: taking an action breaks the run of passes. */
  #resetPasses() {
    this.#playersPassed = [];
  }

  // ---------------------------------------------------------------------------
  // Cards and zones

  #createCard(cardId, ownerId, number) {
    const definition = this.#cardDefinitions[cardId];
    if (!definition) throw new Error(`Unknown card: ${cardId}`);
    const card = {
      id: `${ownerId}-${number}`,
      cardId,
      name: definition.name,
      manaCost: definition.manaCost ?? null,
      supertypes: [...(definition.supertypes ?? [])],
      types: [...definition.types],
      subtypes: [...(definition.subtypes ?? [])],
      abilities: (definition.abilities ?? []).map(({ id, text, ...ability }) => (
        { id, text, isManaAbility: isManaAbility(ability) }
      )),
      ownerId,
    };
    if (isCreature(definition)) Object.assign(card, { power: definition.power, toughness: definition.toughness });
    return card;
  }

  #abilitiesOf(card) {
    return this.#cardDefinitions[card.cardId].abilities ?? [];
  }

  #permanent(id) {
    return this.#battlefield.find((p) => p.id === id) ?? null;
  }

  #putOntoBattlefield(card, controllerId) {
    const permanent = { ...card, controllerId, tapped: false, summoningSick: true, damage: 0 };
    this.#battlefield.push(permanent);
    return permanent;
  }

  /** Moves a permanent to its owner's graveyard, stripping battlefield-only state. */
  #putIntoGraveyard(permanent) {
    this.#battlefield.splice(this.#battlefield.indexOf(permanent), 1);
    const { controllerId, tapped, summoningSick, damage, ...card } = permanent;
    this.#zones.get(card.ownerId).graveyard.push(card);
    // 506.4: a permanent that leaves the battlefield is removed from combat.
    this.#combat.attackers = this.#combat.attackers.filter((a) => a.cardId !== permanent.id);
    for (const attacker of this.#combat.attackers) {
      attacker.blockerIds = attacker.blockerIds.filter((id) => id !== permanent.id);
    }
  }

  #drawCards(playerId, count) {
    const zone = this.#zones.get(playerId);
    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (zone.library.length === 0) {
        // 121.4: the player loses the next time state-based actions are checked.
        zone.attemptedDrawFromEmptyLibrary = true;
        this.#emitEvent('drawFromEmptyLibrary', { playerId });
        break;
      }
      const card = zone.library.shift(); // index 0 is the top of the library
      zone.hand.push(card);
      drawn.push(card.id);
    }
    if (drawn.length) {
      this.#emitEvent('cardsDrawn', { playerId, cardIds: drawn, librarySize: zone.library.length });
    }
  }

  /**
   * Sorcery timing (307.1): the player's own main phase, with priority and an
   * empty stack. Lands (305.1) and creature spells (302.1) use it.
   */
  #hasSorceryTiming(playerId) {
    return playerId === this.#activePlayerId
      && playerId === this.#priorityPlayerId
      && MAIN_PHASES.has(this.#segment?.phase)
      && this.#stack.length === 0;
  }

  #canPlayLand(playerId) {
    // 305.2: one land per turn.
    return this.#hasSorceryTiming(playerId)
      && this.#zones.get(playerId).landsPlayedThisTurn < LAND_PLAYS_PER_TURN;
  }

  #playLand(playerId, cardId) {
    // 116.2a: playing a land is a special action; it doesn't use the stack.
    const zone = this.#zones.get(playerId);
    const [card] = zone.hand.splice(zone.hand.findIndex((c) => c.id === cardId), 1);
    const permanent = this.#putOntoBattlefield(card, playerId);
    zone.landsPlayedThisTurn += 1;
    this.#emitEvent('landPlayed', { playerId, card: structuredClone(permanent) });

    // 117.3c: after a special action the same player receives priority again.
    this.#resetPasses();
    this.#givePriority(playerId);
  }

  #discardToHandSize(playerId, cardId) {
    const zone = this.#zones.get(playerId);
    const [card] = zone.hand.splice(zone.hand.findIndex((c) => c.id === cardId), 1);
    zone.graveyard.push(card);
    this.#emitEvent('cardDiscarded', { playerId, cardId });

    this.#pendingDecision.count -= 1;
    if (this.#pendingDecision.count > 0) return;
    this.#pendingDecision = null;
    this.#advance();
  }

  // ---------------------------------------------------------------------------
  // Spells, activated abilities and the stack (Comprehensive Rules 601, 602, 605, 608)

  #payMana(playerId, cost) {
    const pool = this.#zones.get(playerId).manaPool;
    const payment = planManaPayment(pool, cost);
    for (const type of MANA_TYPES) pool[type] -= payment[type];
    return payment;
  }

  #castSpell(playerId, cardId) {
    // 601.2a: the card moves from hand to the stack; 601.2h: its cost is paid.
    // (Mana must already be in the pool; activating mana abilities mid-cast isn't modelled.)
    const zone = this.#zones.get(playerId);
    const [card] = zone.hand.splice(zone.hand.findIndex((c) => c.id === cardId), 1);
    const stackObject = {
      id: `s${this.#nextStackObjectId++}`,
      kind: 'spell',
      controllerId: playerId,
      sourceId: card.id,
      sourceName: card.name,
      text: card.name,
      card,
    };
    this.#stack.push(stackObject);
    const manaPaid = this.#payMana(playerId, card.manaCost);
    this.#emitEvent('spellCast', {
      playerId, cardId, cardName: card.name, manaPaid, stackObjectId: stackObject.id,
    });
    // 117.3c: the caster receives priority.
    this.#resetPasses();
    this.#givePriority(playerId);
  }

  #canPayCost(playerId, permanent, cost) {
    if (cost.tap) {
      if (permanent.tapped) return false;
      // 302.6: a creature's {T} abilities can't be activated unless its controller
      // has controlled it continuously since their most recent turn began.
      if (isCreature(permanent) && permanent.summoningSick) return false;
    }
    if (cost.mana && !planManaPayment(this.#zones.get(playerId).manaPool, cost.mana)) return false;
    return true;
  }

  /** 602.2b: pay the cost. Returns what was paid. */
  #payCost(playerId, permanent, cost) {
    const paid = {};
    if (cost.tap) {
      permanent.tapped = true;
      paid.tap = true;
    }
    if (cost.mana) paid.mana = this.#payMana(playerId, cost.mana);
    return paid;
  }

  #activateAbility(playerId, cardId, abilityId) {
    const permanent = this.#permanent(cardId);
    const ability = this.#abilitiesOf(permanent).find((a) => a.id === abilityId);
    const costPaid = this.#payCost(playerId, permanent, ability.cost);
    const activation = {
      playerId, cardId, cardName: permanent.name, abilityId, text: ability.text, costPaid,
    };
    this.#resetPasses();

    if (isManaAbility(ability)) {
      // 605.3b: a mana ability doesn't use the stack; it resolves immediately and
      // the player keeps priority.
      this.#emitEvent('abilityActivated', { ...activation, usesStack: false });
      this.#applyEffect(ability.effect, playerId);
      return;
    }

    // 602.2a: the ability goes on the stack, then (602.2b) its costs are paid.
    const stackObject = {
      id: `s${this.#nextStackObjectId++}`,
      kind: 'activatedAbility',
      controllerId: playerId,
      sourceId: cardId,
      sourceName: permanent.name,
      abilityId,
      text: ability.text,
      effect: structuredClone(ability.effect),
    };
    this.#stack.push(stackObject);
    this.#emitEvent('abilityActivated', { ...activation, usesStack: true, stackObjectId: stackObject.id });
    // 117.3c: the player who activated the ability receives priority.
    this.#givePriority(playerId);
  }

  #resolveTopOfStack() {
    // 608.2: the top object resolves.
    const stackObject = this.#stack.pop();
    this.#emitEvent('stackObjectResolving', { stackObject: structuredClone(stackObject) });
    if (stackObject.kind === 'spell') {
      // 608.3: a permanent spell enters the battlefield under its controller's control.
      const permanent = this.#putOntoBattlefield(stackObject.card, stackObject.controllerId);
      this.#emitEvent('permanentEntered', { playerId: stackObject.controllerId, card: structuredClone(permanent) });
    } else {
      this.#applyEffect(stackObject.effect, stackObject.controllerId);
    }
    this.#emitEvent('stackObjectResolved', { stackObjectId: stackObject.id });
    // 117.3b: after resolution, the active player receives priority.
    this.#resetPasses();
    this.#givePriority(this.#activePlayerId);
  }

  #applyEffect(effect, controllerId) {
    switch (effect.type) {
      case EFFECT.ADD_MANA: {
        const pool = this.#zones.get(controllerId).manaPool;
        addMana(pool, effect.mana);
        this.#emitEvent('manaAdded', { playerId: controllerId, mana: { ...effect.mana }, manaPool: { ...pool } });
        break;
      }
      case EFFECT.DRAW_CARDS:
        this.#drawCards(controllerId, effect.count);
        break;
      default:
        throw new Error(`Unknown effect type: ${effect.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Combat (Comprehensive Rules 506–511)

  #defendingPlayerId() {
    // 506.2: in a two-player game, the defending player is the nonactive player.
    return this.#nextPlayerId(this.#activePlayerId);
  }

  #eligibleAttackers(playerId) {
    // 508.1a: untapped creatures the player has controlled continuously since
    // their turn began.
    return this.#battlefield.filter((p) => (
      p.controllerId === playerId && isCreature(p) && !p.tapped && !p.summoningSick
    ));
  }

  #eligibleBlockers(playerId) {
    // 509.1a: untapped creatures the defending player controls.
    return this.#battlefield.filter((p) => p.controllerId === playerId && isCreature(p) && !p.tapped);
  }

  #beginDeclareAttackers() {
    // 508.1: the active player declares attackers (a turn-based action).
    const playerId = this.#activePlayerId;
    if (this.#eligibleAttackers(playerId).length === 0) {
      this.#emitEvent('attackersDeclared', { playerId, attackers: [], defendingPlayerId: this.#defendingPlayerId() });
      return;
    }
    this.#requireDecision({ type: DECISION.DECLARE_ATTACKERS, playerId, attackers: [] });
  }

  #toggleAttacker(cardId) {
    const decision = this.#pendingDecision;
    decision.attackers = decision.attackers.includes(cardId)
      ? decision.attackers.filter((id) => id !== cardId)
      : [...decision.attackers, cardId];
  }

  #confirmAttackers() {
    const { playerId, attackers } = this.#pendingDecision;
    this.#pendingDecision = null;
    const defendingPlayerId = this.#defendingPlayerId();
    // 508.1f: attacking creatures become tapped.
    for (const id of attackers) this.#permanent(id).tapped = true;
    this.#combat.attackers = attackers.map((cardId) => (
      { cardId, defendingPlayerId, blocked: false, blockerIds: [], damageAssignment: null }
    ));
    this.#emitEvent('attackersDeclared', { playerId, attackers: [...attackers], defendingPlayerId });
    // 508.2: the active player then receives priority.
    this.#givePriority(this.#activePlayerId);
  }

  #beginDeclareBlockers() {
    // 509.1: the defending player declares blockers (a turn-based action).
    const playerId = this.#defendingPlayerId();
    if (this.#eligibleBlockers(playerId).length === 0) {
      this.#emitEvent('blockersDeclared', { playerId, blocks: [] });
      return;
    }
    this.#requireDecision({ type: DECISION.DECLARE_BLOCKERS, playerId, blocks: {} });
  }

  #setBlocker(cardId, attackerId) {
    const { blocks } = this.#pendingDecision;
    if (attackerId === null) delete blocks[cardId];
    else blocks[cardId] = attackerId;
  }

  #confirmBlockers() {
    const { playerId, blocks } = this.#pendingDecision;
    this.#pendingDecision = null;
    // 509.1g / 509.1h: each blocker blocks one attacker, which becomes blocked.
    for (const [blockerId, attackerId] of Object.entries(blocks)) {
      const attacker = this.#combat.attackers.find((a) => a.cardId === attackerId);
      attacker.blocked = true;
      attacker.blockerIds.push(blockerId);
    }
    this.#emitEvent('blockersDeclared', {
      playerId,
      blocks: Object.entries(blocks).map(([blockerId, attackerId]) => ({ blockerId, attackerId })),
    });
    // 509.2: the active player then receives priority.
    this.#givePriority(this.#activePlayerId);
  }

  /**
   * 510.1c: an attacker blocked by more than one creature has its damage divided
   * among them by the attacking player. Asks for the next such division, if any.
   */
  #requestDamageAssignment() {
    for (const attacker of this.#combat.attackers) {
      const creature = this.#permanent(attacker.cardId);
      if (attacker.damageAssignment || creature.power <= 0 || attacker.blockerIds.length < 2) continue;
      this.#requireDecision({
        type: DECISION.ASSIGN_COMBAT_DAMAGE,
        playerId: this.#activePlayerId,
        attackerId: attacker.cardId,
        power: creature.power,
        blockerIds: [...attacker.blockerIds],
      });
      return true;
    }
    return false;
  }

  #assignCombatDamage(assignment) {
    const { attackerId } = this.#pendingDecision;
    this.#pendingDecision = null;
    this.#combat.attackers.find((a) => a.cardId === attackerId).damageAssignment = { ...assignment };
    if (this.#requestDamageAssignment()) return;
    this.#dealCombatDamage();
    this.#givePriority(this.#activePlayerId);
  }

  #dealCombatDamage() {
    // 510.1: work out all combat damage first; 510.2: then deal it simultaneously.
    const damage = [];
    const hit = (sourceId, target, amount) => { if (amount > 0) damage.push({ sourceId, ...target, amount }); };
    for (const attacker of this.#combat.attackers) {
      const creature = this.#permanent(attacker.cardId);
      if (!attacker.blocked) {
        // 510.1a: an unblocked creature deals damage to the player it's attacking.
        hit(creature.id, { targetPlayerId: attacker.defendingPlayerId }, creature.power);
      } else if (attacker.blockerIds.length === 1) {
        hit(creature.id, { targetCardId: attacker.blockerIds[0] }, creature.power);
      } else {
        // 510.1c: divided as assigned. A blocked creature with no blockers left deals no damage.
        for (const [blockerId, amount] of Object.entries(attacker.damageAssignment ?? {})) {
          hit(creature.id, { targetCardId: blockerId }, amount);
        }
      }
      // 510.1d: each blocker deals its damage to the creature it blocks.
      for (const blockerId of attacker.blockerIds) {
        const blocker = this.#permanent(blockerId);
        hit(blocker.id, { targetCardId: creature.id }, blocker.power);
      }
    }
    for (const { targetPlayerId, targetCardId, amount } of damage) {
      // 120.3a / 120.3e: damage to a player causes life loss; damage to a creature is marked on it.
      if (targetPlayerId) this.#zones.get(targetPlayerId).life -= amount;
      else this.#permanent(targetCardId).damage += amount;
    }
    this.#emitEvent('combatDamageDealt', {
      damage,
      life: Object.fromEntries([...this.#zones].map(([id, zone]) => [id, zone.life])),
    });
  }

  // ---------------------------------------------------------------------------
  // State-based actions (Comprehensive Rules 704)

  /** Performs state-based actions until there are none. Returns true if the game ended. */
  #checkStateBasedActions() {
    for (;;) {
      const losers = this.#players.filter(({ id }) => {
        const zone = this.#zones.get(id);
        // 704.5a: 0 or less life; 704.5b: attempted to draw from an empty library.
        return !zone.hasLost && (zone.life <= 0 || zone.attemptedDrawFromEmptyLibrary);
      });
      // 704.5f: toughness 0 or less; 704.5g: lethal damage.
      const dying = this.#battlefield.filter((p) => isCreature(p) && (p.toughness <= 0 || p.damage >= p.toughness));
      if (losers.length === 0 && dying.length === 0) return false;

      // 704.3: all applicable state-based actions happen simultaneously.
      for (const permanent of dying) {
        this.#putIntoGraveyard(permanent);
        this.#emitEvent('creatureDied', {
          cardId: permanent.id,
          cardName: permanent.name,
          controllerId: permanent.controllerId,
          reason: permanent.toughness <= 0 ? 'zeroToughness' : 'lethalDamage',
        });
      }
      for (const { id } of losers) {
        const zone = this.#zones.get(id);
        zone.hasLost = true;
        const reason = zone.life <= 0 ? 'Life total reached 0.' : 'Attempted to draw from an empty library.';
        this.#emitEvent('playerLost', { playerId: id, reason });
      }
      if (losers.length > 0) {
        this.#endGame();
        return true;
      }
    }
  }

  #endGame() {
    // Multiplayer elimination isn't modelled: the game ends as soon as anyone loses.
    const remaining = this.#players.filter((p) => !this.#zones.get(p.id).hasLost);
    this.#status = GAME_STATUS.GAME_OVER;
    this.#winnerId = remaining.length === 1 ? remaining[0].id : null;
    this.#priorityPlayerId = null;
    this.#pendingDecision = null;
    this.#emitEvent('gameEnded', { winnerId: this.#winnerId });
  }

  // ---------------------------------------------------------------------------
  // Turn structure (Comprehensive Rules 500–514)

  get #segment() {
    return TURN_STRUCTURE[this.#segmentIndex] ?? null;
  }

  #requireDecision(decision) {
    this.#pendingDecision = decision;
    this.#emitEvent('decisionRequired', structuredClone(decision));
  }

  /**
   * Leave the current segment and move forward until a player receives priority
   * or must make a decision.
   */
  #advance() {
    for (;;) {
      const current = this.#segment;
      const { nextIndex, skipped } = this.#findNextSegment(this.#segmentIndex);
      const next = TURN_STRUCTURE[nextIndex] ?? null;

      if (current) this.#leaveSegment(current, next);
      for (const segment of skipped) this.#emitEvent('stepSkipped', this.#describe(segment));

      if (!next) {
        this.#emitEvent('turnEnded', { turn: this.#turn, activePlayerId: this.#activePlayerId });
        this.#beginTurn(this.#nextPlayerId(this.#activePlayerId));
        continue;
      }

      this.#enterSegment(nextIndex);
      if (this.#pendingDecision) return;
      if (next.priority) {
        // 117.3a: the active player receives priority at the start of each step and phase.
        this.#givePriority(this.#activePlayerId);
        return;
      }
    }
  }

  #findNextSegment(fromIndex) {
    const skipped = [];
    for (let i = fromIndex + 1; i < TURN_STRUCTURE.length; i++) {
      const segment = TURN_STRUCTURE[i];
      if (!segment.skip?.(this)) return { nextIndex: i, skipped };
      skipped.push(segment);
    }
    return { nextIndex: -1, skipped };
  }

  #beginTurn(activePlayerId) {
    this.#turn += 1;
    this.#activePlayerId = activePlayerId;
    this.#segmentIndex = -1;
    this.#combat = { attackers: [] };
    for (const zone of this.#zones.values()) zone.landsPlayedThisTurn = 0;
    // 302.6: the active player has now controlled their permanents since the turn began.
    for (const permanent of this.#battlefield) {
      if (permanent.controllerId === activePlayerId) permanent.summoningSick = false;
    }
    this.#emitEvent('turnStarted', { turn: this.#turn, activePlayerId });
  }

  #enterSegment(index) {
    const previous = this.#segment;
    const segment = TURN_STRUCTURE[index];
    this.#segmentIndex = index;
    this.#resetPasses();
    this.#priorityPlayerId = null;

    if (!previous || previous.phase !== segment.phase) {
      this.#emitEvent('phaseStarted', this.#describe({ phase: segment.phase, step: null }));
    }
    if (segment.step) this.#emitEvent('stepStarted', this.#describe(segment));
    this.#performTurnBasedActions(segment);
  }

  #performTurnBasedActions({ step }) {
    const active = this.#activePlayerId;
    switch (step) {
      case STEP.UNTAP: {
        // 502.3: the active player untaps their permanents.
        const untapped = this.#battlefield.filter((p) => p.controllerId === active && p.tapped);
        untapped.forEach((p) => { p.tapped = false; });
        if (untapped.length) {
          this.#emitEvent('permanentsUntapped', { playerId: active, cardIds: untapped.map((p) => p.id) });
        }
        break;
      }
      case STEP.DRAW:
        // 504.1: the active player draws a card.
        this.#drawCards(active, 1);
        break;
      case STEP.DECLARE_ATTACKERS:
        this.#beginDeclareAttackers();
        break;
      case STEP.DECLARE_BLOCKERS:
        this.#beginDeclareBlockers();
        break;
      case STEP.COMBAT_DAMAGE:
        if (!this.#requestDamageAssignment()) this.#dealCombatDamage();
        break;
      case STEP.CLEANUP: {
        // 514.1: the active player discards down to their maximum hand size.
        const excess = this.#zones.get(active).hand.length - MAX_HAND_SIZE;
        if (excess > 0) {
          this.#requireDecision({ type: DECISION.DISCARD_TO_HAND_SIZE, playerId: active, count: excess });
        }
        // 514.2: damage wears off.
        for (const permanent of this.#battlefield) permanent.damage = 0;
        break;
      }
    }
  }

  #leaveSegment(current, next) {
    this.#priorityPlayerId = null;
    // 500.4: mana empties from each player's mana pool as each step and phase ends.
    const emptied = [];
    for (const [playerId, zone] of this.#zones) {
      if (manaPoolTotal(zone.manaPool) === 0) continue;
      emptied.push({ playerId, lost: zone.manaPool });
      zone.manaPool = emptyManaPool();
    }
    if (emptied.length) this.#emitEvent('manaPoolsEmptied', { pools: emptied });
    // 511.3: creatures are removed from combat as the end of combat step ends.
    if (current.step === STEP.END_OF_COMBAT) this.#combat = { attackers: [] };

    if (current.step) this.#emitEvent('stepEnded', this.#describe(current));
    if (!next || next.phase !== current.phase) {
      this.#emitEvent('phaseEnded', this.#describe({ phase: current.phase, step: null }));
    }
  }

  #describe({ phase, step }) {
    return {
      turn: this.#turn,
      activePlayerId: this.#activePlayerId,
      phase,
      phaseName: PHASE_NAMES[phase],
      step,
      stepName: step ? STEP_NAMES[step] : null,
    };
  }

  #nextPlayerId(playerId) {
    const index = this.#players.findIndex((p) => p.id === playerId);
    return this.#players[(index + 1) % this.#players.length].id;
  }

  // ---------------------------------------------------------------------------
  // Emission

  #emitEvent(name, data) {
    this.emit(name, { seq: ++this.#eventSeq, ...data });
  }

  #emitState() {
    this.#version += 1;
    this.#emitEvent('state', this.getState());
  }
}
