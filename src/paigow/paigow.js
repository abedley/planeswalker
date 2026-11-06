/**
 * Pai Gow: a best-of-five match against the CPU with tiny decks.
 *
 * Each side opens a booster of The Lord of the Rings: Tales of Middle-earth (see openBooster) and
 * splits its 15 cards into five decks of three. Round N pits deck N against deck N: both players start with all
 * three cards in hand, 5 life and infinite mana, no emblems, and can't lose by drawing from an empty
 * library. A round is won, lost or drawn (a stalled board, see Game's `stallDraw`). The first to win
 * three rounds takes the match; if five rounds pass without that, the one with more wins does, and
 * otherwise it's a tie.
 *
 * Everything here is pure: a match is a plain object, and each function returns a new one.
 */
import { CARDS, isCreature, manaValue } from '../cards/cards.js';
import { GAME_LIMITS } from '../engine/Game.js';
import { seededRandom, shuffle } from '../engine/random.js';
import { PAIGOW_OPPONENTS, paigowOpponent } from './personas.js';
import { weightsFor } from '../ai/evaluate.js';

export const PAIGOW_RULES = Object.freeze({
  cardsDealt: 15,
  decks: 5,
  deckSize: 3,
  roundsToWin: 3,
  startingLife: 5,
  /** A backstop for the stall rule: the round is a draw after this many turns. */
  turnLimit: 40,
});

/**
 * A booster, as LTR's Draft Booster (LTR came before Play Boosters): 10 different commons, 3 different
 * uncommons and a rare or mythic, and in place of the basic land, any LTR card at all.
 */
export const BOOSTER = Object.freeze({ commons: 10, uncommons: 3, rares: 1, wildcards: 1 });

export const PLAYER_ID = 'player';
export const CPU_ID = 'cpu';

export const ROUND_RESULT = Object.freeze({ WON: 'won', LOST: 'lost', DRAWN: 'drawn' });
export const MATCH_OUTCOME = Object.freeze({ WON: 'won', LOST: 'lost', TIE: 'tie' });

/** Every card that can be opened: the LTR cards in the game (a few that need rules it lacks are left out). */
export const PAIGOW_POOL = Object.freeze(Object.keys(CARDS).filter((id) => CARDS[id].set === 'ltr').sort());

/** The pool by rarity: `common`, `uncommon`, `rare`, `mythic`. */
export const POOL_BY_RARITY = Object.freeze(Object.fromEntries(['common', 'uncommon', 'rare', 'mythic']
  .map((rarity) => [rarity, Object.freeze(PAIGOW_POOL.filter((id) => CARDS[id].rarity === rarity))])));

const RARITY = { common: 1, uncommon: 2, rare: 3, mythic: 4 };

/** A rough strength for a card, to share the CPU's cards out evenly between its decks. */
export function cardStrength(cardId) {
  const card = CARDS[cardId];
  const stats = isCreature(card) ? ((card.power ?? 0) + (card.toughness ?? 0)) / 2 : 0;
  return 2 * (RARITY[card.rarity] ?? 1) + manaValue(card.manaCost ?? {}) + stats;
}

/**
 * A booster's 15 cards, in the order they'd be in the pack: the commons, the uncommons, the rare or
 * mythic (each rare twice as likely as each mythic, as on a print sheet, so a mythic is about one
 * pack in seven), and last the wildcard, every LTR card equally likely (it may repeat one already in
 * the pack).
 */
export function openBooster(random) {
  const { common, uncommon, rare, mythic } = POOL_BY_RARITY;
  const rareSlot = [...rare, ...rare, ...mythic];
  return [
    ...shuffle([...common], random).slice(0, BOOSTER.commons),
    ...shuffle([...uncommon], random).slice(0, BOOSTER.uncommons),
    rareSlot[Math.floor(random() * rareSlot.length)],
    PAIGOW_POOL[Math.floor(random() * PAIGOW_POOL.length)],
  ];
}

/**
 * The CPU's five decks: its cards from strongest to weakest, dealt out snake-wise (1→5, 5→1, 1→5) so
 * each deck gets a fair share, and then the decks in a random order (so its best isn't always first).
 */
export function arrangeCpuDecks(cards, random, { decks = PAIGOW_RULES.decks } = {}) {
  const sorted = [...cards].sort((a, b) => cardStrength(b) - cardStrength(a) || (a < b ? -1 : 1));
  const result = Array.from({ length: decks }, () => []);
  sorted.forEach((cardId, i) => {
    const lap = Math.floor(i / decks);
    const slot = i % decks;
    result[lap % 2 === 0 ? slot : decks - 1 - slot].push(cardId);
  });
  return shuffle(result, random);
}

/**
 * A new match: a booster opened for each side, the CPU's decks arranged, its opponent picked from
 * PAIGOW_OPPONENTS (src/paigow/personas.js), and who goes first in round 1 decided (then it alternates).
 */
