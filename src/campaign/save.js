import { validateRun } from './campaign.js';

/**
 * Saving the run in progress between fights. `storage` is anything with
 * getItem/setItem/removeItem: `localStorage` in the browser, a stub in tests.
 */
export const SAVE_KEY = 'planeswalker.campaign.run';

export function saveRun(storage, run) {
  storage.setItem(SAVE_KEY, JSON.stringify(run));
}

/**
 * The saved run, or null when there's none, or it can't carry on: from another
 * version of the run format, unreadable, or referring to content that's gone.
 */
export function loadRun(storage, content) {
  const text = storage.getItem(SAVE_KEY);
  if (!text) return null;
  try {
    const run = JSON.parse(text);
    return validateRun(run, content).length === 0 ? run : null;
  } catch {
    return null;
  }
}

export function clearRun(storage) {
  storage.removeItem(SAVE_KEY);
}
