import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, ACTION, CHOICE, SAMPLE_SPELLS, SAMPLE_EFFECTS, passPriority, playLand, DECISION, PHASE, STEP, CARD_TYPE, TARGET, EFFECT, KEYWORD,
} from '../src/index.js';
import {
  playOptions, variantsFor, secondTargets, perform, sameAction, nextChoice, narrow, interchangeableTargets,
} from '../app/battle/play.js';
import { shouldAutoPass, primaryAction, blockHint } from '../app/battle/autopass.js';
import { promptFor } from '../app/battle/describe.js';
import { PlayHistory } from '../app/battle/history.js';

const players = [{ id: 'p1' }, { id: 'p2' }];
const cards = { ...SAMPLE_SPELLS, ...SAMPLE_EFFECTS };

/** p1 in their first main phase with `hand` (and Forests behind it). */
function setup(hand, { emblems = { p1: [], p2: [] } } = {}) {
  const deck = [...hand, ...Array(40 - hand.length).fill('forest')];
  const game = new Game({ players, cards, shuffleLibraries: false, emblems, decks: { p1: deck, p2: deck } });
  game.start();
  for (let i = 0; i < 2; i++) game.dispatch(passPriority(game.getState().priorityPlayerId));
  return game;
}

const state = (game) => game.getState();
const handCard = (game, cardId) => state(game).players[0].hand.find((c) => c.cardId === cardId);

/** Plays a Forest (from the hand) and passes turns until p1 has `lands` Forests in its main phase. */
function withForests(game, lands) {
  for (let played = 0; played < lands; played++) {
    if (played > 0) {
      // Pass to p1's next main phase.
      for (let i = 0; i < 60 && !(state(game).activePlayerId === 'p1' && state(game).phase === PHASE.PRECOMBAT_MAIN && state(game).turn > 1 + 2 * (played - 1)); i++) {
        const s = state(game);
        const actor = s.pendingDecision?.playerId ?? s.priorityPlayerId;
        const confirm = s.validActions.find((a) => a.playerId === actor && [ACTION.CONFIRM_ATTACKERS, ACTION.CONFIRM_BLOCKERS, ACTION.DISCARD].includes(a.type));
        game.dispatch(confirm ?? passPriority(actor));
      }
    }
    assert.deepEqual(game.dispatch(playLand('p1', handCard(game, 'forest').id)), { ok: true });
  }
  return game;
}

test('playOptions finds spells payable by tapping lands, without tapping anything', () => {
  const game = withForests(setup(['sampleShock', 'sampleInsight', 'forest', 'forest']), 1);
  const before = JSON.stringify(state(game));
  const options = playOptions(game, 'p1');
  assert.equal(JSON.stringify(state(game)), before, 'the dry run left the game alone');
  const shock = options.find((o) => o.sourceId === handCard(game, 'sampleShock').id);
  assert.ok(shock, 'Shock is castable with one Forest');
  assert.deepEqual(shock.targets.sort(), ['p1', 'p2']);
  // Insight costs two mana: not yet.
  assert.ok(!options.some((o) => o.sourceId === handCard(game, 'sampleInsight').id));
  // Another Forest in hand can't be played (one land per turn).
  assert.ok(!options.some((o) => o.kind === 'land'));

  const [variant] = variantsFor(shock, 'p2');
  assert.deepEqual(perform(game, 'p1', shock, variant), { ok: true });
  const s = state(game);
  assert.equal(s.stack.at(-1).card.cardId, 'sampleShock');
  assert.deepEqual(s.stack.at(-1).targets, ['p2']);
  assert.ok(s.battlefield.find((p) => p.cardId === 'forest').tapped);
});

test('lands and emblem abilities are options', () => {
  const game = setup(['forest', 'sampleOffering'], { emblems: { p1: ['planeswalker'], p2: [] } });
  const options = playOptions(game, 'p1');
  assert.ok(options.some((o) => o.kind === 'land'));
  const emblem = options.find((o) => o.kind === 'activate');
  assert.equal(emblem.abilityId, 'gainLife');
  assert.deepEqual(emblem.targets, []);
  assert.equal(variantsFor(emblem).length, 1);
  // Offering needs a creature to sacrifice.
  assert.ok(!options.some((o) => o.sourceId === handCard(game, 'sampleOffering').id));
});

