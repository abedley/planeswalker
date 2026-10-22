/**
 * Searches kept by position, so no work is thrown away. A search for a position
 * the AI pondered, or met before, carries on from where it got to instead of
 * starting over. Used by the search worker (aiWorker.js) and the inline runner
 * (searchRunner.js).
 *
 * A request is `{ key, view, me, macros, budgetMs, seed, defaults?, weights?, horizon? }`,
 * where `key` names the position (the same view gives the same key, see
 * SearchAIController) and `view` is only what the player may know.
 */
import { MacroSearch } from './search.js';
import { seededRandom } from '../engine/random.js';

/** The part of a search result worth sending around: the best macro and the top candidates. */
export function summarize(result) {
  return {
    best: result.best,
    iterations: result.iterations,
    rounds: result.rounds,
    ranked: result.ranked.slice(0, 6).map(({ macro, average, visits }) => ({ macro, average, visits })),
  };
}

/** Searches by key, least recently used dropped first; plus the positions to ponder. */
export class SearchPool {
  #entries = new Map();
  #ponder = [];
  #limit;

  constructor({ limit = 16 } = {}) {
    this.#limit = limit;
  }

  /** The search for `request.key`, started if new. */
  #entry(request) {
    let entry = this.#entries.get(request.key);
    if (entry) {
      // Most recently used last.
      this.#entries.delete(request.key);
      this.#entries.set(request.key, entry);
      return entry;
    }
    entry = {
      search: new MacroSearch(request.view, request.me, request.macros, {
        random: seededRandom(request.seed ?? 1), weights: request.weights, defaults: request.defaults, horizon: request.horizon,
      }),
      spentMs: 0,
    };
    this.#entries.set(request.key, entry);
    const pondered = new Set(this.#ponder.map((t) => t.key));
    for (const key of this.#entries.keys()) {
      if (this.#entries.size <= this.#limit) break;
      if (key !== request.key && !pondered.has(key)) this.#entries.delete(key);
    }
    return entry;
  }

  has(key) { return this.#entries.has(key); }

  /** Milliseconds of search `key` has had so far. */
  spent(key) { return this.#entries.get(key)?.spentMs ?? 0; }

  /** Whether `request` needs no more work: its race is decided, or it has had its budget. */
  ready(request) {
    const entry = this.#entries.get(request.key);
    return Boolean(entry && (entry.search.finished || entry.spentMs >= request.budgetMs));
  }

  /** Searches `request` for about `ms`. Returns whether it could use more. */
  work(request, ms, now) {
    const entry = this.#entry(request);
    if (entry.search.finished) return false;
    const started = now();
    entry.search.runFor(ms, now);
    entry.spentMs += now() - started;
    return !entry.search.finished;
  }

  result(key) {
    const entry = this.#entries.get(key);
    return { ...summarize(entry.search.result()), spentMs: Math.round(entry.spentMs) };
  }

  /**
   * Positions to search while nothing else is asked, nearest first: each is a
   * request whose `budgetMs` caps how long it's pondered. Replaces the last list;
   * searches already made for these positions are kept.
   */
  setPonder(targets) {
    this.#ponder = targets;
  }

  /**
   * One slice of pondering, on the target that most needs it (nearer targets get
   * more of the time). Returns false when every target is decided or at its cap.
   */
  ponderSlice(ms, now) {
    let best = null;
    let bestCost = Infinity;
    this.#ponder.forEach((target, i) => {
      if (this.ready(target)) return;
      const cost = this.spent(target.key) * (i + 1);
      if (cost < bestCost) {
        best = target;
        bestCost = cost;
      }
    });
    if (!best) return false;
    this.work(best, ms, now);
    return true;
  }
}

/**
 * Runs one search at a time, in slices, and ponders between them. `search(id, request)`
 * replaces the running search (whose result is reported as null): it runs until
 * it's ready (see SearchPool#ready) or `budgetMs` has passed, then calls
 * `onResult(id, result)`.
 */
export class SearchScheduler {
  #pool;
  #onResult;
  #sliceMs;
  #now;
  #defer;
  #job = null;
  #running = false;
  #disposed = false;

  constructor({
    onResult, pool = new SearchPool(), sliceMs = 15, now = () => performance.now(), defer = (fn) => setTimeout(fn, 0),
  }) {
    this.#pool = pool;
    this.#onResult = onResult;
    this.#sliceMs = sliceMs;
    this.#now = now;
    this.#defer = defer;
  }

  get pool() { return this.#pool; }

  search(id, request) {
    if (this.#job) this.#onResult(this.#job.id, null);
    this.#job = { id, request, started: this.#now() };
    this.#kick();
  }

  ponder(targets) {
    this.#pool.setPonder(targets);
    this.#kick();
  }

  dispose() {
    this.#disposed = true;
    this.#job = null;
  }

  #kick() {
    if (this.#running || this.#disposed) return;
    this.#running = true;
    this.#defer(() => this.#loop());
  }

  #loop() {
    if (this.#disposed) return;
    const now = this.#now;
    const job = this.#job;
    if (job) {
      const { request } = job;
      if (!this.#pool.has(request.key) || (!this.#pool.ready(request) && now() - job.started < request.budgetMs)) {
        this.#pool.work(request, Math.min(this.#sliceMs, Math.max(1, job.started + request.budgetMs - now())), now);
      }
      if (this.#pool.ready(request) || now() - job.started >= request.budgetMs) {
        this.#job = null;
        this.#onResult(job.id, this.#pool.result(request.key));
      }
    } else if (!this.#pool.ponderSlice(this.#sliceMs, now)) {
      this.#running = false;
      return;
    }
    this.#defer(() => this.#loop());
  }
}
