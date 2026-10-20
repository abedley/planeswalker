/**
 * Web Worker entry for the search AI (see searchRunner.js). Receives
 * `{ id, request }`, replies `{ id, result }`. A newer request makes the worker
 * drop the one it's working on (replying null for it).
 */
import { searchInSlices } from './searchRunner.js';

let latest = 0;

self.onmessage = async ({ data }) => {
  latest = data.id;
  const result = await searchInSlices(data.request, { isCurrent: () => latest === data.id });
  self.postMessage({ id: data.id, result });
};
