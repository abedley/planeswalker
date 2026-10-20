import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fit, logLoss } from '../tools/tune-ai.js';
import { FEATURES } from '../src/ai/evaluate.js';
import { seededRandom } from '../src/index.js';

test('the logistic fit recovers the weights that generated the results', () => {
  const random = seededRandom(3);
  const truth = FEATURES.map((_, i) => (i % 2 ? 0.5 : -0.3));
  const positions = Array.from({ length: 3000 }, () => {
    const x = FEATURES.map(() => (random() - 0.5) * 6);
    const p = 1 / (1 + Math.exp(-truth.reduce((s, w, i) => s + w * x[i], 0)));
    return { x, y: random() < p ? 1 : 0 };
  });
  const fitted = fit(positions, FEATURES.map(() => 0), { steps: 1500, rate: 0.5 });
  fitted.forEach((w, i) => assert.ok(Math.abs(w - truth[i]) < 0.12, `${FEATURES[i]}: ${w} vs ${truth[i]}`));
  assert.ok(logLoss(fitted, positions) < logLoss(FEATURES.map(() => 0), positions));
});
