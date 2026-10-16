import { EventEmitter } from '../engine/EventEmitter.js';
import { ACTION } from '../engine/actions.js';

/**
 * A simple computer player. It listens to the game's `state` events and, when it
 * has something to do, emits an `action` event that the game listens to. It never
 * touches the game directly.
 *
 * Strategy: play a land if it can (unless `playLands` is false), otherwise pass
 * priority. For any other decision (e.g. discarding to hand size) it takes the
 * first valid action.
 *
 * `delayMs: null` acts synchronously (the game queues the action); any number
 * schedules the action with setTimeout so a viewer can follow along.
 */
export class BasicAIController extends EventEmitter {
  #game;
  #playerId;
  #delayMs;
  #playLands;
  #timer = null;
  #unsubscribers;

  constructor({ game, playerId, delayMs = 0, playLands = true }) {
    super();
    this.#game = game;
    this.#playerId = playerId;
    this.#delayMs = delayMs;
    this.#playLands = playLands;
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

  chooseAction(validActions) {
    const mine = validActions.filter((a) => a.playerId === this.#playerId);
    const byType = (type) => mine.find((a) => a.type === type);
    return (this.#playLands && byType(ACTION.PLAY_LAND))
      ?? byType(ACTION.PASS_PRIORITY)
      ?? mine[0]
      ?? null;
  }

  #onState(state) {
    clearTimeout(this.#timer);
    const action = this.chooseAction(state.validActions);
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
