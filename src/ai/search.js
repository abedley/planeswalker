/**
 * Choosing among macro actions by simulation. Each candidate is played out in
 * games guessed from what the AI knows (determinize: the opponent's hand, every
 * library and future shuffles are random guesses), then the basic AI plays both
 * sides up to the AI's next turn, and evaluate() scores where that ends up.
 *
 * Two strategies:
 * - `greedy`: every candidate gets the same fixed number of simulations
 * - `ismcts`: candidates race until a time budget runs out (see MacroSearch),
 *   compared on the same sequence of guesses (common random numbers), which
 *   makes the differences between them much less noisy.
 *
 * The basic AI's own choice is the default: another candidate has to look better
 * by DEFAULT_MARGIN to replace it.
 */
import { Game } from '../engine/Game.js';
import { GAME_STATUS } from '../engine/Game.js';
import { seededRandom } from '../engine/random.js';
import { determinize } from './determinize.js';
import { listMacros, nextAction, applyMacro } from './macroActions.js';
import { evaluate, DEFAULT_WEIGHTS } from './evaluate.js';
import { playout, actingPlayerId } from './simulate.js';
import { BasicAIController, windowOf } from './BasicAIController.js';

/** Basic-AI policies for both players, for rollouts. */
function rolloutPolicies(view) {
  return Object.fromEntries(view.players.map(({ id }) => {
    const ai = new BasicAIController({ game: null, playerId: id });
    return [id, (state) => ai.chooseAction(state)];
  }));
}

/**
 * One simulation: a determinization of `view` with `macro` applied, played on to
 * the start of `me`'s next turn. Returns the evaluation, or null if the macro
 * couldn't be carried out in this guess.
 */
export function simulate(snapshot, me, macro, policies, { weights = DEFAULT_WEIGHTS, maxSteps = 5000, horizon = DEFAULT_HORIZON } = {}) {
  const game = Game.deserialize(snapshot, { silent: true });
  const startTurn = game.peekState().turn;
  if (!applyMacro(game, me, macro)) return null;
  // `horizon` 1: until the start of our next turn; 2: the one after that, and so on.
  let seen = 0;
  let lastTurn = startTurn;
  const final = playout(game, policies, {
    until: (state) => {
      if (state.turn !== lastTurn) {
        lastTurn = state.turn;
        if (state.activePlayerId === me) seen += 1;
      }
      return seen >= horizon;
    },
    maxSteps,
  });
  return evaluate(final, me, weights);
}

/** Every candidate simulated `determinizations` times on the same guesses; the best average wins. */
export function greedyChoice(view, me, macros, {
  determinizations = 3, random = Math.random, weights, defaults, margin, horizon,
} = {}) {
  const policies = rolloutPolicies(view);
  const totals = new Map(macros.map((m) => [m.key, { macro: m, total: 0, visits: 0, failed: 0 }]));
  for (let d = 0; d < determinizations; d++) {
    const snapshot = determinize(view, random);
    for (const macro of macros) {
      const score = simulate(snapshot, me, macro, policies, { weights, horizon });
      const entry = totals.get(macro.key);
      if (score === null) entry.failed += 1;
      else {
        entry.total += score;
        entry.visits += 1;
      }
    }
  }
  return rank(totals, { defaults, margin });
}

/**
 * An information-set Monte Carlo search over macro actions that can run in slices
 * (so a Web Worker can stay responsive): call runFor(ms) as often as you like, and
 * result() for the best candidate so far.
 *
 * It races the candidates: each round deals one new guess of the hidden cards and
 * simulates every remaining candidate on that same guess (common random numbers),
 * so candidates are compared pair by pair on identical situations. After a few
 * rounds, a candidate whose paired difference from the leader is clearly negative
 * (its mean plus two standard errors is below zero) drops out, and the time goes
 * to the close contenders.
 */
export class MacroSearch {
  #view;
  #me;
  #entries;
  #policies;
  #random;
  #weights;
  #defaults;
  #margin;
  #horizon;
  #round = -1;
  #guess = null;
  #queue = [];
  #finished = false;
  iterations = 0;

  constructor(view, me, macros, {
    random = Math.random, weights, defaults = [], margin = DEFAULT_MARGIN, horizon = DEFAULT_HORIZON,
  } = {}) {
    this.#view = view;
    this.#me = me;
    const preferred = new Set(defaults);
    // `bonus`: the default (the basic AI's choice) is preferred by the margin.
    this.#entries = macros.map((macro) => ({ macro, scores: [], dropped: false, bonus: preferred.has(macro.key) ? margin : 0 }));
    this.#policies = rolloutPolicies(view);
    this.#random = random;
    this.#weights = weights;
    this.#defaults = defaults;
    this.#margin = margin;
    this.#horizon = horizon;
  }

  /** Simulates for about `ms` milliseconds (at least one simulation, unless the race is over). */
  runFor(ms, now = () => performance.now()) {
    const deadline = now() + ms;
    do {
      if (!this.step()) break;
    } while (now() < deadline);
    return this;
  }

