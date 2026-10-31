#!/usr/bin/env node
/**
 * Plays AIs against each other to measure their strength. Node-only; the site
 * never loads it.
 *
 *   node tools/ai-arena.js <ai> <ai> [--games N] [--decks standard,effects,...] [--seed S] [--workers N]
 *   node tools/ai-arena.js basic legacy --games 100
 *
 * Every deck is played as a mirror match. Each seed is played twice with the seats
 * swapped (same shuffles), so neither AI benefits from luck or from going first.
 * The report gives each deck's results and the overall win rate of the first AI,
 * with a 95% confidence interval.
 */
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  Game, GAME_STATUS, BasicAIController, AI_STRATEGY, DEFAULT_DECK,
  SAMPLE_CARDS, SAMPLE_DECK, SAMPLE_PERMANENTS, SAMPLE_PERMANENTS_DECK, SAMPLE_SPELLS, SAMPLE_SPELLS_DECK,
  SAMPLE_EFFECTS, SAMPLE_EFFECTS_DECK, SAMPLE_TRIGGERS, SAMPLE_TRIGGERS_DECK, REAL_DECKS, LTR_DECKS,
} from '../src/index.js';
import { playout } from '../src/ai/simulate.js';
import { LegacyAIController } from '../src/ai/LegacyAIController.js';
import { searchPolicy } from '../src/ai/search.js';
import { HAND_WEIGHTS } from '../src/ai/evaluate.js';

export const DECKS = {
  standard: { deck: DEFAULT_DECK, cards: {} },
  keywords: { deck: SAMPLE_DECK, cards: SAMPLE_CARDS },
  permanents: { deck: SAMPLE_PERMANENTS_DECK, cards: SAMPLE_PERMANENTS },
  spells: { deck: SAMPLE_SPELLS_DECK, cards: SAMPLE_SPELLS },
  effects: { deck: SAMPLE_EFFECTS_DECK, cards: SAMPLE_EFFECTS },
  triggers: { deck: SAMPLE_TRIGGERS_DECK, cards: SAMPLE_TRIGGERS },
  // Real cards (imported from Scryfall), one deck per color.
  white: { deck: REAL_DECKS.whiteWeenie, cards: {} },
  blue: { deck: REAL_DECKS.blueSkies, cards: {} },
  black: { deck: REAL_DECKS.blackRemoval, cards: {} },
  red: { deck: REAL_DECKS.redBurn, cards: {} },
  green: { deck: REAL_DECKS.greenStompy, cards: {} },
  // The Lord of the Rings: Tales of Middle-earth.
  fellowship: { deck: LTR_DECKS.fellowship, cards: {} },
  mordor: { deck: LTR_DECKS.mordor, cards: {} },
};

/**
 * The AIs the arena knows, by name. Each makes a policy for one seat:
 * `(state, game) => action`, where `state` is game.peekState(). A policy may use
 * only what its player could know (`game.getPlayerView(playerId)`).
 */
export const CONTESTANTS = {
  basic: (playerId) => basicPolicy(playerId, AI_STRATEGY.BASIC),
  legacy: (playerId) => {
    const ai = new LegacyAIController({ game: null, playerId });
    return (state) => ai.chooseAction(state);
  },
  passive: (playerId) => basicPolicy(playerId, AI_STRATEGY.PASSIVE),
  'basic-noswarm': (playerId) => {
    const ai = new BasicAIController({ game: null, playerId, swarm: false });
    return (state) => ai.chooseAction(state);
  },
  greedy: (playerId) => searchPolicy(playerId, { algorithm: 'greedy', determinizations: 8 }),
  search: (playerId) => searchPolicy(playerId, { algorithm: 'ismcts', budgetMs: 150 }),
};

/**
 * A contestant by name, with optional search settings after a colon:
 * `greedy:d=8,h=2` (determinizations, horizon in turns), `search:b=150,h=2,m=1,w=hand`
 * (budget in ms, horizon, margin over the basic AI's choice, evaluation weights:
 * `hand`, `@file.json`, an archetype such as `aggro`, or a deck name with tuned weights).
 */
