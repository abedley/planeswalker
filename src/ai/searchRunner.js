/**
 * Runs searches without blocking: in a Web Worker (src/ai/aiWorker.js) when one is
 * available, otherwise in slices on the current thread. Both keep their searches
 * by position (searchPool.js), so pondered work carries on into real decisions.
 *
 * - `search(request)`: a promise of the result, or null if a newer request replaced it.
 * - `ponder(targets)`: requests to search ahead while nothing else is asked.
 *
 * Requests hold only what the player is allowed to know (Game#getPlayerView), so
 * nothing hidden ever reaches the search.
 */
import { SearchScheduler } from './searchPool.js';

export { summarize } from './searchPool.js';

/** Runs searches on the current thread, in slices. */
export class InlineSearchRunner {
  #scheduler;
  #latest = 0;
  #pending = new Map();

  constructor(options = {}) {
    this.#scheduler = new SearchScheduler({
      ...options,
      onResult: (id, result) => {
        this.#pending.get(id)?.(result);
        this.#pending.delete(id);
      },
    });
  }

  search(request) {
    const id = ++this.#latest;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#scheduler.search(id, request);
    });
  }

  ponder(targets) {
    this.#scheduler.ponder(targets);
  }

  dispose() {
    this.#scheduler.dispose();
    for (const resolve of this.#pending.values()) resolve(null);
    this.#pending.clear();
  }
}

/** Runs searches in a module Web Worker. */
export class WorkerSearchRunner {
  #worker;
  #latest = 0;
  #pending = new Map();

  constructor(url = new URL('./aiWorker.js', import.meta.url)) {
    this.#worker = new Worker(url, { type: 'module' });
    this.#worker.onmessage = ({ data }) => {
      this.#pending.get(data.id)?.(data.result);
      this.#pending.delete(data.id);
    };
  }

  search(request) {
    const id = ++this.#latest;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#worker.postMessage({ type: 'search', id, request });
    });
  }

  ponder(targets) {
    this.#worker.postMessage({ type: 'ponder', targets });
  }

  dispose() {
    this.#worker.terminate();
    for (const resolve of this.#pending.values()) resolve(null);
    this.#pending.clear();
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