test('an additional cost with several choices gives one variant per choice', () => {
  const game = withForests(setup(['sampleSprout', 'sampleOffering', 'forest', 'forest', 'forest']), 3);
  const sprout = playOptions(game, 'p1').find((o) => o.sourceId === handCard(game, 'sampleSprout').id);
  assert.deepEqual(perform(game, 'p1', sprout, variantsFor(sprout)[0]), { ok: true });
  for (let i = 0; i < 2; i++) game.dispatch(passPriority(state(game).priorityPlayerId));
  assert.equal(state(game).battlefield.filter((p) => p.name.includes('Saproling')).length, 2);
  const offering = playOptions(game, 'p1').find((o) => o.sourceId === handCard(game, 'sampleOffering').id);
  const variants = variantsFor(offering);
  assert.equal(variants.length, 2);
  assert.notDeepEqual(variants[0].costChoices, variants[1].costChoices);
  assert.deepEqual(perform(game, 'p1', offering, variants[1]), { ok: true });
});

test('sameAction compares nested fields', () => {
  assert.ok(sameAction({ a: 1, c: { s: [1] } }, { c: { s: [1] }, a: 1 }));
  assert.ok(!sameAction({ a: 1, c: { s: [1] } }, { a: 1, c: { s: [2] } }));
});

const fake = (fields) => ({
  status: 'inProgress', pendingDecision: null, priorityPlayerId: 'p1', activePlayerId: 'p1',
  phase: PHASE.PRECOMBAT_MAIN, step: null, stack: [], battlefield: [], validActions: [], ...fields,
});

test('auto-pass stops only where the player could sensibly act', () => {
  const pass = (fields, options = {}) => shouldAutoPass(fake(fields), 'p1', { hasOptions: true, ...options });
  assert.equal(pass({}, { hasOptions: false }), true, 'nothing to do');
  assert.equal(pass({}), false, 'own main phase');
  assert.equal(pass({}, { endingTurn: true }), true, 'ending the turn');
  assert.equal(pass({ phase: PHASE.BEGINNING, step: STEP.UPKEEP }), true);
  assert.equal(pass({ stack: [{ controllerId: 'p2' }] }), false, 'the opponent cast something');
  assert.equal(pass({ stack: [{ controllerId: 'p2' }] }, { endingTurn: true }), false);
  assert.equal(pass({ stack: [{ controllerId: 'p1' }] }), true, 'own spell: let it resolve');
  const myCombat = { phase: PHASE.COMBAT, combat: { attackers: [{ cardId: 'a', blockerIds: [] }] } };
  assert.equal(pass({ ...myCombat, step: STEP.DECLARE_BLOCKERS }), false, 'own attack, after blocks');
  assert.equal(pass({ ...myCombat, step: STEP.DECLARE_BLOCKERS }, { hasOptions: false }), true, 'after blocks, nothing to cast');
  assert.equal(pass({ ...myCombat, step: STEP.DECLARE_BLOCKERS, combat: { attackers: [] } }), true, 'no attack');
  assert.equal(pass({ ...myCombat, step: STEP.DECLARE_ATTACKERS }), true);
  const theirs = { activePlayerId: 'p2', phase: PHASE.COMBAT };
  assert.equal(pass({ ...theirs, step: STEP.BEGINNING_OF_COMBAT }), true);
  assert.equal(pass({ ...theirs, step: STEP.DECLARE_ATTACKERS }), false, 'they attack');
  assert.equal(pass({ ...theirs, step: STEP.DECLARE_BLOCKERS }), false, 'after blocks');
  assert.equal(pass({ activePlayerId: 'p2', phase: PHASE.ENDING, step: STEP.END }), false, 'their end step');
  assert.equal(pass({ activePlayerId: 'p2', phase: PHASE.PRECOMBAT_MAIN }), true);
  assert.equal(pass({ activePlayerId: 'p2' }, { hasOptions: false, fullControl: true }), false, 'full control');
  assert.equal(pass({ pendingDecision: { playerId: 'p1' } }, { hasOptions: false }), false, 'decisions are never passed');
});