export function contestant(name) {
  const [base, settings = ''] = name.split(':');
  if (!settings) return CONTESTANTS[base];
  // basic:h=attrition+danger: the basic AI with those heuristics on (see planAttack, planBlocks).
  // basic:blocks=greedy,predict=greedy: how it blocks, and how it expects blocks when
  // it attacks (see chooseBlocks: greedy, or a plan of blockingPlans).
  // basic:attack=lookahead,think=50: it attacks by planLookaheadAttack (thinking up to 50 ms);
  // look=2: looking 2 of its turns ahead; quick=0: with exact blocks in its playouts.
  if (base === 'basic') {
    const options = { heuristics: {} };
    for (const part of settings.split(',')) {
      const [key, value] = part.includes('=') ? part.split('=') : ['h', part];
      if (key === 'blocks') options.blocking = value;
      else if (key === 'predict') options.predictBlocking = value;
      else if (key === 'attack') options.attacking = value;
      else if (key === 'think') options.attackBudgetMs = Number(value);
      else if (key === 'look') options.attackTurns = Number(value);
      else if (key === 'quick') options.attackQuick = value !== '0';
      // mull=0: keeps every opening hand (see mulligan.js).
      else if (key === 'mull') options.mulligans = value !== '0';
      else if (key === 'h') {
        // name@value sets a heuristic's strength, e.g. danger@6.
        for (const h of value.split('+').filter(Boolean)) {
          const [name, strength] = h.split('@');
          options.heuristics[name] = strength === undefined ? true : Number(strength);
        }
      } else throw new Error(`Unknown basic AI setting "${key}"`);
    }
    return (playerId) => {
      const ai = new BasicAIController({ game: null, playerId, ...options });
      return (state) => ai.chooseAction(state);
    };
  }
  const keys = {
    d: 'determinizations', b: 'budgetMs', h: 'horizon', m: 'margin', hp: 'heuristicPlans', e: 'evaluation', rb: 'rootBeam',
    // rn=0.1: noise in the rollouts (see rolloutPolicies); inf=1: guesses weighed by what the opponent did (see determinize).
    rn: 'rolloutNoise', inf: 'inference',
  };
  // la=<depth>, bw=<beam>: pruned lookahead (see lookahead.js).
  const pairs = Object.fromEntries(settings.split(',').map((pair) => pair.split('=')));
  // bo=0: the opponent doesn't branch (the basic AI's choice stands for theirs).
  const lookahead = pairs.la ? { depth: Number(pairs.la), beam: Number(pairs.bw ?? 2), branchOpponent: pairs.bo !== '0' } : null;
  const options = Object.fromEntries(settings.split(',').filter((pair) => !/^(la|bw|bo)=/.test(pair)).map((pair) => {
    const [key, value] = pair.split('=');
    // w=hand: the hand-picked evaluation weights; w=@file.json: weights from a file
    // (e.g. a candidate fit); w=<deck or archetype>: see weightsFor.
    if (key === 'w') {
      if (value === 'hand') return ['weights', HAND_WEIGHTS];
      if (value.startsWith('@')) return ['weights', JSON.parse(readFileSync(value.slice(1), 'utf8'))];
      return ['weights', value];
    }
    // at=lookahead: how it attacks (see searchPolicy).
    if (key === 'at') return ['attacking', value];
    // e=tiered: the evaluation (see evaluateTiered); the rest are numbers.
    return [keys[key] ?? key, key === 'e' ? value : Number(value)];
  }));
  const algorithm = { greedy: 'greedy', search: 'ismcts' }[base];
  if (!algorithm) return undefined;
  return (playerId) => searchPolicy(playerId, { algorithm, determinizations: 8, budgetMs: 150, ...options, ...(lookahead ? { lookahead } : {}) });
}

