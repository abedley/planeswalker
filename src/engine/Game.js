import { EventEmitter } from './EventEmitter.js';
import { ACTION } from './actions.js';
import { TURN_STRUCTURE, PHASE, STEP, PHASE_NAMES, STEP_NAMES } from './turnStructure.js';
import { seededRandom, shuffle } from './random.js';
import { CARDS, DEFAULT_DECK, isLand } from '../cards/cards.js';

export const GAME_STATUS = Object.freeze({
  NOT_STARTED: 'notStarted',
  IN_PROGRESS: 'inProgress',
  GAME_OVER: 'gameOver',
});

export const OPENING_HAND_SIZE = 7; // 103.5
export const MAX_HAND_SIZE = 7; // 402.2
export const LAND_PLAYS_PER_TURN = 1; // 305.2

const MAIN_PHASES = new Set([PHASE.PRECOMBAT_MAIN, PHASE.POSTCOMBAT_MAIN]);

/**
 * The game engine.
 *
 * Output: the game is an EventEmitter. Fine-grained events (`turnStarted`,
 * `stepStarted`, `cardsDrawn`, `landPlayed`, ...) describe each transition, and a
 * `state` event is emitted whenever the game settles and waits for player input.
 * Every `state` payload is a full snapshot that includes `validActions`.
 *
 * Input: player actions arrive through `dispatch(action)`, or by having the game
 * listen to any emitter that emits `action` events (see `listenTo`). Actions
 * dispatched while another action is being processed (e.g. by a listener
 * reacting to a `state` event) are queued and processed in order.
 */
