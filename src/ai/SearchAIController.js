import { EventEmitter } from '../engine/EventEmitter.js';
import { DECISION } from '../engine/Game.js';
import { PHASE } from '../engine/turnStructure.js';
import { ACTION } from '../engine/actions.js';
import { seededRandom } from '../engine/random.js';
import { BasicAIController } from './BasicAIController.js';
import { listMacros, nextAction } from './macroActions.js';
import { worthSearching, defaultMacros } from './search.js';
import { actingPlayerId } from './simulate.js';
import { createSearchRunner } from './searchRunner.js';
import { weightsFor } from './evaluate.js';

/**
 * A computer player that searches (see search.js): it simulates its options in
 * games guessed from what it knows, using a Web Worker so the page stays
 * responsive.
 *
 * It's careful not to give anything away:
 * - **Uniform timing.** Every time it gets priority, it answers after
 *   `responseMs` plus random jitter (up to `jitterMs`), whether it passes or acts
 *   and whether or not it holds anything it could act with. Its searches at those
 *   moments fit inside that delay.
 * - **Visible thinking only at public moments:** its own main phase and its own
 *   attack and block declarations, which come every turn whatever its hand. Then it
 *   takes `budgetMs` and emits `thinking` events (`{ active, candidates? }`).
 * - **Pondering.** While the opponent decides, it already searches the position
 *   it would face if the opponent passed, so its answer is ready in time.
 * - It only ever sends the search game.getPlayerView(playerId).
 *
 * Options: `weights` (the deck's evaluation weights: a deck or archetype name, or
 * weights, see weightsFor), `budgetMs` (thinking time, default 2000), `responseMs` (default 500),
 * `jitterMs` (default 250), `seed`, `runner` (a search runner, see searchRunner.js),
 * `timers` (`{ setTimeout, clearTimeout, now }`, for tests).
 */
export class SearchAIController extends EventEmitter {
  #game;
  #playerId;
  #budgetMs;
  #responseMs;
  #jitterMs;
  /** For response delays only, so whether we searched can't shift them. */
  #jitter;
  /** For search seeds. */
  #random;
  #runner;
  #timers;
  #fallback;
  #weights;
  #unsubscribers;
  #current = null;
  #ponder = null;
  #timer = null;
  #turnOf = 0;

  constructor({
    game, playerId, weights, budgetMs = 2000, responseMs = 500, jitterMs = 250, seed = Math.floor(Math.random() * 2 ** 32),
    runner = createSearchRunner(), timers = {
      setTimeout: (...args) => setTimeout(...args),
      clearTimeout: (id) => clearTimeout(id),
      now: () => performance.now(),
    },
  }) {
    super();
    this.#game = game;
    this.#playerId = playerId;
    this.#budgetMs = budgetMs;
    this.#responseMs = responseMs;
    this.#jitterMs = jitterMs;
    this.#jitter = seededRandom(seed);
    this.#random = seededRandom(seed ^ 0x5bd1e995);
    this.#runner = runner;
    this.#timers = timers;
    this.#fallback = new BasicAIController({ game: null, playerId });
    this.#weights = weightsFor(weights);
    this.#unsubscribers = [
      game.on('state', (state) => this.#onState(state)),
      game.listenTo(this),
    ];
  }

