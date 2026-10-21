#!/usr/bin/env node
/**
 * Plays whole campaign runs headlessly, with an AI standing in for the human, to
 * check the ladder gets harder as it should and to balance content. Node-only.
 *
 *   node tools/campaign-sim.js [--runs N] [--walker id] [--deck id] [--player basic|search:b=150]
 *                              [--budget ms] [--seed S] [--workers N]
 *
 * The stand-in retries every lost fight and picks rewards by a simple rule:
 * a power if offered, else the first card. CPUs with the search AI think for at
 * most `--budget` ms per decision (default 100), so runs finish quickly; that
 * makes them weaker than in the browser, where they take their full budget.
 * Reports how far runs got, and the stand-in's win rate in each tier and against
 * each opponent.
 */
import { fileURLToPath } from 'node:url';
import {
  Game, GAME_STATUS, BasicAIController, CAMPAIGN, SAMPLE_CAMPAIGN, RUN_PHASE, REWARD, AI_KIND,
  startRun, matchSetup, recordResult, chooseReward, skipReward, retryFight, startingDecks,
} from '../src/index.js';
import { playout } from '../src/ai/simulate.js';
import { searchPolicy } from '../src/ai/search.js';
import { contestant } from './ai-arena.js';

const basicPolicy = (playerId) => {
  const ai = new BasicAIController({ game: null, playerId });
  return (state) => ai.chooseAction(state);
};

/** A policy for a campaign CPU (matchSetup(...).cpu), with its search capped at `budget` ms. */
function cpuPolicy(cpu, budget) {
  if (cpu.ai.kind === AI_KIND.BASIC) return basicPolicy(cpu.playerId);
  return searchPolicy(cpu.playerId, {
    algorithm: 'ismcts', budgetMs: Math.min(budget, cpu.ai.budgetMs ?? budget), weights: cpu.ai.weights,
  });
}

/** Plays the run's current fight; returns whether the stand-in won. */
function playFight(run, content, { player, budget }) {
  const { game: options, cpu } = matchSetup(run, content);
  const game = new Game({ ...options, silent: true });
  game.start();
  const policies = {
    player: player === 'basic' ? basicPolicy('player') : contestant(player)('player'),
    [cpu.playerId]: cpuPolicy(cpu, budget),
  };
  const final = playout(game, {
    player: (state) => policies.player(state, game),
    [cpu.playerId]: (state) => policies[cpu.playerId](state, game),
  }, { until: (state) => state.turn > 200 });
  return final.status === GAME_STATUS.GAME_OVER && final.winnerId === 'player';
}

/** Plays one whole run. Returns the final run. */
export function simulateRun({ content: given = CAMPAIGN, planeswalkerId, deckId, seed, player = 'basic', budget = 100 }) {
  // Workers get the content by name.
  const content = given === 'sample' ? SAMPLE_CAMPAIGN : given === 'real' ? CAMPAIGN : given;
  let run = startRun(content, { planeswalkerId, deckId, seed });
  while (run.phase !== RUN_PHASE.VICTORY && run.phase !== RUN_PHASE.OVER) {
    if (run.phase === RUN_PHASE.FIGHT) run = recordResult(run, content, { won: playFight(run, content, { player, budget }) });
    else if (run.phase === RUN_PHASE.DEFEATED) run = retryFight(run);
    else {
      const power = run.offers.findIndex((o) => o.kind === REWARD.POWER);
      const card = run.offers.findIndex((o) => o.kind === REWARD.CARD);
      const index = power !== -1 ? power : card;
      run = index === -1 ? skipReward(run, content) : chooseReward(run, content, index);
    }
  }
  return run;
}

/** Summarises finished runs: victories, furthest tiers, and win rates per tier and opponent. */
export function summarize(runs, content = CAMPAIGN) {
  const tiers = content.ladder.map((tier) => ({ id: tier.id, reached: 0, won: 0, lost: 0 }));
  const opponents = {};
  for (const run of runs) {
    const reached = new Set(run.history.map((h) => h.tierId));
    for (const tier of tiers) {
      if (reached.has(tier.id)) tier.reached += 1;
      for (const h of run.history.filter((x) => x.tierId === tier.id)) {
        if (h.result === 'skipped') continue;
        const key = h.result === 'won' ? 'won' : 'lost';
        tier[key] += 1;
        opponents[h.opponentId] ??= { won: 0, lost: 0 };
        opponents[h.opponentId][key] += 1;
      }
    }
  }
  return { runs: runs.length, victories: runs.filter((r) => r.phase === RUN_PHASE.VICTORY).length, tiers, opponents };
}

export function formatSummary({ runs, victories, tiers, opponents }) {
  const pct = (won, lost) => (won + lost ? `${((100 * won) / (won + lost)).toFixed(0)}%` : '-');
  const lines = [`${victories}/${runs} runs won`, 'tier          reached  fights won'];
  for (const t of tiers) lines.push(`  ${t.id.padEnd(12)} ${String(t.reached).padStart(5)}   ${pct(t.won, t.lost).padStart(4)} of ${t.won + t.lost}`);
  lines.push('opponent      fights won');
  for (const [id, o] of Object.entries(opponents)) lines.push(`  ${id.padEnd(12)} ${pct(o.won, o.lost).padStart(4)} of ${o.won + o.lost}`);
  return lines.join('\n');
}

async function runParallel(jobs, workers) {
  const { Worker } = await import('node:worker_threads');
  const runs = [];
  await Promise.all(Array.from({ length: workers }, (_, w) => new Promise((resolve, reject) => {
    const mine = jobs.filter((_, i) => i % workers === w);
    if (mine.length === 0) return resolve();
    const worker = new Worker(new URL(import.meta.url), { workerData: mine });
    worker.on('message', (run) => runs.push(run));
    worker.on('error', reject);
    worker.on('exit', resolve);
  })));
  return runs;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
  // --content sample plays the sample campaign (made-up cards).
  const contentName = option('content', 'real') === 'sample' ? 'sample' : 'real';
  const content = contentName === 'sample' ? SAMPLE_CAMPAIGN : CAMPAIGN;
  const planeswalkerId = option('walker', Object.keys(content.planeswalkers)[0]);
  const deckId = option('deck', startingDecks(content, planeswalkerId)[0]);
  const count = Number(option('runs', 10));
  const seed = Number(option('seed', 1));
  const workers = Number(option('workers', 1));
  const player = option('player', 'basic');
  const budget = Number(option('budget', 100));
  const jobs = Array.from({ length: count }, (_, i) => ({ content: contentName, planeswalkerId, deckId, seed: seed + i, player, budget }));
  console.log(`${count} runs: ${planeswalkerId} with ${deckId}, played by ${player}; CPU search capped at ${budget} ms`);
  const runs = workers > 1 ? await runParallel(jobs, workers) : jobs.map((job) => simulateRun(job));
  console.log(formatSummary(summarize(runs, content)));
}

const { isMainThread, parentPort, workerData } = await import('node:worker_threads');
if (!isMainThread && workerData) {
  for (const job of workerData) parentPort.postMessage(simulateRun(job));
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