test('the main button follows the game', () => {
  const passAction = { type: ACTION.PASS_PRIORITY, playerId: 'p1' };
  const label = (fields) => primaryAction(fake({ validActions: [passAction], ...fields }), 'p1').label;
  assert.equal(label({}), 'End turn');
  assert.equal(primaryAction(fake({ validActions: [passAction] }), 'p1').endTurn, true);
  const bear = { controllerId: 'p1', types: ['Creature'], keywords: [], tapped: false, summoningSick: false };
  assert.equal(label({ battlefield: [bear] }), 'Attack');
  assert.equal(label({ battlefield: [{ ...bear, summoningSick: true }] }), 'End turn');
  assert.equal(label({ stack: [{ controllerId: 'p2' }] }), 'Resolve');
  assert.equal(label({ activePlayerId: 'p2' }), 'Pass');
  const afterBlocks = label({ phase: PHASE.COMBAT, step: STEP.DECLARE_BLOCKERS, combat: { attackers: [{ cardId: 'a' }] } });
  assert.equal(afterBlocks, 'Deal damage');
  assert.equal(label({ priorityPlayerId: 'p2' }), 'Opponent');
  assert.equal(label({ pendingDecision: { type: DECISION.DECLARE_ATTACKERS, playerId: 'p1', attackers: ['x', 'y'] } }), 'Attack (2)');
  assert.equal(label({ pendingDecision: { type: DECISION.DECLARE_BLOCKERS, playerId: 'p1', blocks: {} } }), 'No blocks');
  assert.equal(label({ pendingDecision: { type: DECISION.DISCARD_TO_HAND_SIZE, playerId: 'p1', count: 2 } }), 'Discard 2');
  const assign = primaryAction(fake({ pendingDecision: { type: DECISION.ASSIGN_COMBAT_DAMAGE, playerId: 'p1', attackerId: 'a' } }), 'p1');
  assert.deepEqual([assign.label, assign.reopen], ['Assign damage', true], 'a dismissed damage sheet can be reopened');
});

test('presentation fields come from the definition, game values from the permanent', async () => {
  const { presentationOf, frameOf, colorsOf } = await import('../app/art.js');
  const definitions = {
    bear: { id: 'bear', name: 'Bear', power: 2, toughness: 2, image: { art: 'a.jpg', card: 'c.jpg' }, artist: 'Someone', colors: ['G'] },
  };
  const permanent = { id: 'p1-3', cardId: 'bear', name: 'Bear', power: 5, toughness: 5, counters: { '+1/+1': 3 }, types: ['Creature'], manaCost: { G: 1 } };
  const shown = presentationOf(permanent, definitions);
  assert.deepEqual([shown.power, shown.toughness, shown.id], [5, 5, 'p1-3']);
  assert.deepEqual([shown.image.art, shown.artist], ['a.jpg', 'Someone']);
  assert.equal(frameOf(shown), 'green');
  assert.deepEqual(colorsOf({ colors: ['green', 'blue'] }), ['G', 'U']);
  assert.equal(frameOf({ types: ['Land'] }), 'land');
  assert.equal(frameOf({ types: ['Artifact'], manaCost: { generic: 2 } }), 'colorless');
});

test('vendor-fonts reads glyph codepoints from icon stylesheets', async () => {
  const { codepoint, renderStylesheet, MANA_GLYPHS } = await import('../tools/vendor-fonts.js');
  const css = '.ms-g::before {\n  content: "\\e604";\n}\n.ms-planeswalker::before, .ms-watermark-planeswalker::before {\n  content: "\\e623";\n}\n.ss-m19:before{content:"\\E941"}';
  assert.equal(codepoint(css, 'ms', 'g'), 'e604');
  assert.equal(codepoint(css, 'ms', 'planeswalker'), 'e623');
  assert.equal(codepoint(css, 'ss', 'm19'), 'e941');
  assert.throws(() => codepoint(css, 'ms', 'u'), /No glyph/);
  assert.ok(MANA_GLYPHS.includes('tap') && MANA_GLYPHS.includes('ability-flying'));
  const sheet = renderStylesheet({ mana: { g: 'e604' }, sets: { m19: 'e941' } });
  assert.match(sheet, /\.ms-g::before \{ content: "\\e604"; \}/);
  assert.match(sheet, /\.ss-m19::before \{ content: "\\e941"; \}/);
});

