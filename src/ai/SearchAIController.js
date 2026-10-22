import { EventEmitter } from '../engine/EventEmitter.js';
import { DECISION } from '../engine/Game.js';
import { PHASE } from '../engine/turnStructure.js';
import { seededRandom } from '../engine/random.js';
import { BasicAIController } from './BasicAIController.js';
import { listMacros, nextAction } from './macroActions.js';
import { worthSearching, defaultMacros } from './search.js';
import { actingPlayerId } from './simulate.js';
import { createSearchRunner } from './searchRunner.js';
import { weightsFor } from './evaluate.js';
import { ponderTargets } from './ponder.js';

/**
 * A computer player that searches (see search.js): it simulates its options in
 * games guessed from what it knows, using a Web Worker so the page stays
 * responsive.
 *
 * It never wastes the player's time, or its own work:
 * - **Quick passes where it never acts.** Outside its acting windows (BasicAIController's
 *   windowOf: its main phases, combat after blocks, being attacked, the opponent's
 *   end step, an opponent's spell on the stack), it always passes, so it does so
 *   after `passMs`. The windows depend only on public information.
 * - **Searches are kept by position** (searchPool.js): a position it pondered, or
 *   met before, carries on from where its search got to, and a search stops as
 *   soon as its race is decided or it has had its budget.
 * - **Pondering.** Whenever it isn't deciding, it searches its next few decisions
 *   on the likeliest line (ponder.js): the opponent passing, or confirming the
 *   attackers or blocks picked so far, and its own play carrying on. So while the
 *   player takes their turn, it's already thinking about its blocks and its next
 *   main phase.
 *
 * And it gives little away:
 * - **Uniform timing in its windows.** There it answers after `responseMs` plus
 *   random jitter (up to `jitterMs`), whether it passes or acts and whether or not
 *   it holds anything it could act with.
 * - **Visible thinking only at public moments:** its own main phase and its own
 *   attack and block declarations, which come every turn whatever its hand. Then
 *   it searches for up to `budgetMs`, showing `thinking` events
 *   (`{ active, candidates? }`) for at least `minThinkMs` (or the budget, if less).
 * - It only ever sends the search game.getPlayerView(playerId).
 *
 * Options: `weights` (the deck's evaluation weights: a deck or archetype name, or
 * weights, see weightsFor), `budgetMs` (thinking time, default 2000), `minThinkMs`
 * (default 600), `responseMs` (default 400), `jitterMs` (default 200), `passMs`
 * (default 60), `seed`, `runner` (a search runner, see searchRunner.js), `timers`
 * (`{ setTimeout, clearTimeout, now }`, for tests).
 */
export class SearchAIController extends EventEmitter {
  #game;
  #playerId;
  #budgetMs;
  #minThinkMs;
  #responseMs;
  #jitterMs;
  #passMs;
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
  #timer = null;
  #ponderTimer = null;
  #turnOf = 0;
  #detached = false;

