/**
 * Runs MacroSearch for a time budget without blocking: in slices on the current
 * thread, or in a Web Worker (src/ai/aiWorker.js) when one is available. A new
 * request replaces any request still running, whose promise then resolves to null.
 *
 * A request is `{ view, me, macros, budgetMs, seed, defaults?, weights? }`: only what the
 * player is allowed to know (Game#getPlayerView), so nothing hidden ever reaches
 * the search.
 */
import { MacroSearch } from './search.js';
import { seededRandom } from '../engine/random.js';

/** The part of a search result worth sending around: the best macro and the top candidates. */
export function summarize(result) {
  return {
    best: result.best,
    iterations: result.iterations,
    ranked: result.ranked.slice(0, 6).map(({ macro, average, visits }) => ({ macro, average, visits })),
  };
}

/** Searches in slices of `sliceMs`, yielding between them. */
export async function searchInSlices(request, { isCurrent = () => true, sliceMs = 20, now = () => performance.now() } = {}) {
  const search = new MacroSearch(request.view, request.me, request.macros, {
    random: seededRandom(request.seed ?? 1), weights: request.weights, defaults: request.defaults, horizon: request.horizon,
  });
  const deadline = now() + request.budgetMs;
  while (now() < deadline) {
    if (!search.step()) break; // the race is decided
    search.runFor(Math.min(sliceMs, Math.max(1, deadline - now())), now);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!isCurrent()) return null;
  }
  return summarize(search.result());
}

/** Runs searches on the current thread, in slices. */
export class InlineSearchRunner {
  #latest = 0;

  search(request) {
    const id = ++this.#latest;
    return searchInSlices(request, { isCurrent: () => this.#latest === id });
  }

  dispose() {}
}

/** Runs searches in a module Web Worker. */
export class WorkerSearchRunner {
  #worker;
  #latest = 0;
  #pending = new Map();

  constructor(url = new URL('./aiWorker.js', import.meta.url)) {
    this.#worker = new Worker(url, { type: 'module' });
    this.#worker.onmessage = ({ data }) => {
      const resolve = this.#pending.get(data.id);
      this.#pending.delete(data.id);
      resolve?.(data.result);
    };
  }

  search(request) {
    const id = ++this.#latest;
    // Older requests are superseded.
    for (const [oldId, resolve] of this.#pending) {
      resolve(null);
      this.#pending.delete(oldId);
    }
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#worker.postMessage({ id, request });
    });
  }

  dispose() {
    this.#worker.terminate();
  }
}

/** A Worker runner in browsers that support module workers, otherwise inline. */
export function createSearchRunner() {
  if (typeof Worker !== 'undefined') {
    try {
      return new WorkerSearchRunner();
    } catch {
      // Module workers unsupported: fall through.
    }
  }
  return new InlineSearchRunner();
}