test('promptFor only reports an attack once the opponent has declared attackers', () => {
  const base = { activePlayerId: 'p2', phase: PHASE.COMBAT, step: STEP.DECLARE_ATTACKERS, pendingDecision: null };
  assert.equal(promptFor({ ...base, combat: { attackers: [] } }, 'p1'), '');
  assert.equal(promptFor({ ...base, combat: null }, 'p1'), '');
  assert.equal(promptFor({ ...base, step: STEP.DECLARE_BLOCKERS, combat: { attackers: [{ cardId: 'a', blockerIds: [] }] } }, 'p1'),
    '1 attacking');
  assert.equal(promptFor({ ...base, combat: { attackers: [{ cardId: 'a' }, { cardId: 'b' }] } }, 'p1'), '2 attacking');
  assert.equal(promptFor({ ...base, activePlayerId: 'p1', combat: { attackers: [{ cardId: 'a' }] } }, 'p1'), '');
});

test('mulligans: the main button opens the choice, and the prompt says what to do', () => {
  const game = new Game({ players, cards, seed: 2, mulligans: true });
  game.start();
  assert.deepEqual(primaryAction(state(game), 'p1'), { label: 'Keep or mulligan', reopen: true });
  assert.equal(promptFor(state(game), 'p1'), 'Keep this hand?');
  assert.equal(promptFor(state(game), 'p2'), 'Opponent is looking at their hand…');
  game.dispatch({ type: ACTION.MULLIGAN, playerId: 'p1' });
  assert.equal(promptFor(state(game), 'p2'), 'Opponent mulligans to 6…');
  game.dispatch({ type: ACTION.KEEP_HAND, playerId: 'p1' });
  assert.equal(state(game).pendingDecision.type, DECISION.PUT_ON_BOTTOM);
  assert.equal(primaryAction(state(game), 'p1').label, 'Bottom 1');
  assert.equal(promptFor(state(game), 'p1'), 'Tap 1 card to put on the bottom');
  // No auto-passing through a decision.
  assert.equal(shouldAutoPass(state(game), 'p1', { hasOptions: false }), false);
});

// The Pathfinder's Elves in the app.

