// Helpers for playing real LTR cards in tests (made free to cast, so a test needs no lands).
import assert from 'node:assert/strict';
import {
  Game, DECISION, ACTION, CARDS, passPriority, castSpell, confirmAttackers, confirmBlockers,
} from '../../src/index.js';

export const players = [{ id: 'p1' }, { id: 'p2' }];

const freeMana = (mana) => (mana?.X ? { X: mana.X } : {});

/** Free copies of real cards (keeping {X}); with `abilities`, their activated abilities cost no mana either. */
export const free = (ids, { abilities = false } = {}) => Object.fromEntries(ids.map((id) => {
  const card = CARDS[id];
  if (!card) throw new Error(`No card ${id}`);
  const copy = { ...card, manaCost: freeMana(card.manaCost) };
  if (abilities && card.abilities) {
    copy.abilities = card.abilities.map((a) => ({ ...a, cost: { ...a.cost, ...(a.cost.mana ? { mana: freeMana(a.cost.mana) } : {}) } }));
  }
  return [id, copy];
}));

export const BEAR = { id: 'bear', name: 'Bear', manaCost: {}, types: ['Creature'], subtypes: ['Bear'], power: 2, toughness: 2 };
export const ORC = { id: 'orc', name: 'Orc', manaCost: {}, types: ['Creature'], subtypes: ['Orc'], power: 1, toughness: 1 };
export const HERO = { id: 'hero', name: 'Hero', manaCost: {}, types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Human'], power: 3, toughness: 3 };
export const GIANT = { id: 'giant', name: 'Giant', manaCost: {}, types: ['Creature'], subtypes: ['Giant'], power: 5, toughness: 5 };
export const SALVE = { id: 'salve', name: 'Salve', manaCost: {}, types: ['Instant'], effects: [{ type: 'gainLife', amount: 3 }] };
export const SHOCK = { id: 'shock', name: 'Shock', manaCost: {}, types: ['Instant'], colors: ['R'], target: 'any', effects: [{ type: 'dealDamage', amount: 2 }] };
export const NEGATE = { id: 'negate', name: 'Negate', manaCost: {}, types: ['Instant'], target: 'spell', effects: [{ type: 'counterSpell' }] };
const BASICS = {
  bear: BEAR, orc: ORC, hero: HERO, giant: GIANT, salve: SALVE, shock: SHOCK, negate: NEGATE,
};

/**
 * A game with p1 holding `p1` (then Forests) and p2 holding `p2`, libraries `library1`/`library2`
 * after the hand. `cards` are real card ids made free (`freeAbilities` for their abilities too);
 * `extra` adds hand-made definitions.
 */
export function setup({
  p1 = [], p2 = [], cards = [], library1 = [], library2 = [], freeAbilities = false, extra = {}, fill = 'forest',
} = {}) {
  const deck = (hand, library) => [...hand, ...Array(7 - hand.length).fill(fill), ...library, ...Array(Math.max(0, 33 - library.length)).fill(fill)];
  const game = new Game({
    players,
    cards: { ...free(cards, { abilities: freeAbilities }), ...BASICS, ...extra },
    shuffleLibraries: false,
    emblems: { p1: [], p2: [] },
    decks: { p1: deck(p1, library1), p2: deck(p2, library2) },
  });
  const events = [];
  game.onAny((name, payload) => events.push({ name, payload }));
  game.start();
  return { game, events };
}

export const state = (game) => game.getState();
export const player = (game, id) => state(game).players.find((p) => p.id === id);
export const permanent = (game, id) => state(game).battlefield.find((p) => p.id === id);
export const named = (game, name) => state(game).battlefield.filter((p) => p.name === name);
export const byCard = (game, cardId) => state(game).battlefield.filter((p) => p.cardId === cardId);
export const inHand = (game, playerId, cardId) => player(game, playerId).hand.find((c) => c.cardId === cardId)?.id;
export const decision = (game) => state(game).pendingDecision;
export const ok = (game, action) => assert.deepEqual(game.dispatch(action), { ok: true }, JSON.stringify(action));

export function passRound(game) {
  for (let i = 0; i < 2 && state(game).priorityPlayerId; i++) ok(game, passPriority(state(game).priorityPlayerId));
}

/** Passes until the stack is empty and nothing waits (choices are left to the test). */
export function resolveAll(game) {
  for (let i = 0; i < 30 && state(game).stack.length && !decision(game); i++) passRound(game);
}

/** Moves to a phase (and step) of a turn, confirming empty attacks and blocks on the way. */
export function advanceTo(game, { turn, phase, step = null }) {
  for (let i = 0; i < 300; i++) {
    const s = state(game);
    if (s.turn === turn && s.phase === phase && (step === null || s.step === step) && !s.pendingDecision && s.stack.length === 0) return;
    const d = s.pendingDecision;
    if (d?.type === DECISION.DECLARE_ATTACKERS) ok(game, confirmAttackers(d.playerId));
    else if (d?.type === DECISION.DECLARE_BLOCKERS) ok(game, confirmBlockers(d.playerId));
    else if (d?.type === DECISION.CHOOSE_MANY) ok(game, s.validActions.find((a) => a.type === ACTION.CONFIRM_CHOICE) ?? s.validActions[0]);
    else if (d) ok(game, s.validActions[0]);
    else passRound(game);
  }
  throw new Error('advanceTo: stuck');
}

/** Passes priority until a player must decide something (or `limit` rounds go by). */
export function untilDecision(game, limit = 40) {
  for (let i = 0; i < limit && !decision(game); i++) passRound(game);
  return decision(game);
}

/** Casts a card from hand and resolves it. */
export function cast(game, playerId, cardId, extra = {}) {
  const id = inHand(game, playerId, cardId);
  assert.ok(id, `${cardId} in hand`);
  ok(game, {
    ...castSpell(playerId, id, extra.targets),
    ...(extra.mode !== undefined ? { mode: extra.mode } : {}),
    ...(extra.x !== undefined ? { x: extra.x } : {}),
    ...(extra.costChoices ? { costChoices: extra.costChoices } : {}),
  });
  resolveAll(game);
  return id;
}

/** The valid action of a type for `cardId` (and anything else in `match`). */
export const actionFor = (game, type, match = {}) => state(game).validActions.find((a) => a.type === type
  && Object.entries(match).every(([k, v]) => JSON.stringify(a[k]) === JSON.stringify(v)));

export const activate = (game, playerId, cardId, match = {}) => {
  const action = actionFor(game, ACTION.ACTIVATE_ABILITY, { playerId, cardId, ...match });
  assert.ok(action, `can activate ${cardId}`);
  ok(game, action);
};
