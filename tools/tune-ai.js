#!/usr/bin/env node
/**
 * Fits the search AI's evaluation weights to game results ("Texel tuning"):
 * plays many fast basic-AI games, records each position at the start of a turn
 * with who went on to win (in games decided by life totals), and fits the weights
 * of evaluate()'s features by logistic regression, so that the evaluation
 * predicts the winner as well as it can. Writes src/ai/weights.js. Node-only.
 *
 *   node tools/tune-ai.js [--games N] [--dry-run]
 *     General weights, from mirror matches of every deck in tools/ai-arena.js.
 *   node tools/tune-ai.js --deck <name> [--from <archetype|deck>] [--games N] [--dry-run]
 *     Weights for one CPU deck (DECK_WEIGHTS[name]), from its games against every
 *     deck, seen from its side. This is a light touch on purpose: the fit starts
 *     from the general weights (or `--from`'s) and is pulled back towards them,
 *     so a deck's weights only move as far as its games clearly show.
 *
 * The weights are scaled so creatures keep weight 1: evaluations stay in the same
 * "points" as creatureValue, which the search's margin is expressed in.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Game, GAME_STATUS, BasicAIController } from '../src/index.js';
import { playout } from '../src/ai/simulate.js';
import { features, FEATURES, HAND_WEIGHTS, weightsFor } from '../src/ai/evaluate.js';
import { DECKS } from './ai-arena.js';

const OUTPUT = fileURLToPath(new URL('../src/ai/weights.js', import.meta.url));

/**
 * Positions `{ x: number[], y: 0 | 0.5 | 1 }` from basic-AI games, at each turn
 * start. Without `deck`: mirror matches of every deck, from the active player's
 * side. With `deck`: that deck against every deck (seats alternating), from its side.
 */
