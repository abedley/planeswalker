import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, CARD_TYPE, EFFECT, TARGET, ACTION, passPriority } from '../src/index.js';
import { SearchAIController } from '../src/ai/SearchAIController.js';

const players = [{ id: 'p1' }, { id: 'p2' }];
const CARDS = {
  Shock: {
    id: 'Shock', name: 'Shock', manaCost: {}, types: [CARD_TYPE.INSTANT],
    target: TARGET.ANY, effects: [{ type: EFFECT.DEAL_DAMAGE, amount: 2 }],
  },
};

/** A manual clock: setTimeout callbacks run only when the test advances time. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map();
  const delays = [];
  return {
    delays,
    timers: {
      now: () => now,
      setTimeout: (fn, ms) => {
        delays.push(Math.round(ms));
        pending.set(next, { at: now + ms, fn });
        return next++;
      },
      clearTimeout: (id) => pending.delete(id),
    },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        await new Promise((resolve) => setImmediate(resolve)); // let the AI's promises settle
        const due = [...pending].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
  };
}

/** A search runner that answers at once with its first candidate (passing), and counts searches. */
function instantRunner() {
  const runner = { searches: 0 };
  runner.search = async (request) => {
    runner.searches += 1;
    return { best: request.macros[0], ranked: [], iterations: 0 };
  };
  runner.dispose = () => {};
  return runner;
}

/** p2 is the search AI; p1 passes through the first two turns. Returns the AI's delays and searches. */
async function run(p2Hand) {
  const deck = (cards) => [...cards, ...Array(40 - cards.length).fill('forest')];
  const game = new Game({
    players, cards: CARDS, shuffleLibraries: false, emblems: { p1: [], p2: [] },
    decks: { p1: deck([]), p2: deck(p2Hand) },
  });
  const clock = fakeTimers();
  const runner = instantRunner();
  const ai = new SearchAIController({ game, playerId: 'p2', seed: 7, runner, timers: clock.timers, budgetMs: 1000, responseMs: 300, jitterMs: 200 });
  const thinking = [];
  ai.on('thinking', ({ active }) => { if (active) thinking.push(`${game.getState().turn}:${game.getState().segmentIndex}`); });
  game.start();
  for (let i = 0; i < 200 && game.getState().turn <= 2; i++) {
    const state = game.getState();
    const acting = state.pendingDecision?.playerId ?? state.priorityPlayerId;
    if (acting === 'p1') {
      game.dispatch(state.pendingDecision ? state.validActions.find((a) => a.playerId === 'p1' && a.type.startsWith('CONFIRM')) ?? state.validActions[0] : passPriority('p1'));
    } else {
      await clock.advance(5000);
    }
  }
  ai.detach();
  return { delays: clock.delays, searches: runner.searches, thinking: [...new Set(thinking)] };
}

test('the search AI\'s response times don\'t reveal whether it holds an instant', async () => {
  const withShock = await run(['Shock']);
  const without = await run([]);
  // With a free Shock in hand it searched at its priority windows; without, it didn't...
  assert.ok(withShock.searches > without.searches, `${withShock.searches} vs ${without.searches}`);
  // ...yet every answer came after exactly the same delays, and it was seen thinking at the same moments.
  assert.deepEqual(withShock.delays, without.delays);
  assert.deepEqual(withShock.thinking, without.thinking);
  assert.ok(withShock.thinking.length > 0);
  assert.ok(withShock.delays.length > 10);
  // Outside its acting windows it always passes, so it does so at once (passMs);
  // in its windows it takes at least responseMs.
  assert.ok(withShock.delays.some((ms) => ms === 60));
  assert.ok(withShock.delays.every((ms) => ms === 60 || ms >= 300), withShock.delays.join());
});