export class Game extends EventEmitter {
  #players;
  #zones = new Map(); // playerId -> { library, hand, graveyard, landsPlayedThisTurn, ... }
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
  #stack = [];
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
   *   Players without a deck get DEFAULT_DECK (10 Forests).
   * @param {number} [options.seed] Seed for shuffling; random when omitted.
   */
  constructor({ players, startingPlayerId, decks = {}, seed } = {}) {
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

    for (const { id } of this.#players) {
      const deck = decks[id] ?? DEFAULT_DECK;
      const library = deck.map((cardId, i) => this.#createCard(cardId, id, i + 1));
      this.#zones.set(id, {
        library,
        hand: [],
        graveyard: [],
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
    const actions = [];
    if (this.#status !== GAME_STATUS.IN_PROGRESS) return actions;

    if (this.#pendingDecision?.type === 'discardToHandSize') {
      const { playerId: chooser } = this.#pendingDecision;
      for (const card of this.#zones.get(chooser).hand) {
        actions.push({ type: ACTION.DISCARD, playerId: chooser, cardId: card.id });
      }
    } else if (this.#priorityPlayerId) {
      const holder = this.#priorityPlayerId;
      actions.push({ type: ACTION.PASS_PRIORITY, playerId: holder });
      if (this.#canPlayLand(holder)) {
        for (const card of this.#zones.get(holder).hand.filter(isLand)) {
          actions.push({ type: ACTION.PLAY_LAND, playerId: holder, cardId: card.id });
        }
      }
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
          library: zone.library,
          hand: zone.hand,
          graveyard: zone.graveyard,
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
    switch (action.type) {
      case ACTION.PASS_PRIORITY:
        this.#passPriority(action.playerId);
        break;
      case ACTION.PLAY_LAND:
        this.#playLand(action.playerId, action.cardId);
        break;
      case ACTION.DISCARD:
        this.#discardToHandSize(action.playerId, action.cardId);
        break;
    }
    this.#emitState();
    return { ok: true };
  }

  #validate(action) {
    if (!action || typeof action !== 'object') return 'Action must be an object.';
    if (this.#status !== GAME_STATUS.IN_PROGRESS) return 'Game is not in progress.';
    if (!Object.values(ACTION).includes(action.type)) return `Unknown action type: ${action.type}`;
    if (!this.#zones.has(action.playerId)) return `Unknown player: ${action.playerId}`;

    // An action is valid when it matches one of the valid actions field for field.
    const matches = (valid) => Object.keys(valid).every((key) => valid[key] === action[key]);
    if (this.getValidActions(action.playerId).some(matches)) return null;
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

    // 117.4: all players passed in succession. With an empty stack the step or
    // phase ends. (Resolving the top of a non-empty stack is not implemented yet.)
    this.#priorityPlayerId = null;
    this.#advance();
  }

  /** Returns false if state-based actions ended the game instead. */
  #givePriority(playerId) {
    // 117.5 / 704.3: state-based actions are checked before a player receives priority.
    if (this.#checkStateBasedActions()) return false;
    this.#priorityPlayerId = playerId;
    this.#emitEvent('priorityGranted', { playerId });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Cards and zones

  #createCard(cardId, ownerId, number) {
    const definition = CARDS[cardId];
    if (!definition) throw new Error(`Unknown card: ${cardId}`);
    return {
      id: `${ownerId}-${number}`,
      cardId,
      name: definition.name,
      types: [...definition.types],
      ownerId,
    };
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

  #canPlayLand(playerId) {
    // 305.1 / 505.6b: a player may play a land during their own main phase,
    // while they have priority and the stack is empty, ...
    // 305.2: ... if they haven't used their land play for the turn.
    return playerId === this.#activePlayerId
      && playerId === this.#priorityPlayerId
      && MAIN_PHASES.has(this.#segment?.phase)
      && this.#stack.length === 0
      && this.#zones.get(playerId).landsPlayedThisTurn < LAND_PLAYS_PER_TURN;
  }

  #playLand(playerId, cardId) {
    // 116.2a: playing a land is a special action; it doesn't use the stack.
    const zone = this.#zones.get(playerId);
    const [card] = zone.hand.splice(zone.hand.findIndex((c) => c.id === cardId), 1);
    const permanent = { ...card, controllerId: playerId, tapped: false };
    this.#battlefield.push(permanent);
    zone.landsPlayedThisTurn += 1;
    this.#emitEvent('landPlayed', { playerId, card: structuredClone(permanent) });

    // 117.4: taking an action breaks the run of passes. 117.3c: after a special
    // action the same player receives priority again.
    this.#playersPassed = [];
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
  // State-based actions (Comprehensive Rules 704)

  /** Returns true if the game ended. */
  #checkStateBasedActions() {
    let someoneLost = false;
    for (const { id } of this.#players) {
      const zone = this.#zones.get(id);
      if (zone.attemptedDrawFromEmptyLibrary && !zone.hasLost) {
        // 704.5b: a player who attempted to draw from an empty library loses.
        zone.hasLost = true;
        someoneLost = true;
        this.#emitEvent('playerLost', { playerId: id, reason: 'Attempted to draw from an empty library.' });
      }
    }
    if (!someoneLost) return false;

    // Multiplayer elimination isn't modelled: the game ends as soon as anyone loses.
    const remaining = this.#players.filter((p) => !this.#zones.get(p.id).hasLost);
    this.#status = GAME_STATUS.GAME_OVER;
    this.#winnerId = remaining.length === 1 ? remaining[0].id : null;
    this.#priorityPlayerId = null;
    this.#pendingDecision = null;
    this.#emitEvent('gameEnded', { winnerId: this.#winnerId });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Turn structure (Comprehensive Rules 500–514)

  get #segment() {
    return TURN_STRUCTURE[this.#segmentIndex] ?? null;
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
    this.#emitEvent('turnStarted', { turn: this.#turn, activePlayerId });
  }

  #enterSegment(index) {
    const previous = this.#segment;
    const segment = TURN_STRUCTURE[index];
    this.#segmentIndex = index;
    this.#playersPassed = [];
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
      case STEP.CLEANUP: {
        // 514.1: the active player discards down to their maximum hand size.
        const excess = this.#zones.get(active).hand.length - MAX_HAND_SIZE;
        if (excess > 0) {
          this.#pendingDecision = { type: 'discardToHandSize', playerId: active, count: excess };
          this.#emitEvent('decisionRequired', structuredClone(this.#pendingDecision));
        }
        break;
      }
    }
  }

  #leaveSegment(current, next) {
    // 500.4: mana pools empty at the end of each step and phase (no mana exists yet).
    this.#priorityPlayerId = null;
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
