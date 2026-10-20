#!/usr/bin/env node
/**
 * Fits the search AI's evaluation weights to game results ("Texel tuning"):
 * plays many fast basic-AI games on every sample deck, records each position at
 * the start of a turn with who went on to win (in games decided by life totals),
 * and fits the weights of
 * evaluate()'s features by logistic regression, so that the evaluation predicts
 * the winner as well as it can. Writes src/ai/weights.js. Node-only.
 *
 *   node tools/tune-ai.js [--games N] [--dry-run]
 *
 * The weights are scaled so creatures keep weight 1: evaluations stay in the same
 * "points" as creatureValue, which the search's margin is expressed in.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Game, GAME_STATUS, BasicAIController } from '../src/index.js';
import { playout } from '../src/ai/simulate.js';
import { features, FEATURES, HAND_WEIGHTS } from '../src/ai/evaluate.js';
import { DECKS } from './ai-arena.js';

const OUTPUT = fileURLToPath(new URL('../src/ai/weights.js', import.meta.url));

/** Positions `{ x: number[], y: 0 | 0.5 | 1 }` from basic-AI games: the active player's features at each turn start. */
export function collectPositions({ games = 100, decks = Object.keys(DECKS) } = {}) {
  const positions = [];
  const players = [{ id: 'p1' }, { id: 'p2' }];
  for (const name of decks) {
    const { deck, cards } = DECKS[name];
    for (let seed = 1; seed <= games; seed++) {
      const game = new Game({ players, seed: 1000 + seed, cards, decks: { p1: deck, p2: deck }, silent: true });
      game.start();
      const policies = Object.fromEntries(players.map(({ id }) => {
        const ai = new BasicAIController({ game: null, playerId: id });
        return [id, (state) => ai.chooseAction(state)];
      }));
      const samples = [];
      let turn = 0;
      const final = playout(game, policies, {
        until: (state) => {
          if (state.turn !== turn) {
            turn = state.turn;
            samples.push({ me: state.activePlayerId, x: FEATURES.map((f) => features(state, state.activePlayerId)[f]) });
          }
          return state.turn > 200;
        },
      });
      // Only games decided by life totals: games that end by decking out are decided by who
      // drew first, which would teach the evaluation that holding more cards loses.
      if (final.status !== GAME_STATUS.GAME_OVER || !final.players.some((p) => p.life <= 0)) continue;
      for (const { me, x } of samples) {
        positions.push({ x, y: final.winnerId === null ? 0.5 : final.winnerId === me ? 1 : 0 });
      }
    }
  }
  return positions;
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const dot = (w, x) => w.reduce((sum, wi, i) => sum + wi * x[i], 0);

/** Mean log loss of weights `w` (in logit units) on positions. */
export function logLoss(w, positions) {
  let loss = 0;
  for (const { x, y } of positions) {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(dot(w, x))));
    loss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
  }
  return loss / positions.length;
}

/** Logistic regression by gradient descent (with a little L2), from `start`. */
export function fit(positions, start, { steps = 3000, rate = 0.05, l2 = 1e-4 } = {}) {
  const w = [...start];
  // Normalise feature scales so one learning rate suits all.
  const scale = FEATURES.map((_, i) => Math.max(1e-6, Math.sqrt(positions.reduce((s, { x }) => s + x[i] ** 2, 0) / positions.length)));
  let v = w.map((wi, i) => wi * scale[i]);
  for (let step = 0; step < steps; step++) {
    const grad = v.map(() => 0);
    for (const { x, y } of positions) {
      const xs = x.map((xi, i) => xi / scale[i]);
      const error = sigmoid(dot(v, xs)) - y;
      for (let i = 0; i < v.length; i++) grad[i] += error * xs[i];
    }
    v = v.map((vi, i) => vi - rate * (grad[i] / positions.length + l2 * vi));
  }
  return v.map((vi, i) => vi / scale[i]);
}

/** The best single scale factor for fixed weights (how hand weights map to logits). */
function bestScale(weights, positions) {
  let best = 0.01;
  for (let k = 0.002; k <= 0.5; k *= 1.1) {
    if (logLoss(weights.map((w) => w * k), positions) < logLoss(weights.map((w) => w * best), positions)) best = k;
  }
  return best;
}

async function main() {
  const args = process.argv.slice(2);
  const games = Number(args[args.indexOf('--games') + 1] || 60);
  const dryRun = args.includes('--dry-run');
  const started = performance.now();
  const positions = collectPositions({ games: args.includes('--games') ? games : 60 });
  console.log(`${positions.length} positions in ${((performance.now() - started) / 1000).toFixed(1)}s`);

  // Hold out a fifth of the positions to check the fit generalises.
  const test = positions.filter((_, i) => i % 5 === 0);
  const train = positions.filter((_, i) => i % 5 !== 0);
  const hand = FEATURES.map((f) => HAND_WEIGHTS[f]);
  const k = bestScale(hand, train);
  const start = hand.map((w) => w * k);
  const fitted = fit(train, start);
  console.log(`log loss on held-out positions: hand-picked ${logLoss(start, test).toFixed(4)}, fitted ${logLoss(fitted, test).toFixed(4)}`);

  // Back to points: creatures keep weight 1.
  const unit = fitted[FEATURES.indexOf('creatures')];
  if (!(unit > 0)) throw new Error(`Creatures got a non-positive weight (${unit}); not writing weights.`);
  const weights = Object.fromEntries(FEATURES.map((f, i) => [f, Number((fitted[i] / unit).toFixed(3))]));
  console.log('hand-picked:', HAND_WEIGHTS);
  console.log('fitted:     ', weights);
  if (dryRun) return;
  await writeFile(OUTPUT, `/**
 * Evaluation weights fitted by tools/tune-ai.js (${positions.length} positions from basic-AI games).
 * Generated: don't edit by hand.
 */
export const TUNED_WEIGHTS = Object.freeze(${JSON.stringify(weights, null, 2).replace(/"(\w+)":/g, '$1:')});
`);
  console.log(`Wrote ${OUTPUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
