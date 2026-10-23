import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runArena, wilson, playGame, DECKS } from '../tools/ai-arena.js';

test('the Wilson interval brackets the observed rate', () => {
  const [low, high] = wilson(60, 100);
  assert.ok(low < 0.6 && high > 0.6 && low > 0.49 && high < 0.7);
  assert.deepEqual(wilson(0, 0), [0, 1]);
});

test('identical AIs split a seat-swapped match evenly', () => {
  const { totals, winRate } = runArena({ a: 'basic', b: 'basic', games: 2, decks: ['effects'] });
  assert.equal(totals.games, 4);
  assert.equal(winRate, 0.5);
});

test('a real AI beats one that never does anything', () => {
  const { totals } = runArena({ a: 'basic', b: 'passive', games: 2, decks: ['keywords'] });
  assert.equal(totals.aWins, 4);
});

test('a game reports its winner seat, turns and decision times', () => {
  const result = playGame({ seats: { p1: 'basic', p2: 'basic' }, seed: 3, ...DECKS.triggers });
  assert.ok(['p1', 'p2'].includes(result.winnerId));
  assert.ok(result.turns > 0 && result.decisions.p1 > 0 && result.time.p1 >= 0);
});

test('the basic AI can block by a blocking plan', () => {
  const { totals } = runArena({ a: 'basic:blocks=optimal', b: 'basic:blocks=creatures', games: 1, decks: ['keywords', 'green'] });
  assert.equal(totals.games, 4);
  assert.throws(() => playGame({ seats: { p1: 'basic:blocks=nonsense', p2: 'basic' }, seed: 1, ...DECKS.keywords }), /Unknown block plan/);
});

test('the basic AI can block and predict blocks the old, greedy way', () => {
  const { totals } = runArena({ a: 'basic', b: 'basic:blocks=greedy,predict=greedy', games: 1, decks: ['white'] });
  assert.equal(totals.games, 2);
  assert.throws(() => playGame({ seats: { p1: 'basic:speed=9', p2: 'basic' }, seed: 1, ...DECKS.white }), /Unknown basic AI setting/);
});
