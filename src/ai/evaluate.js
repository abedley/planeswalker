/**
 * A static evaluation of a game state from one player's side, in roughly the same
 * points as creatureValue (src/ai/combat.js): positive means `me` is ahead. Search
 * AIs score the positions their simulations reach with it.
 *
 * It's a weighted sum of features (each "ours minus theirs"), so the weights can
 * be fitted to game results (tools/tune-ai.js), and each CPU deck can have its
 * own (see weightsFor).
 */
import { isCreature, isLand } from '../cards/cards.js';
import { GAME_STATUS } from '../engine/Game.js';
import { creatureValue, damageThrough } from './combat.js';
import { TUNED_WEIGHTS, DECK_WEIGHTS } from './weights.js';

/** Hand-picked starting weights (tools/tune-ai.js fits TUNED_WEIGHTS from these). */
export const HAND_WEIGHTS = Object.freeze({
  /** `ln(1 + life)`: each point of life matters more when it's low. */
  life: 10,
  /** Sum of creatureValue. */
  creatures: 1,
  lands: 1.5,
  /** Other permanents (artifacts, enchantments, tokens like Treasure). */
  permanents: 2.5,
  /** Spells in hand (every card, when the hand isn't known). */
  hand: 2.5,
  /** Lands in hand: worth far less than spells, and less than lands in play. */
  handLands: 0.5,
  /** Turns their clock on us is slower than ours on them. */
  clock: 1.5,
  /** Cards short of 5 in the library (deck-out danger). */
  library: -3,
});

export const DEFAULT_WEIGHTS = TUNED_WEIGHTS ?? HAND_WEIGHTS;

export const FEATURES = Object.freeze(Object.keys(HAND_WEIGHTS));

const adjust = (factors) => Object.freeze(Object.fromEntries(
  FEATURES.map((f) => [f, Math.round(DEFAULT_WEIGHTS[f] * (factors[f] ?? 1) * 1000) / 1000]),
));

/**
 * Starting points for kinds of deck, as adjustments of the default weights. A deck
 * of that kind can use one as is, or as the base for its own tuning
 * (`npm run tune-ai -- --deck <name> --from aggro`).
 */
export const ARCHETYPE_WEIGHTS = Object.freeze({
  /** Races: a faster clock matters most; cards in hand and life total matter less. */
  aggro: adjust({ clock: 2.5, hand: 0.6, life: 0.7 }),
  /** Trades and grinds: cards and life matter more than speed. */
  control: adjust({ clock: 0.4, hand: 1.6, life: 1.3, creatures: 0.8 }),
  midrange: DEFAULT_WEIGHTS,
});

/**
 * The weights for a CPU deck: the deck's own (DECK_WEIGHTS, from tuning it), an
 * archetype's (ARCHETYPE_WEIGHTS), or the defaults. `profile` is a deck name, an
 * archetype name, or a weights object (missing features use the defaults).
 */
export function weightsFor(profile) {
  if (!profile) return DEFAULT_WEIGHTS;
  if (typeof profile === 'object') return { ...DEFAULT_WEIGHTS, ...profile };
  return DECK_WEIGHTS[profile] ?? ARCHETYPE_WEIGHTS[profile] ?? DEFAULT_WEIGHTS;
}

const WIN = 10000;

/** Turns for `attackers` to kill a player at `life` through `blockers` (capped). */
function turnsToKill(attackers, blockers, life) {
  const perTurn = damageThrough(attackers, blockers);
  return perTurn <= 0 ? 10 : Math.min(10, Math.ceil(life / perTurn));
}

/** Each feature for one side. */
function sideFeatures(state, player) {
  const permanents = state.battlefield.filter((p) => p.controllerId === player.id);
  const creatures = permanents.filter(isCreature);
  const library = player.library?.length ?? player.librarySize ?? 0;
  return {
    life: Math.log(1 + Math.max(0, player.life)),
    creatures: creatures.reduce((sum, c) => sum + creatureValue(c), 0),
    lands: permanents.filter(isLand).length,
    permanents: permanents.filter((p) => !isLand(p) && !isCreature(p)).length,
    hand: player.hand ? player.hand.filter((c) => !isLand(c)).length : player.handSize ?? 0,
    handLands: player.hand ? player.hand.filter(isLand).length : 0,
    library: Math.max(0, 5 - library),
  };
}

/** The features of a (not finished) state from `me`'s side, each ours minus theirs. */
export function features(state, me) {
  const player = state.players.find((p) => p.id === me);
  const opponent = state.players.find((p) => p.id !== me);
  const ours = sideFeatures(state, player);
  const theirs = sideFeatures(state, opponent);
  const creaturesOf = (id) => state.battlefield.filter((p) => p.controllerId === id && isCreature(p));
  const attackers = (id) => creaturesOf(id).filter((c) => !c.keywords.includes('defender'));
  // Next turn everything untaps.
  const blockers = (id) => creaturesOf(id).map((c) => ({ ...c, tapped: false }));
  const ourClock = turnsToKill(attackers(me), blockers(opponent.id), opponent.life);
  const theirClock = turnsToKill(attackers(opponent.id), blockers(me), player.life);
  return {
    life: ours.life - theirs.life,
    creatures: ours.creatures - theirs.creatures,
    lands: ours.lands - theirs.lands,
    permanents: ours.permanents - theirs.permanents,
    hand: ours.hand - theirs.hand,
    handLands: ours.handLands - theirs.handLands,
    clock: theirClock - ourClock,
    library: ours.library - theirs.library,
  };
}

export function evaluate(state, me, weights = DEFAULT_WEIGHTS) {
  if (state.status === GAME_STATUS.GAME_OVER) {
    if (state.winnerId === me) return WIN;
    return state.winnerId === null ? 0 : -WIN;
  }
  const values = features(state, me);
  let score = 0;
  for (const name of FEATURES) score += (weights[name] ?? 0) * values[name];
  return score;
}
