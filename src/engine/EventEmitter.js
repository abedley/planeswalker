/**
 * Minimal, dependency-free event emitter that works in both the browser and Node.
 *
 * Listeners registered with `onAny` receive every event as `(eventName, payload)`,
 * which is handy for logging and debugging tools.
 */
export class EventEmitter {
  #listeners = new Map();
  #anyListeners = new Set();

  on(eventName, listener) {
    if (!this.#listeners.has(eventName)) this.#listeners.set(eventName, new Set());
    this.#listeners.get(eventName).add(listener);
    return () => this.off(eventName, listener);
  }

  once(eventName, listener) {
    const wrapper = (payload) => {
      this.off(eventName, wrapper);
      listener(payload);
    };
    return this.on(eventName, wrapper);
  }

  off(eventName, listener) {
    this.#listeners.get(eventName)?.delete(listener);
  }

  onAny(listener) {
    this.#anyListeners.add(listener);
    return () => this.offAny(listener);
  }

  offAny(listener) {
    this.#anyListeners.delete(listener);
  }

  emit(eventName, payload) {
    // Copy before iterating so listeners can unsubscribe themselves safely.
    for (const listener of [...this.#anyListeners]) listener(eventName, payload);
    for (const listener of [...(this.#listeners.get(eventName) ?? [])]) listener(payload);
  }
}