  /** One simulation. Returns false once there's nothing left to decide. */
  step() {
    if (this.#finished) return false;
    if (this.#queue.length === 0) {
      if (this.#round >= 0) this.#prune();
      const alive = this.#entries.filter((e) => !e.dropped);
      if (alive.length <= 1 || this.#round > 400) {
        this.#finished = true;
        return false;
      }
      this.#round += 1;
      this.#guess = determinize(this.#view, this.#random);
      this.#queue = [...alive];
    }
    const entry = this.#queue.shift();
    entry.scores[this.#round] = simulate(this.#guess, this.#me, entry.macro, this.#policies, {
      weights: this.#weights, horizon: this.#horizon,
    });
    this.iterations += 1;
    return true;
  }

  /** Drops candidates that are clearly worse than the leader, pair by pair. */
  #prune() {
    const alive = this.#entries.filter((e) => !e.dropped);
    const rounds = this.#round + 1;
    for (const e of alive) {
      // A candidate that can't be carried out in most guesses (its mana or target isn't there).
      const failed = e.scores.filter((x) => x === null).length;
      if (rounds >= 2 && failed > rounds / 2) e.dropped = true;
    }
    if (rounds < 3) return;
    const leader = this.#entries.filter((e) => !e.dropped).reduce((best, e) => (adjusted(e) > adjusted(best) ? e : best));
    for (const e of this.#entries) {
      if (e.dropped || e === leader) continue;
      const diffs = [];
      for (let r = 0; r < rounds; r++) {
        const a = e.scores[r];
        const b = leader.scores[r];
        if (typeof a === 'number' && typeof b === 'number') diffs.push(a + e.bonus - (b + leader.bonus));
      }
      if (diffs.length < 3) continue;
      const mean = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;
      const sd = Math.sqrt(diffs.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (diffs.length - 1));
      if (mean + (2 * sd) / Math.sqrt(diffs.length) < 0) e.dropped = true;
    }
  }

  result() {
    const stats = new Map(this.#entries.map((e) => {
      const scores = e.scores.filter((x) => typeof x === 'number');
      return [e.macro.key, {
        macro: e.macro,
        total: scores.reduce((sum, x) => sum + x, 0),
        visits: scores.length,
        failed: e.scores.filter((x) => x === null).length,
      }];
    }));
    return { ...rank(stats, { defaults: this.#defaults, margin: this.#margin }), iterations: this.iterations, rounds: this.#round + 1 };
  }
}

/** A candidate's mean score plus its default bonus. */
function adjusted(entry) {
  const scores = entry.scores.filter((x) => typeof x === 'number');
  return scores.length ? scores.reduce((sum, x) => sum + x, 0) / scores.length + entry.bonus : -Infinity;
}

/**
 * How far ahead simulations look: 2 means up to the start of our turn after next.
 * Arena tests found 2 clearly stronger than 1.
 */
export const DEFAULT_HORIZON = 2;

/** A MacroSearch run for `budgetMs`. */
export function ismctsChoice(view, me, macros, { budgetMs = 1000, now, ...options } = {}) {
  return new MacroSearch(view, me, macros, options).runFor(budgetMs, now).result();
}

/** Candidates sorted best first by average score, with the best one. */
function rank(stats, { defaults = [], margin = DEFAULT_MARGIN } = {}) {
  const preferred = new Set(defaults);
  const adjusted = (e) => e.average + (preferred.has(e.macro.key) ? margin : 0);
  const ranked = [...stats.values()]
    .map((e) => ({ macro: e.macro, average: e.visits ? e.total / e.visits : -Infinity, visits: e.visits, failed: e.failed }))
    .sort((a, b) => adjusted(b) - adjusted(a) || b.visits - a.visits);
  return { best: ranked[0].macro, ranked };
}

/**
 * How much better (in evaluation points) another choice must look than the basic
 * AI's own choice to be preferred: simulations are noisy, and the basic AI's
 * choice is a sound default.
 */
export const DEFAULT_MARGIN = 1;

/**
 * The keys of the macros that start with the basic AI's own choice here (the
 * defaults, see DEFAULT_MARGIN).
 */
export function defaultMacros(state, me, macros, fallback = new BasicAIController({ game: null, playerId: me })) {
  const choice = JSON.stringify(fallback.chooseAction(state));
  return macros.filter((m) => JSON.stringify(nextAction(state, me, m)?.action) === choice).map((m) => m.key);
}

/**
 * Whether a decision is worth searching: attack and block declarations, and the
 * moments the basic AI would consider acting in. Elsewhere the AI just passes.
 */
export function worthSearching(state, me) {
  if (actingPlayerId(state) !== me || state.status !== GAME_STATUS.IN_PROGRESS) return false;
  if (state.pendingDecision) return true;
  return windowOf(state, me) !== null;
}

/**
 * A policy `(state, game) => action` for `me` that searches at each decision worth
 * searching and plays the chosen macro out over the following actions. It only
 * ever looks at `game.getPlayerView(me)`.
 *
 * @param {object} options `{ algorithm: 'greedy' | 'ismcts', seed, determinizations, budgetMs, weights, onSearch }`
 */
export function searchPolicy(me, options = {}) {
  const fallback = new BasicAIController({ game: null, playerId: me });
  const random = seededRandom(options.seed ?? 1);
  let current = null;
  return (state, game) => {
    const context = `${state.turn}:${state.segmentIndex}:${state.pendingDecision?.type ?? 'priority'}`;
    if (current?.context === context) {
      const step = nextAction(state, me, current.macro);
      if (step) {
        if (step.done) current = null;
        return step.action;
      }
    }
    current = null;
    if (!worthSearching(state, me)) return fallback.chooseAction(state);
    const macros = listMacros(state, me);
    if (macros.length <= 1) return fallback.chooseAction(state);
    const view = game.getPlayerView(me);
    const defaults = defaultMacros(state, me, macros, fallback);
    const result = options.algorithm === 'ismcts'
      ? ismctsChoice(view, me, macros, { ...options, random, defaults })
      : greedyChoice(view, me, macros, { ...options, random, defaults });
    options.onSearch?.(result, state);
    const step = nextAction(state, me, result.best);
    if (!step) return fallback.chooseAction(state);
    if (!step.done) current = { macro: result.best, context };
    return step.action;
  };
}