test('a fight\'s two targets, and cycling from the hand, are play options', () => {
  const elfCards = {
    ...cards,
    pounceFree: {
      id: 'pounceFree', name: 'Pounce', manaCost: {}, types: [CARD_TYPE.INSTANT],
      targets: [TARGET.CREATURE_YOU_CONTROL, TARGET.CREATURE_OPPONENT_CONTROLS], effects: [{ type: EFFECT.FIGHT }],
    },
    bearFree: { id: 'bearFree', name: 'Bear', manaCost: {}, types: [CARD_TYPE.CREATURE], power: 2, toughness: 2 },
    thicketFree: {
      id: 'thicketFree', name: 'Thicket', types: [CARD_TYPE.LAND],
      handAbilities: [{ id: 'cycling', text: 'Cycling {G}', cost: { mana: { G: 1 }, discardSelf: true }, effects: [{ type: EFFECT.DRAW_CARDS, count: 1 }] }],
    },
  };
  const deck = (first) => [...first, ...Array(40 - first.length).fill('forest')];
  const game = new Game({
    players, cards: elfCards, shuffleLibraries: false, emblems: { p1: [], p2: [] },
    decks: { p1: deck(['bearFree', 'pounceFree', 'thicketFree', 'forest']), p2: deck(['bearFree', 'bearFree']) },
  });
  game.start();
  const pass = () => game.dispatch(passPriority(state(game).priorityPlayerId));
  const until = (done) => { for (let i = 0; i < 80 && !done(state(game)); i++) {
    const s = state(game);
    const confirm = s.validActions.find((a) => a.type.startsWith('CONFIRM_'));
    if (s.pendingDecision) game.dispatch(confirm ?? s.validActions[0]); else pass();
  } };
  const main = (player, turn) => (s) => s.activePlayerId === player && s.turn === turn && s.phase === PHASE.PRECOMBAT_MAIN && !s.pendingDecision;
  until(main('p1', 1));
  game.dispatch(playLand('p1', state(game).players[0].hand.find((c) => c.cardId === 'forest').id));
  const castBear = (playerId) => {
    const bear = state(game).players.find((p) => p.id === playerId).hand.find((c) => c.cardId === 'bearFree');
    game.dispatch({ type: ACTION.CAST_SPELL, playerId, cardId: bear.id });
    pass(); pass();
  };
  castBear('p1');
  until(main('p2', 2));
  castBear('p2');
  castBear('p2');
  until(main('p1', 3));
  const options = playOptions(game, 'p1');
  const pounce = options.find((o) => o.sourceId === handCard(game, 'pounceFree').id);
  const myBear = state(game).battlefield.find((p) => p.controllerId === 'p1' && p.cardId === 'bearFree').id;
  // Every target of any slot; the first slot is our Bear.
  assert.equal(pounce.targets.length, 3);
  assert.deepEqual([...new Set(pounce.variants.map((v) => v.targets[0]))], [myBear]);
  assert.equal(secondTargets(variantsFor(pounce, myBear)).length, 2, 'either of their Bears');
  const cycle = options.find((o) => o.sourceId === handCard(game, 'thicketFree').id && o.fromHand);
  assert.deepEqual([cycle.kind, cycle.abilityId, cycle.text], ['activate', 'cycling', 'Cycling {G}']);
  assert.deepEqual(perform(game, 'p1', cycle, cycle.variants[0]), { ok: true });
  assert.ok(state(game).players[0].graveyard.some((c) => c.cardId === 'thicketFree'));
});

test('the main button and prompt for modes, optional targets, graveyard cards and the legend rule', () => {
  const base = { players: [{ id: 'p1', hand: [] }], stack: [], battlefield: [], combat: { attackers: [] }, status: 'inProgress' };
  const at = (decision, validActions) => ({ ...base, pendingDecision: { playerId: 'p1', ...decision }, validActions });
  const decline = { type: ACTION.CHOOSE_TARGETS, playerId: 'p1', targets: [] };
  assert.deepEqual(primaryAction(at({ type: DECISION.CHOOSE_TARGETS, optional: true, targetKind: TARGET.ARTIFACT }, [decline]), 'p1'),
    { label: 'Don\'t', action: decline });
  assert.equal(primaryAction(at({ type: DECISION.CHOOSE_TARGETS, targetKind: TARGET.PERMANENT_CARD_IN_YOUR_GRAVEYARD }, []), 'p1').reopen, true);
  assert.equal(primaryAction(at({ type: DECISION.CHOOSE_MODE }, []), 'p1').reopen, true);
  assert.equal(primaryAction(at({ type: DECISION.LEGEND_RULE }, []), 'p1').reopen, true);
  assert.equal(promptFor(at({ type: DECISION.CHOOSE_MODE, sourceName: 'Inspiring Bard' }, []), 'p1'), 'Choose one: Inspiring Bard');
  assert.equal(promptFor(at({ type: DECISION.CHOOSE_TARGETS, optional: true, sourceName: 'Reclamation Sage' }, []), 'p1'),
    'You may choose a target: Reclamation Sage');
  const lure = { id: 'x', name: 'Taunting Elf', keywords: [KEYWORD.LURE] };
  assert.equal(blockHint({ ...base, battlefield: [lure], combat: { attackers: [{ cardId: 'x' }] } }), 'Every creature able to block Taunting Elf must');
});