  constructor({
    game, playerId, weights, budgetMs = 2000, minThinkMs = 600, responseMs = 400, jitterMs = 200, passMs = 60,
    seed = Math.floor(Math.random() * 2 ** 32), runner = createSearchRunner(), timers = {
      setTimeout: (...args) => setTimeout(...args),
      clearTimeout: (id) => clearTimeout(id),
      now: () => performance.now(),
    },
  }) {
    super();
    this.#game = game;
    this.#playerId = playerId;
    this.#budgetMs = budgetMs;
    this.#minThinkMs = minThinkMs;
    this.#responseMs = responseMs;
    this.#jitterMs = jitterMs;
    this.#passMs = passMs;
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
    this.#detached = true;
    this.#timers.clearTimeout(this.#timer);
    clearTimeout(this.#ponderTimer);
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
      this.#ponder();
      return;
    }
    const started = this.#timers.now();
    const context = `${state.turn}:${state.segmentIndex}:${state.pendingDecision?.type ?? 'priority'}`;
    // Carrying on with a macro (tapping mana for a spell, toggling attackers, ...)
    // right after our own visible action: a short fixed step.
    const step = this.#current?.context === context ? nextAction(state, me, this.#current.macro) : null;
    if (step) {
      if (step.done) this.#current = null;
      this.#act(turn, step.action, STEP_MS);
      this.#ponder(this.#current?.macro);
      return;
    }
    this.#current = null;
    // Outside our windows we always pass (windowOf is public), so there's nothing to hide.
    if (!worthSearching(state, me)) {
      this.#act(turn, this.#fallback.chooseAction(state), this.#passMs);
      return;
    }
    const thinking = this.#isThinkingMoment(state);
    // The delay, and whether we're seen thinking, are decided from public information
    // only, before looking at anything private.
    const delay = thinking ? Math.min(this.#minThinkMs, this.#budgetMs) : this.#responseMs + this.#jitter() * this.#jitterMs;
    if (thinking) this.emit('thinking', { active: true });
    const action = await this.#decide(state, context, thinking ? this.#budgetMs : this.#responseMs * 0.8, thinking);
    if (turn !== this.#turnOf || !action) return;
    this.#act(turn, action, Math.max(0, started + delay - this.#timers.now()), thinking);
  }

  /** Emits `action` after `wait` ms, unless the game has moved on by then. */
  #act(turn, action, wait, thinking = false) {
    this.#timer = this.#timers.setTimeout(() => {
      if (turn !== this.#turnOf) return;
      if (thinking) this.emit('thinking', { active: false });
      this.emit('action', action);
    }, wait);
  }

  async #decide(state, context, budgetMs, thinking) {
    const me = this.#playerId;
    const macros = listMacros(state, me);
    if (macros.length <= 1) return this.#fallback.chooseAction(state);

    const view = this.#game.getPlayerView(me);
    const result = await this.#runner.search({
      key: viewKey(view), view, me, macros, budgetMs, seed: Math.floor(this.#random() * 2 ** 32), weights: this.#weights,
      defaults: defaultMacros(state, me, macros, this.#fallback),
    });
    if (!result) return null; // superseded by a newer state
    if (thinking) this.emit('thinking', { active: true, candidates: result.ranked, iterations: result.iterations });
    const step = nextAction(state, me, result.best);
    if (!step) return this.#fallback.chooseAction(state);
    if (!step.done) this.#current = { macro: result.best, context };
    // Think ahead from here, carrying on with this play.
    this.#ponder(result.best);
    return step.action;
  }

  /**
   * Searches our next few decisions on the likeliest line (ponder.js) in the
   * background. Worked out on a copy of the game, a moment later, for the latest
   * state only, so it never holds up the current one.
   */
  #ponder(macro = null) {
    if (!this.#runner.ponder) return;
    clearTimeout(this.#ponderTimer);
    const version = this.#game.peekState().version;
    this.#ponderTimer = setTimeout(() => {
      if (this.#detached || this.#game.peekState().version !== version) return;
      const me = this.#playerId;
      const targets = ponderTargets(this.#game.clone(), me, { macro, limit: PONDER_TARGETS, skipCurrent: Boolean(macro) });
      this.#runner.ponder(targets.map(({ view, macros, defaults }) => ({
        key: viewKey(view), view, me, macros, defaults, weights: this.#weights,
        seed: Math.floor(this.#random() * 2 ** 32),
        // Pondering is free time: every position gets up to a full thinking budget.
        budgetMs: this.#budgetMs,
      })));
    }, PONDER_DELAY_MS);
  }
}

/** The delay between the steps of one play, e.g. tapping lands and then casting. */
const STEP_MS = 150;

/** How many decisions ahead to ponder. */
const PONDER_TARGETS = 3;

/** How long the game must stay put before pondering starts (it changes many times a second while things resolve). */
const PONDER_DELAY_MS = 40;

/**
 * A short name for what a view says about the game (ignoring bookkeeping
 * counters): a 53-bit hash of it, so equal views get equal keys.
 */
export function viewKey(view) {
  const { counters, ...rest } = view;
  const text = JSON.stringify(rest);
  // cyrb53
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