export function collectPositions({ games = 100, decks = Object.keys(DECKS), deck: tuned } = {}) {
  const positions = [];
  const players = [{ id: 'p1' }, { id: 'p2' }];
  const matchups = tuned ? decks.map((other) => [tuned, other]) : decks.map((name) => [name, name]);
  for (const [name, otherName] of matchups) {
    const ours = DECKS[name];
    const theirs = DECKS[otherName];
    for (let seed = 1; seed <= games; seed++) {
      // With a tuned deck, it sits in p1 on odd seeds and p2 on even ones.
      const side = tuned ? (seed % 2 ? 'p1' : 'p2') : null;
      const other = side === 'p2' ? 'p1' : 'p2';
      const game = new Game({
        players,
        seed: 1000 + seed,
        cards: { ...ours.cards, ...theirs.cards },
        decks: side ? { [side]: ours.deck, [other]: theirs.deck } : { p1: ours.deck, p2: ours.deck },
        silent: true,
      });
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
            const me = side ?? state.activePlayerId;
            const values = features(state, me);
            samples.push({ me, x: FEATURES.map((f) => values[f]) });
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

/**
 * Logistic regression by gradient descent from `start`, with an L2 pull of
 * strength `l2` towards `prior` (default: towards zero).
 */
export function fit(positions, start, { steps = 3000, rate = 0.05, l2 = 1e-4, prior = null } = {}) {
  const w = [...start];
  // Normalise feature scales so one learning rate suits all.
  const scale = FEATURES.map((_, i) => Math.max(1e-6, Math.sqrt(positions.reduce((s, { x }) => s + x[i] ** 2, 0) / positions.length)));
  let v = w.map((wi, i) => wi * scale[i]);
  const anchor = (prior ?? w.map(() => 0)).map((pi, i) => pi * scale[i]);
  for (let step = 0; step < steps; step++) {
    const grad = v.map(() => 0);
    for (const { x, y } of positions) {
      const xs = x.map((xi, i) => xi / scale[i]);
      const error = sigmoid(dot(v, xs)) - y;
      for (let i = 0; i < v.length; i++) grad[i] += error * xs[i];
    }
    v = v.map((vi, i) => vi - rate * (grad[i] / positions.length + l2 * (vi - anchor[i])));
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

/**
 * How strongly a deck's weights are pulled back to their starting point: they move
 * only as far as the deck's games clearly show (the decks are examples for now).
 */
export const DECK_PULL = 0.3;

/** The notes in an existing weights module, so rewriting it keeps them. */
export function readNotes(source) {
  const tuned = /\/\*\* General weights \((.*)\)\. \*\//.exec(source)?.[1] ?? null;
  const decks = Object.fromEntries([...source.matchAll(/\/\*\* (.*) \*\/\n {2}"([^"]+)":/g)].map(([, note, name]) => [name, note]));
  return { tuned, decks };
}

/** The source of src/ai/weights.js. `decks`: `{ name: { weights, note } }`. */
export function renderWeightsModule({ tuned, tunedNote, decks }) {
  const literal = (weights, indent = '') => JSON.stringify(weights, null, 2)
    .replace(/"(\w+)":/g, '$1:').replace(/\n/g, `\n${indent}`);
  const entries = Object.entries(decks).map(([name, { weights, note }]) => (
    `  /** ${note} */\n  ${JSON.stringify(name)}: Object.freeze(${literal(weights, '  ')}),\n`)).join('');
  return `/**
 * Evaluation weights fitted by tools/tune-ai.js.
 * Generated: don't edit by hand (run \`npm run tune-ai\`, or \`npm run tune-ai -- --deck <name>\`).
 */

/** General weights (${tunedNote}). */
export const TUNED_WEIGHTS = Object.freeze(${literal(tuned)});

/** Weights for particular decks, by deck name. */
export const DECK_WEIGHTS = Object.freeze({${entries ? `\n${entries}` : ''}});
`;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
  const deck = option('deck', null);
  const from = option('from', null);
  const dryRun = args.includes('--dry-run');
  if (deck && !DECKS[deck]) {
    throw new Error(`Unknown deck "${deck}". Add it to DECKS in tools/ai-arena.js. Known: ${Object.keys(DECKS).join(', ')}`);
  }
  const games = Number(option('games', deck ? 30 : 60));

  const started = performance.now();
  const positions = collectPositions({ games, deck });
  console.log(`${positions.length} positions in ${((performance.now() - started) / 1000).toFixed(1)}s`);

  // Hold out a fifth of the positions to check the fit generalises.
  const test = positions.filter((_, i) => i % 5 === 0);
  const train = positions.filter((_, i) => i % 5 !== 0);
  // A deck starts from (and is pulled back towards) the general weights or `--from`'s;
  // the general fit starts from the hand-picked ones.
  const base = deck ? weightsFor(from) : HAND_WEIGHTS;
  const baseVector = FEATURES.map((f) => base[f]);
  const k = bestScale(baseVector, train);
  const start = baseVector.map((w) => w * k);
  const fitted = deck ? fit(train, start, { steps: 800, l2: DECK_PULL, prior: start }) : fit(train, start);
  console.log(`log loss on held-out positions: starting weights ${logLoss(start, test).toFixed(4)}, fitted ${logLoss(fitted, test).toFixed(4)}`);

  // Back to points: creatures keep weight 1.
  const unit = fitted[FEATURES.indexOf('creatures')];
  if (!(unit > 0)) throw new Error(`Creatures got a non-positive weight (${unit}); not writing weights.`);
  const weights = Object.fromEntries(FEATURES.map((f, i) => [f, Number((fitted[i] / unit).toFixed(3))]));
  console.log('starting:', { ...base });
  console.log('fitted:  ', weights);
  if (dryRun) return;

  const current = await import(`${pathToFileURL(OUTPUT).href}?${Date.now()}`);
  const notes = readNotes(await readFile(OUTPUT, 'utf8'));
  const decks = Object.fromEntries(Object.entries(current.DECK_WEIGHTS)
    .map(([name, w]) => [name, { weights: w, note: notes.decks[name] ?? `Tuned for ${name}.` }]));
  const note = `${positions.length} positions from basic-AI games`;
  if (deck) decks[deck] = { weights, note: `Tuned for ${deck}${from ? ` from ${from}` : ''} (${note}).` };
  await writeFile(OUTPUT, renderWeightsModule({
    tuned: deck ? current.TUNED_WEIGHTS : weights,
    tunedNote: deck ? notes.tuned ?? 'fitted earlier' : `${note} on every sample deck`,
    decks,
  }));
  console.log(`Wrote ${deck ? `DECK_WEIGHTS.${deck} to ` : ''}${OUTPUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