function basicPolicy(playerId, strategy) {
  const ai = new BasicAIController({ game: null, playerId, strategy });
  return (state) => ai.chooseAction(state);
}

/** Wilson score interval for a proportion (95%). */
export function wilson(wins, n, z = 1.96) {
  if (n === 0) return [0, 1];
  const p = wins / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const margin = (z / (1 + (z * z) / n)) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [centre - margin, centre + margin];
}

/**
 * Plays one game. `seats` maps player ids to contestant names. Returns the winner's
 * seat id (or null for a draw), the number of turns, and the time each seat spent
 * deciding.
 */
export function playGame({ seats, deck, cards, seed, contestants = CONTESTANTS, maxTurns = 200, mulligans = false }) {
  const players = [{ id: 'p1' }, { id: 'p2' }];
  const game = new Game({ players, seed, cards, decks: { p1: deck, p2: deck }, silent: true, mulligans });
  game.start();
  const time = { p1: 0, p2: 0 };
  const decisions = { p1: 0, p2: 0 };
  const policies = Object.fromEntries(players.map(({ id }) => {
    const policy = (contestants[seats[id]] ?? contestant(seats[id]))(id);
    return [id, (state) => {
      const started = performance.now();
      const action = policy(state, game);
      time[id] += performance.now() - started;
      decisions[id] += 1;
      return action;
    }];
  }));
  const final = playout(game, policies, { until: (state) => state.turn > maxTurns });
  return {
    winnerId: final.status === GAME_STATUS.GAME_OVER ? final.winnerId : null,
    turns: final.turn,
    time,
    decisions,
  };
}

/** The games of a match: `games` seeds per deck, each twice with the seats swapped. */
export function arenaJobs({ a, b, games = 20, decks = Object.keys(DECKS), seed = 1, mulligans = false }) {
  return decks.flatMap((deck) => Array.from({ length: games }, (_, i) => [false, true].map((swap) => ({
    deck, seed: seed + i, seats: swap ? { p1: b, p2: a } : { p1: a, p2: b }, swap, mulligans,
  }))).flat());
}

/** Plays one job from arenaJobs(). */
export function playJob(job, contestants = CONTESTANTS) {
  const { deck, cards } = DECKS[job.deck];
  return { job, result: playGame({ seats: job.seats, deck, cards, seed: job.seed, contestants, mulligans: job.mulligans }) };
}

/** Tallies played jobs into per-deck rows, totals, the first AI's win rate and its 95% interval. */
export function tally({ a, b }, played) {
  const rows = new Map();
  for (const { job, result } of played) {
    if (!rows.has(job.deck)) rows.set(job.deck, { deck: job.deck, aWins: 0, bWins: 0, draws: 0, turns: 0, games: 0, time: {}, decisions: {} });
    const row = rows.get(job.deck);
    const winner = result.winnerId ? job.seats[result.winnerId] : null;
    if (winner === null) row.draws += 1;
    // Mirror matches of the same AI count seat p1 as "a".
    else if (a === b ? result.winnerId === (job.swap ? 'p2' : 'p1') : winner === a) row.aWins += 1;
    else row.bWins += 1;
    row.turns += result.turns;
    row.games += 1;
    for (const id of ['p1', 'p2']) {
      const name = job.seats[id];
      row.time[name] = (row.time[name] ?? 0) + result.time[id];
      row.decisions[name] = (row.decisions[name] ?? 0) + result.decisions[id];
    }
  }
  const results = [...rows.values()].map(({ time, decisions, ...row }) => ({
    ...row,
    msPerDecision: Object.fromEntries(Object.keys(time).map((name) => [name, time[name] / Math.max(1, decisions[name])])),
  }));
  const totals = results.reduce((t, r) => ({
    aWins: t.aWins + r.aWins, bWins: t.bWins + r.bWins, draws: t.draws + r.draws, games: t.games + r.games,
  }), { aWins: 0, bWins: 0, draws: 0, games: 0 });
  // Draws count as half a win each.
  const score = totals.aWins + totals.draws / 2;
  return { results, totals, winRate: score / totals.games, interval: wilson(score, totals.games) };
}

