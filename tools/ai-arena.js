#!/usr/bin/env node
/**
 * Plays AIs against each other to measure their strength. Node-only; the site
 * never loads it.
 *
 *   node tools/ai-arena.js <ai> <ai> [--games N] [--decks standard,effects,...] [--seed S]
 *   node tools/ai-arena.js basic legacy --games 100
 *
 * Every deck is played as a mirror match. Each seed is played twice with the seats
 * swapped (same shuffles), so neither AI benefits from luck or from going first.
 * The report gives each deck's results and the overall win rate of the first AI,
 * with a 95% confidence interval.
 */
import { fileURLToPath } from 'node:url';
import {
  Game, GAME_STATUS, BasicAIController, AI_STRATEGY, DEFAULT_DECK,
  SAMPLE_CARDS, SAMPLE_DECK, SAMPLE_PERMANENTS, SAMPLE_PERMANENTS_DECK, SAMPLE_SPELLS, SAMPLE_SPELLS_DECK,
  SAMPLE_EFFECTS, SAMPLE_EFFECTS_DECK, SAMPLE_TRIGGERS, SAMPLE_TRIGGERS_DECK,
} from '../src/index.js';
import { playout } from '../src/ai/simulate.js';

export const DECKS = {
  standard: { deck: DEFAULT_DECK, cards: {} },
  keywords: { deck: SAMPLE_DECK, cards: SAMPLE_CARDS },
  permanents: { deck: SAMPLE_PERMANENTS_DECK, cards: SAMPLE_PERMANENTS },
  spells: { deck: SAMPLE_SPELLS_DECK, cards: SAMPLE_SPELLS },
  effects: { deck: SAMPLE_EFFECTS_DECK, cards: SAMPLE_EFFECTS },
  triggers: { deck: SAMPLE_TRIGGERS_DECK, cards: SAMPLE_TRIGGERS },
};

/**
 * The AIs the arena knows, by name. Each makes a policy for one seat:
 * `(state, game) => action`, where `state` is game.peekState(). A policy may use
 * only what its player could know (`game.getPlayerView(playerId)`).
 */
export const CONTESTANTS = {
  basic: (playerId) => basicPolicy(playerId, AI_STRATEGY.BASIC),
  legacy: (playerId) => basicPolicy(playerId, AI_STRATEGY.BASIC), // the same as basic until it improves
  passive: (playerId) => basicPolicy(playerId, AI_STRATEGY.PASSIVE),
};

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
export function playGame({ seats, deck, cards, seed, contestants = CONTESTANTS, maxTurns = 200 }) {
  const players = [{ id: 'p1' }, { id: 'p2' }];
  const game = new Game({ players, seed, cards, decks: { p1: deck, p2: deck }, silent: true });
  game.start();
  const time = { p1: 0, p2: 0 };
  const decisions = { p1: 0, p2: 0 };
  const policies = Object.fromEntries(players.map(({ id }) => {
    const policy = contestants[seats[id]](id);
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

/** Plays `games` seeds per deck, each twice with the seats swapped. */
export function runArena({ a, b, games = 20, decks = Object.keys(DECKS), seed = 1, contestants = CONTESTANTS, onGame }) {
  const results = [];
  for (const deckName of decks) {
    const { deck, cards } = DECKS[deckName];
    const row = { deck: deckName, aWins: 0, bWins: 0, draws: 0, turns: 0, games: 0 };
    const time = { [a]: 0, [b]: 0 };
    const decisions = { [a]: 0, [b]: 0 };
    for (let i = 0; i < games; i++) {
      for (const swap of [false, true]) {
        const seats = swap ? { p1: b, p2: a } : { p1: a, p2: b };
        const result = playGame({ seats, deck, cards, seed: seed + i, contestants });
        const winner = result.winnerId ? seats[result.winnerId] : null;
        if (winner === null) row.draws += 1;
        // Mirror matches of the same AI count seat p1 as "a".
        else if (a === b ? result.winnerId === (swap ? 'p2' : 'p1') : winner === a) row.aWins += 1;
        else row.bWins += 1;
        row.turns += result.turns;
        row.games += 1;
        for (const id of ['p1', 'p2']) {
          time[seats[id]] += result.time[id];
          decisions[seats[id]] += result.decisions[id];
        }
        onGame?.(deckName, row);
      }
    }
    row.msPerDecision = Object.fromEntries(Object.keys(time).map((name) => [name, time[name] / Math.max(1, decisions[name])]));
    results.push(row);
  }
  const totals = results.reduce((t, r) => ({
    aWins: t.aWins + r.aWins, bWins: t.bWins + r.bWins, draws: t.draws + r.draws, games: t.games + r.games,
  }), { aWins: 0, bWins: 0, draws: 0, games: 0 });
  // Draws count as half a win each.
  const score = totals.aWins + totals.draws / 2;
  return { results, totals, winRate: score / totals.games, interval: wilson(score, totals.games) };
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

function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const [, value] = args.splice(index, 2);
    return value;
  };
  const games = Number(option('games', 20));
  const decks = option('decks', Object.keys(DECKS).join(',')).split(',');
  const seed = Number(option('seed', 1));
  const [a = 'basic', b = 'legacy'] = args;
  for (const name of [a, b]) {
    if (!CONTESTANTS[name]) {
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
  const report = runArena({
    a, b, games, decks, seed,
    onGame: process.stderr.isTTY ? (deck, row) => process.stderr.write(`\r${deck} ${row.games}/${games * 2}   `) : null,
  });
  if (process.stderr.isTTY) process.stderr.write('\r');
  console.log(formatReport({ a, b }, report));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
