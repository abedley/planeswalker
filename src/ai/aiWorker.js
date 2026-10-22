/**
 * Web Worker entry for the search AI (see searchRunner.js). Receives
 * `{ type: 'search', id, request }`, replying `{ id, result }` (null when a newer
 * search replaced it), and `{ type: 'ponder', targets }`, positions to search
 * ahead in the meantime. Searches are kept by position (searchPool.js).
 */
import { SearchScheduler } from './searchPool.js';

const scheduler = new SearchScheduler({ onResult: (id, result) => self.postMessage({ id, result }) });

self.onmessage = ({ data }) => {
  if (data.type === 'ponder') scheduler.ponder(data.targets);
  else scheduler.search(data.id, data.request);
};
