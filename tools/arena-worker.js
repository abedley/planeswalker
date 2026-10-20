/** A worker thread for tools/ai-arena.js --workers: plays its share of the jobs. */
import { parentPort, workerData } from 'node:worker_threads';
import { playJob } from './ai-arena.js';

for (const job of workerData) parentPort.postMessage(playJob(job));
