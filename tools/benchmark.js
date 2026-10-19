#!/usr/bin/env node
/**
 * Measures how fast the engine plays silent games, which bounds how much an AI
 * search can simulate in its time budget.
 *
 *   node tools/benchmark.js [games]
 */
import {
  Game, BasicAIController, SAMPLE_EFFECTS, SAMPLE_EFFECTS_DECK, SAMPLE_TRIGGERS, SAMPLE_TRIGGERS_DECK, DEFAULT_DECK,
} from '../src/index.js';
import { playout } from '../src/ai/simulate.js';

const games = Number(process.argv[2] ?? 200);
const players = [{ id: 'p1' }, { id: 'p2' }];
const decks = {
  standard: [DEFAULT_DECK, {}],
  effects: [SAMPLE_EFFECTS_DECK, SAMPLE_EFFECTS],
  triggers: [SAMPLE_TRIGGERS_DECK, SAMPLE_TRIGGERS],
};

for (const [name, [deck, cards]] of Object.entries(decks)) {
  const policies = Object.fromEntries(players.map(({ id }) => {
    const ai = new BasicAIController({ game: null, playerId: id });
    return [id, (state) => ai.chooseAction(state)];
  }));
  let actions = 0;
  let turns = 0;
  const started = performance.now();
  for (let seed = 1; seed <= games; seed++) {
    const game = new Game({ players, seed, cards, decks: { p1: deck, p2: deck }, silent: true });
    game.start();
    const counted = Object.fromEntries(Object.entries(policies).map(([id, policy]) => [id, (s) => { actions += 1; return policy(s); }]));
    turns += playout(game, counted).turn;
  }
  const seconds = (performance.now() - started) / 1000;
  console.log(`${name.padEnd(9)} ${(games / seconds).toFixed(1).padStart(7)} games/s  `
    + `${Math.round(actions / seconds).toString().padStart(7)} actions/s  ${(turns / games).toFixed(1)} turns/game`);
}

// Cloning cost, which every search iteration pays once.
const game = new Game({ players, seed: 1, cards: SAMPLE_EFFECTS, decks: { p1: SAMPLE_EFFECTS_DECK, p2: SAMPLE_EFFECTS_DECK } });
game.start();
const clones = 2000;
const started = performance.now();
for (let i = 0; i < clones; i++) game.clone();
console.log(`clone     ${((performance.now() - started) * 1000 / clones).toFixed(0)} µs each`);