  get playerId() { return this.#playerId; }

  /** The thinking time at public moments, in milliseconds. */
  set budgetMs(value) { this.#budgetMs = value; }

  detach() {
    this.#timers.clearTimeout(this.#timer);
    this.#unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.#runner.dispose();
  }

  /** Act on the game's current state, e.g. right after taking control mid-game. */
  actNow() {
    this.#onState(this.#game.getState());
  }

  /** Moments when thinking visibly reveals nothing: our main phase and our declarations. */
  #isThinkingMoment(state) {
    const decision = state.pendingDecision;
    if (decision) return decision.type === DECISION.DECLARE_ATTACKERS || decision.type === DECISION.DECLARE_BLOCKERS;
    return state.activePlayerId === this.#playerId && state.stack.length === 0
      && (state.phase === PHASE.PRECOMBAT_MAIN || state.phase === PHASE.POSTCOMBAT_MAIN);
  }

  async #onState(state) {
    this.#timers.clearTimeout(this.#timer);
    const turn = ++this.#turnOf;
    const me = this.#playerId;
    if (actingPlayerId(state) !== me) {
      this.#current = null;
      this.#startPondering(state);
      return;
    }
    const started = this.#timers.now();
    const context = `${state.turn}:${state.segmentIndex}:${state.pendingDecision?.type ?? 'priority'}`;
    // Carrying on with a macro (tapping mana for a spell, toggling attackers, ...)
    // right after our own visible action: a short fixed step.
    const step = this.#current?.context === context ? nextAction(state, me, this.#current.macro) : null;
    if (step) {
      if (step.done) this.#current = null;
      this.#timer = this.#timers.setTimeout(() => {
        if (turn === this.#turnOf) this.emit('action', step.action);
      }, STEP_MS);
      return;
    }
    this.#current = null;
    const thinking = this.#isThinkingMoment(state);
    // The delay, and whether we're seen thinking, are decided from public information
    // only, before looking at anything private.
    const delay = thinking ? this.#budgetMs : this.#responseMs + this.#jitter() * this.#jitterMs;
    if (thinking) this.emit('thinking', { active: true });
    const action = await this.#decide(state, context, thinking ? this.#budgetMs : this.#responseMs * 0.8);
    if (turn !== this.#turnOf || !action) return;
    const wait = Math.max(0, started + delay - this.#timers.now());
    this.#timer = this.#timers.setTimeout(() => {
      // Only act if nothing has changed since this state was emitted.
      if (turn !== this.#turnOf) return;
      if (thinking) this.emit('thinking', { active: false });
      this.emit('action', action);
    }, wait);
  }

  async #decide(state, context, budgetMs) {
    const me = this.#playerId;
    const macros = worthSearching(state, me) ? listMacros(state, me) : [];
    if (macros.length <= 1) return this.#fallback.chooseAction(state);

    const thinking = this.#isThinkingMoment(state);
    const view = this.#game.getPlayerView(me);
    const key = viewKey(view);
    let result = null;
    if (this.#ponder?.key === key) result = await this.#ponder.result;
    this.#ponder = null;
    result ??= await this.#runner.search({
      view, me, macros, budgetMs, seed: Math.floor(this.#random() * 2 ** 32), weights: this.#weights,
      defaults: defaultMacros(state, me, macros, this.#fallback),
    });
    if (!result) return null; // superseded by a newer state
    if (thinking) this.emit('thinking', { active: true, candidates: result.ranked, iterations: result.iterations });
    const step = nextAction(state, me, result.best);
    if (!step) return this.#fallback.chooseAction(state);
    if (!step.done) this.#current = { macro: result.best, context };
    return step.action;
  }

  /**
   * While the opponent decides, search the position we'd face if they passed, so
   * the answer's ready (and on time) if they do.
   */
  #startPondering(state) {
    const opponent = actingPlayerId(state);
    const pass = state.validActions.find((a) => a.playerId === opponent && a.type === ACTION.PASS_PRIORITY);
    if (!pass) return;
    const future = this.#game.clone();
    future.applyTrusted(pass);
    const next = future.peekState();
    const me = this.#playerId;
    if (actingPlayerId(next) !== me || !worthSearching(next, me) || this.#isThinkingMoment(next)) return;
    const macros = listMacros(next, me);
    if (macros.length <= 1) return;
    const view = future.getPlayerView(me);
    this.#ponder = {
      key: viewKey(view),
      // No longer than an answer may take, so waiting for it never makes an answer late.
      result: this.#runner.search({
        view, me, macros, budgetMs: this.#responseMs * 0.8, seed: Math.floor(this.#random() * 2 ** 32),
        weights: this.#weights, defaults: defaultMacros(next, me, macros, this.#fallback),
      }),
    };
  }
}

/** The delay between the steps of one play, e.g. tapping lands and then casting. */
const STEP_MS = 200;

/** What a view says about the game, ignoring bookkeeping counters. */
function viewKey(view) {
  const { counters, ...rest } = view;
  return JSON.stringify(rest);
}