export function createMatch({ seed = Math.floor(Math.random() * 2 ** 32) } = {}) {
  const random = seededRandom(seed);
  const cards = openBooster(random);
  const cpuCards = openBooster(random);
  const candidates = Object.keys(PAIGOW_OPPONENTS);
  const opponentId = candidates[Math.floor(random() * candidates.length)];
  return {
    seed,
    opponentId,
    cards,
    decks: null,
    cpuDecks: arrangeCpuDecks(cpuCards, random),
    playerStarts: random() < 0.5,
    rounds: [],
  };
}

/** Whether `decks` is a legal split of the match's cards: five decks of three, using each card (each copy) once. */
export function validDecks(match, decks) {
  if (!Array.isArray(decks) || decks.length !== PAIGOW_RULES.decks) return false;
  if (decks.some((deck) => !Array.isArray(deck) || deck.length !== PAIGOW_RULES.deckSize)) return false;
  return [...decks.flat()].sort().join() === [...match.cards].sort().join();
}

/** The match with the player's decks set. */
export function setDecks(match, decks) {
  if (match.decks) throw new Error('The decks are already set.');
  if (!validDecks(match, decks)) throw new Error('Make five decks of three cards from your cards.');
  return { ...match, decks: decks.map((deck) => [...deck]) };
}

/** Wins, losses and draws so far. */
export function score(match) {
  const count = (result) => match.rounds.filter((r) => r.result === result).length;
  return { won: count(ROUND_RESULT.WON), lost: count(ROUND_RESULT.LOST), drawn: count(ROUND_RESULT.DRAWN) };
}

/** The match's result once it's over (`MATCH_OUTCOME`), otherwise null. */
export function outcome(match) {
  const { won, lost } = score(match);
  if (won >= PAIGOW_RULES.roundsToWin) return MATCH_OUTCOME.WON;
  if (lost >= PAIGOW_RULES.roundsToWin) return MATCH_OUTCOME.LOST;
  if (match.rounds.length < PAIGOW_RULES.decks) return null;
  return won > lost ? MATCH_OUTCOME.WON : lost > won ? MATCH_OUTCOME.LOST : MATCH_OUTCOME.TIE;
}

/** The index of the round to play next (0–4), or null once the match is over. */
export function nextRound(match) {
  return match.decks && outcome(match) === null ? match.rounds.length : null;
}

/** Whether the player goes first in round `round` (0-based): round 1 by coin flip, then taking turns. */
export const playerStartsRound = (match, round) => (round % 2 === 0) === match.playerStarts;

/** The match with the next round's result recorded: `ROUND_RESULT`. */
export function recordRound(match, result) {
  const round = nextRound(match);
  if (round === null) throw new Error('No round to play.');
  if (!Object.values(ROUND_RESULT).includes(result)) throw new Error(`Unknown result: ${result}`);
  return { ...match, rounds: [...match.rounds, { result }] };
}

/**
 * The next round's setup, in the shape of the campaign's matchSetup(): `game` (Game options), `cpu`
 * (for createCpuController) and `encounter`.
 */
export function roundSetup(match, content, { playerName = 'You' } = {}) {
  const round = nextRound(match);
  if (round === null) throw new Error('No round to play.');
  const opponent = paigowOpponent(match.opponentId);
  const players = [{ id: PLAYER_ID, name: playerName }, { id: CPU_ID, name: opponent.name }];
  const life = PAIGOW_RULES.startingLife;
  return {
    game: {
      players,
      startingPlayerId: playerStartsRound(match, round) ? PLAYER_ID : CPU_ID,
      seed: (match.seed + round * 7919) >>> 0,
      cards: { ...content.cards },
      decks: { [PLAYER_ID]: [...match.decks[round]], [CPU_ID]: [...match.cpuDecks[round]] },
      emblems: { [PLAYER_ID]: [], [CPU_ID]: [] },
      startingLife: { [PLAYER_ID]: life, [CPU_ID]: life },
      limits: { ...GAME_LIMITS },
      mulligans: false,
      openingHandSize: PAIGOW_RULES.deckSize,
      deckingLoss: false,
      infiniteMana: true,
      stallDraw: true,
      turnLimit: PAIGOW_RULES.turnLimit,
    },
    cpu: {
      playerId: CPU_ID,
      opponentId: match.opponentId,
      name: opponent.name,
      ai: {
        ...opponent.ai,
        budgetMs: Math.max(opponent.ai.budgetMs ?? 0, 1000),
        // Libraries are always empty here, and that's no danger.
        weights: { ...weightsFor(opponent.ai.weights), library: 0 },
      },
      banter: opponent.banter ?? null,
    },
    encounter: { round, opponentId: match.opponentId, opponentName: opponent.name },
  };
}