test('the play history records lands, spells and their targets, by turn', () => {
  const game = setup(['sampleShock', 'forest']);
  const history = new PlayHistory();
  let pending = [];
  game.onAny((name, payload) => {
    if (name !== 'state') pending.push({ name, payload });
    else {
      history.record(pending, payload);
      pending = [];
    }
  });
  withForests(game, 1);
  const shock = handCard(game, 'sampleShock');
  const option = playOptions(game, 'p1').find((o) => o.sourceId === shock.id);
  assert.deepEqual(perform(game, 'p1', option, variantsFor(option, 'p2')[0]), { ok: true });
  const turn = state(game).turn;
  assert.deepEqual(history.entries.map(({ turn: t, playerId, kind, source, targets }) => ({ t, playerId, kind, source, targets })), [
    { t: turn, playerId: 'p1', kind: 'land', source: 'Forest', targets: [] },
    { t: turn, playerId: 'p1', kind: 'spell', source: 'Sample Shock', targets: [{ playerId: 'p2' }] },
  ]);
});

test('a play\'s choices, one at a time: mode, X, then targets by position or as a set', () => {
  const variants = [
    { mode: 0, x: 1, targets: ['a'] }, { mode: 0, x: 2, targets: ['a'] }, { mode: 1, targets: ['b', null] }, { mode: 1, targets: ['b', 'c'] },
  ];
  const mode = nextChoice(variants);
  assert.deepEqual(mode, { kind: 'mode', values: [0, 1] });
  assert.deepEqual(nextChoice(narrow(variants, mode, 0)), { kind: 'x', values: [1, 2] });
  const second = nextChoice(narrow(variants, mode, 1));
  assert.deepEqual(second, { kind: 'target', index: 1, values: [null, 'c'] });
  assert.equal(narrow(narrow(variants, mode, 1), second, null).length, 1);
  // "Up to two target creatures": in any order, and stop after any.
  const upToTwo = [{ targets: [] }, { targets: ['a'] }, { targets: ['b'] }, { targets: ['a', 'b'] }, { targets: ['b', 'a'] }];
  assert.deepEqual(nextChoice(upToTwo, { interchangeable: true }), { kind: 'targets', values: ['a', 'b', null] });
  const afterB = narrow(upToTwo, { kind: 'targets' }, 'b');
  assert.deepEqual(nextChoice(afterB, { interchangeable: true, picked: ['b'] }), { kind: 'targets', values: ['a', null] });
  assert.deepEqual(narrow(afterB, { kind: 'targets' }, null, ['b']), [{ targets: ['b'] }]);
  assert.equal(interchangeableTargets([TARGET.CREATURE, TARGET.CREATURE]), true);
  assert.equal(interchangeableTargets([TARGET.CREATURE_YOU_CONTROL, TARGET.CREATURE_OPPONENT_CONTROLS]), false);
  assert.equal(interchangeableTargets([TARGET.CREATURE]), false);
});

test('the main button and prompt for choices made while something resolves', () => {
  const base = { players: [{ id: 'p1', hand: [] }], stack: [], battlefield: [], combat: { attackers: [] }, status: 'inProgress' };
  const at = (decision) => ({ ...base, pendingDecision: { playerId: 'p1', ...decision }, validActions: [] });
  assert.equal(primaryAction(at({ type: DECISION.CHOOSE, kind: CHOICE.RING_BEARER, options: ['x'] }), 'p1').reopen, true);
  assert.equal(primaryAction(at({ type: DECISION.CHOOSE, kind: CHOICE.DISCARD, options: ['x'] }), 'p1').label, 'Discard 1');
  assert.deepEqual(primaryAction(at({ type: DECISION.CHOOSE_MANY, kind: CHOICE.SCRY, options: ['x', 'y'] }), 'p1'), { label: 'Scry', reopen: true });
  assert.equal(promptFor(at({ type: DECISION.CHOOSE, kind: CHOICE.RING_BEARER, options: ['x'] }), 'p1'), 'The Ring tempts you: choose your Ring-bearer');
  assert.equal(promptFor(at({ type: DECISION.CHOOSE_MANY, kind: CHOICE.SCRY, options: ['x', 'y'] }), 'p1'), 'Scry 2: tap the cards to keep on top, in order');
});