/** Plays a whole match on this thread. */
export function runArena({ a, b, games = 20, decks, seed = 1, mulligans = false, contestants = CONTESTANTS, onGame }) {
  const played = [];
  for (const job of arenaJobs({ a, b, games, decks, seed, mulligans })) {
    played.push(playJob(job, contestants));
    onGame?.(job.deck, played.length);
  }
  return tally({ a, b }, played);
}

/** Plays a whole match on `workers` threads. */
export async function runArenaParallel({ a, b, games = 20, decks, seed = 1, mulligans = false, workers = 4, onGame }) {
  const { Worker } = await import('node:worker_threads');
  const jobs = arenaJobs({ a, b, games, decks, seed, mulligans });
  const played = [];
  await Promise.all(Array.from({ length: workers }, (_, w) => new Promise((resolve, reject) => {
    const mine = jobs.filter((_, i) => i % workers === w);
    if (mine.length === 0) return resolve();
    const worker = new Worker(new URL('./arena-worker.js', import.meta.url), { workerData: mine });
    worker.on('message', (entry) => {
      played.push(entry);
      onGame?.(entry.job.deck, played.length);
    });
    worker.on('error', reject);
    worker.on('exit', resolve);
  })));
  return tally({ a, b }, played);
}

export function formatReport({ a, b }, { results, totals, winRate, interval }) {
  const pct = (x) => `${(100 * x).toFixed(1)}%`;
  const lines = [`${a} vs ${b}`];
  for (const r of results) {
    const time = (ms) => (ms < 1 ? `${Math.round(ms * 1000)}µs` : `${ms.toFixed(1)}ms`);
    const ms = Object.entries(r.msPerDecision).map(([name, t]) => `${name} ${time(t)}`).join(', ');
    lines.push(`  ${r.deck.padEnd(11)} ${String(r.aWins).padStart(4)} - ${String(r.bWins).padEnd(4)}`
      + `${r.draws ? ` (${r.draws} draws)` : ''}  ${(r.turns / r.games).toFixed(1)} turns/game  ${ms}/decision`);
  }
  lines.push(`  overall     ${totals.aWins} - ${totals.bWins}${totals.draws ? ` (${totals.draws} draws)` : ''}: `
    + `${a} wins ${pct(winRate)} (95% CI ${pct(interval[0])}–${pct(interval[1])})`);
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const [, value] = args.splice(index, 2);
    return value;
  };
  const games = Number(option('games', 20));
  const workers = Number(option('workers', 1));
  const decks = option('decks', Object.keys(DECKS).join(',')).split(',');
  const seed = Number(option('seed', 1));
  // --mulligans 1: players may mulligan (see Game's `mulligans`).
  const mulligans = option('mulligans', '0') !== '0';
  const [a = 'basic', b = 'legacy'] = args;
  for (const name of [a, b]) {
    if (!contestant(name)) {
      console.error(`Unknown AI "${name}". Known: ${Object.keys(CONTESTANTS).join(', ')}`);
      process.exit(2);
    }
  }
  for (const name of decks) {
    if (!DECKS[name]) {
      console.error(`Unknown deck "${name}". Known: ${Object.keys(DECKS).join(', ')}`);
      process.exit(2);
    }
  }
  const total = games * 2 * decks.length;
  const onGame = process.stderr.isTTY ? (deck, done) => process.stderr.write(`\r${done}/${total} games   `) : null;
  const report = workers > 1
    ? await runArenaParallel({ a, b, games, decks, seed, mulligans, workers, onGame })
    : runArena({ a, b, games, decks, seed, mulligans, onGame });
  if (process.stderr.isTTY) process.stderr.write('\r');
  console.log(formatReport({ a, b }, report));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
