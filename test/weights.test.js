import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { weightsFor, DEFAULT_WEIGHTS, ARCHETYPE_WEIGHTS, seededRandom } from '../src/index.js';
import { FEATURES } from '../src/ai/evaluate.js';
import { fit, collectPositions, renderWeightsModule, readNotes, DECK_PULL } from '../tools/tune-ai.js';

test('weightsFor: a deck\'s own weights, an archetype\'s, or the defaults', () => {
  assert.equal(weightsFor(), DEFAULT_WEIGHTS);
  assert.equal(weightsFor('no such deck'), DEFAULT_WEIGHTS);
  assert.equal(weightsFor('aggro'), ARCHETYPE_WEIGHTS.aggro);
  assert.ok(ARCHETYPE_WEIGHTS.aggro.clock > DEFAULT_WEIGHTS.clock);
  assert.ok(ARCHETYPE_WEIGHTS.control.hand > DEFAULT_WEIGHTS.hand);
  // An object fills in what it doesn't say from the defaults.
  assert.deepEqual(weightsFor({ hand: 5 }), { ...DEFAULT_WEIGHTS, hand: 5 });
});

test('a deck\'s fit is pulled back towards its starting weights', () => {
  // Results that are pure coin flips: an unanchored fit would wander off; an anchored one keeps
  // its proportions (only the ratios to the creatures weight are kept, see tune-ai.js).
  const random = seededRandom(5);
  const positions = Array.from({ length: 300 }, () => ({
    x: FEATURES.map(() => (random() - 0.5) * 4), y: random() < 0.5 ? 1 : 0,
  }));
  const prior = FEATURES.map((_, i) => 0.3 + 0.1 * i);
  const c = FEATURES.indexOf('creatures');
  // How far a fit's proportions are from the prior's, on average.
  const drift = (w) => FEATURES.reduce((sum, _, i) => sum + Math.abs((w[i] / w[c]) / (prior[i] / prior[c]) - 1), 0) / FEATURES.length;
  const anchored = drift(fit(positions, prior, { steps: 800, l2: DECK_PULL, prior }));
  const free = drift(fit(positions, prior, { steps: 800 }));
  assert.ok(anchored < 0.25, `anchored drift ${anchored.toFixed(2)}`);
  assert.ok(anchored < free / 2, `anchored ${anchored.toFixed(2)} vs free ${free.toFixed(2)}`);
});

test('per-deck positions are seen from that deck\'s side, against every deck', () => {
  const positions = collectPositions({ games: 2, deck: 'effects', decks: ['effects', 'keywords'] });
  assert.ok(positions.length > 20);
  assert.ok(positions.every(({ x, y }) => x.length === FEATURES.length && [0, 0.5, 1].includes(y)));
});

test('the generated weights module keeps the general weights and each deck\'s', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'planeswalker-weights-'));
  try {
    const path = join(dir, 'weights.js');
    const tuned = { ...DEFAULT_WEIGHTS };
    const aggro = { ...ARCHETYPE_WEIGHTS.aggro, life: 9 };
    await writeFile(path, renderWeightsModule({
      tuned, tunedNote: 'test', decks: { goblins: { weights: aggro, note: 'Tuned for goblins.' } },
    }));
    const module = await import(pathToFileURL(path).href);
    // Rewriting the file keeps its notes.
    const source = renderWeightsModule({ tuned, tunedNote: 'test', decks: { goblins: { weights: aggro, note: 'Tuned for goblins.' } } });
    assert.deepEqual(readNotes(source), { tuned: 'test', decks: { goblins: 'Tuned for goblins.' } });
    assert.deepEqual(module.TUNED_WEIGHTS, tuned);
    assert.deepEqual(module.DECK_WEIGHTS, { goblins: aggro });
    assert.ok(Object.isFrozen(module.DECK_WEIGHTS.goblins));
  } finally {
    await rm(dir, { recursive: true });
  }
});
