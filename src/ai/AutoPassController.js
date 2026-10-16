import { EventEmitter } from '../engine/EventEmitter.js';
import { passPriority } from '../engine/actions.js';

/**
 * A trivial computer player: listens to the game's `state` events and passes
 * priority whenever passing is one of its valid actions. It never touches the
 * game directly; it emits `action` events that the game listens to.
 *
 * `delayMs: null` acts synchronously (the game queues the action); any number
 * schedules the pass with setTimeout so a viewer can follow along.
 */
export class AutoPassController extends EventEmitter {
  #game;
  #playerId;
  #delayMs;
  #timer = null;
  #unsubscribers;

  constructor({ game, playerId, delayMs = 0 }) {
    super();
    this.#game = game;
    this.#playerId = playerId;
    this.#delayMs = delayMs;
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

  #onState(state) {
    clearTimeout(this.#timer);
    const canPass = state.validActions.some((a) => a.playerId === this.#playerId);
    if (!canPass) return;

    if (this.#delayMs === null) {
      this.emit('action', passPriority(this.#playerId));
      return;
    }
    this.#timer = setTimeout(() => {
      // Only act if nothing has changed since this state was emitted.
      if (this.#game.getState().version === state.version) {
        this.emit('action', passPriority(this.#playerId));
      }
    }, this.#delayMs);
  }
}
