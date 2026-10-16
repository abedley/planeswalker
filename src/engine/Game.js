import { EventEmitter } from './EventEmitter.js';
import { ACTION } from './actions.js';
import { TURN_STRUCTURE, PHASE_NAMES, STEP_NAMES } from './turnStructure.js';

export const GAME_STATUS = Object.freeze({
  NOT_STARTED: 'notStarted',
  IN_PROGRESS: 'inProgress',
});

/**
 * The game engine.
 *
 * Output: the game is an EventEmitter. Fine-grained events (`turnStarted`,
 * `stepStarted`, `priorityPassed`, ...) describe each transition, and a `state`
 * event is emitted whenever the game settles and waits for player input. Every
 * `state` payload is a full snapshot that includes `validActions`.
 *
 * Input: player actions arrive through `dispatch(action)`, or by having the game
 * listen to any emitter that emits `action` events (see `listenTo`). Actions
 * dispatched while another action is being processed (e.g. by a listener
 * reacting to a `state` event) are queued and processed in order.
 */
export class Game extends EventEmitter {
  #players;
  #startingPlayerId;
  #status = GAME_STATUS.NOT_STARTED;
  #turn = 0;
  #activePlayerId = null;
  #priorityPlayerId = null;
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
   */
  constructor({ players, startingPlayerId } = {}) {
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
  }

  // Read-only views used by turn-structure skip rules.
  get turn() { return this.#turn; }
  get combat() { return this.#combat; }

  start() {
    if (this.#status !== GAME_STATUS.NOT_STARTED) throw new Error('Game already started.');
    this.#status = GAME_STATUS.IN_PROGRESS;
    this.#emitEvent('gameStarted', {
      players: this.#players.map((p) => ({ ...p })),
      startingPlayerId: this.#startingPlayerId,
    });
    this.#beginTurn(this.#startingPlayerId);
    this.#advanceToNextPrioritySegment();
    this.#emitState();
  }

  /**
   * Submit a player action. Returns `{ ok, reason? }` when processed immediately,
   * or `{ ok: true, queued: true }` when dispatched from inside an event listener.
   */
  dispatch(action) {
    this.#queue.push(action);
    if (this.#processing) return { ok: true, queued: true };

    this.#processing = true;
    let result;
    try {
      while (this.#queue.length > 0) {
        const outcome = this.#process(this.#queue.shift());
        result ??= outcome;
      }
    } finally {
      this.#processing = false;
    }
    return result;
  }

  /** Dispatch every `eventName` event emitted by `emitter`. Returns an unsubscribe function. */
  listenTo(emitter, eventName = 'action') {
    return emitter.on(eventName, (action) => this.dispatch(action));
  }

  getValidActions(playerId) {
    const actions = [];
    if (this.#status === GAME_STATUS.IN_PROGRESS && this.#priorityPlayerId) {
      actions.push({ type: ACTION.PASS_PRIORITY, playerId: this.#priorityPlayerId });
    }
    return playerId === undefined ? actions : actions.filter((a) => a.playerId === playerId);
  }

  getState() {
    const segment = this.#segment;
    return structuredClone({
      version: this.#version,
      status: this.#status,
      turn: this.#turn,
      players: this.#players,
      startingPlayerId: this.#startingPlayerId,
      activePlayerId: this.#activePlayerId,
      priorityPlayerId: this.#priorityPlayerId,
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
    }
    this.#emitState();
    return { ok: true };
  }

  #validate(action) {
    if (!action || typeof action !== 'object') return 'Action must be an object.';
    if (this.#status !== GAME_STATUS.IN_PROGRESS) return 'Game is not in progress.';
    if (!Object.values(ACTION).includes(action.type)) return `Unknown action type: ${action.type}`;
    if (!this.#players.some((p) => p.id === action.playerId)) {
      return `Unknown player: ${action.playerId}`;
    }
    const allowed = this.getValidActions(action.playerId).some((a) => a.type === action.type);
    if (!allowed) return `${action.type} is not a valid action for ${action.playerId} right now.`;
    return null;
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
    this.#advanceToNextPrioritySegment();
  }

  #givePriority(playerId) {
    this.#priorityPlayerId = playerId;
    this.#emitEvent('priorityGranted', { playerId });
  }

  // ---------------------------------------------------------------------------
  // Turn structure (Comprehensive Rules 500–514)

  get #segment() {
    return TURN_STRUCTURE[this.#segmentIndex] ?? null;
  }

  /** Leave the current segment and move forward until some player receives priority. */
  #advanceToNextPrioritySegment() {
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
    // Turn-based actions (untap, draw, declare attackers, cleanup, ...) will hook in here.
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
