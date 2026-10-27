/**
 * Roguelite campaign runs: choose a planeswalker and a starting deck, then fight
 * up a ladder of ever harder CPU opponents, ending with a boss. Each win offers
 * rewards (cards for the deck, or planeswalker powers); each loss costs one of the
 * run's lives, after which the fight can be retried or skipped.
 *
 * Everything is data: the content (see SAMPLE_CAMPAIGN in sampleCampaign.js for
 * the format) says which planeswalkers, decks, opponents, powers and tiers exist,
 * and a run is a plain JSON object, so it can be saved (save.js). The functions
 * here never mutate a run; they return the next one. All of a run's randomness
 * comes from its own seeded generator, so a run is reproducible from its seed.
 *
 * A UI drives a run like this:
 *   let run = startRun(content, { planeswalkerId, deckId });
 *   const { game, cpu } = matchSetup(run, content);       // phase 'fight'
 *   ... play new Game(game) against createCpuController(..., cpu) (cpu.js) ...
 *   run = recordResult(run, content, { won });             // → 'reward', 'defeated', 'victory' or 'over'
 *   run = chooseReward(run, content, i) / skipReward(...)  // 'reward' → next 'fight'
 *   run = retryFight(run) / skipFight(run, content)        // 'defeated' → 'fight'
 */
import { CARDS } from '../cards/cards.js';
import { EMBLEMS } from '../cards/emblems.js';
import { STARTING_LIFE, GAME_LIMITS } from '../engine/Game.js';
import { seededRandom } from '../engine/random.js';

/** Bumped when the shape of a run changes, so old saves are dropped (save.js). */
export const RUN_VERSION = 1;

export const RUN_PHASE = Object.freeze({
  /** Waiting for the current encounter to be played. */
  FIGHT: 'fight',
  /** Won: choose one of `run.offers` (or skip). */
  REWARD: 'reward',
  /** Lost, with lives left: retry or skip the fight. */
  DEFEATED: 'defeated',
  /** Beat the last fight of the ladder. */
  VICTORY: 'victory',
  /** Out of lives. */
  OVER: 'over',
});

/** Kinds of planeswalker power (content.powers). */
export const POWER = Object.freeze({
  /** Gain an emblem: `{ emblemId }`. */
  EMBLEM: 'emblem',
  /** An emblem you have can be used `amount` more times each turn: `{ emblemId, amount }`. */
  ACTIVATIONS: 'activations',
  /** Start every fight with `amount` more life. */
  STARTING_LIFE: 'startingLife',
  /** `amount` (default 1) more lives for the run. */
  EXTRA_LIFE: 'extraLife',
  /** Replace emblem `emblemId`, which the run has, with a better one, `to`. */
  UPGRADE: 'upgrade',
});

/** Kinds of reward offer. */
export const REWARD = Object.freeze({
  /** Add `cardId` to the deck. */
  CARD: 'card',
  /** Gain power `powerId`. */
  POWER: 'power',
  /** Remove a card of your choice from the deck (not below rules.minDeckSize). */
  REMOVE_CARD: 'removeCard',
});

/** CPU opponents' AIs (opponent.ai.kind); see cpu.js. */
export const AI_KIND = Object.freeze({ BASIC: 'basic', SEARCH: 'search' });

const DEFAULT_RULES = Object.freeze({
  lives: 3,
  minDeckSize: 40,
  /** Game limits for every fight (see GAME_LIMITS), so a board fits on a phone screen. */
  limits: GAME_LIMITS,
  /** Most planeswalker abilities (over all of a player's emblems) a player can have. */
  maxAbilities: 4,
  /** Whether players may mulligan their opening hands (the London mulligan, 103.5). */
  mulligans: true,
  rewards: Object.freeze({ cards: 2, powers: 1, removeCard: false }),
});

const rulesOf = (content) => ({ ...DEFAULT_RULES, ...content.rules });
const rewardsOf = (content, tier) => ({ ...DEFAULT_RULES.rewards, ...content.rules?.rewards, ...tier.rewards });
const cardsOf = (content) => ({ ...CARDS, ...content.cards });
const emblemsOf = (content) => ({ ...EMBLEMS, ...content.emblems });
const newSeed = (random) => Math.floor(random() * 2 ** 32);

/** A card's colors as letters, from its `colors` or its mana cost. */
const COLOR_LETTERS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const colorsOfCard = (card) => (card?.colors ?? Object.keys(card?.manaCost ?? {}))
  .map((c) => COLOR_LETTERS[c] ?? c).filter((c) => 'WUBRG'.includes(c));

/**
 * The cards of a pool a planeswalker can be offered: those within its `colors`
 * (colorless cards always fit). Without `colors`, the whole pool. A planeswalker
 * with its own `cardPool` is offered that one instead, in every tier.
 */
export function poolFor(content, planeswalkerId, poolId) {
  const pool = content.cardPools?.[content.planeswalkers[planeswalkerId]?.cardPool ?? poolId] ?? [];
  const colors = content.planeswalkers[planeswalkerId]?.colors;
  if (!colors) return pool;
  const cards = cardsOf(content);
  return pool.filter((id) => colorsOfCard(cards[id]).every((c) => colors.includes(c)));
}

/** How many abilities a list of emblems gives, all together. */
export function abilityCount(content, emblemIds = []) {
  const emblems = emblemsOf(content);
  return emblemIds.reduce((sum, id) => sum + (emblems[id]?.abilities?.length ?? 0), 0);
}

export const currentTier = (run, content) => content.ladder[run.tierIndex];

/** Where a run is: its tier (and index) and its fight within the tier. */
export function runProgress(run, content) {
  const tier = currentTier(run, content);
  return {
    tier, tierIndex: run.tierIndex, tiers: content.ladder.length, fight: run.fightIndex, fights: tier?.fights ?? 0,
  };
}

/** Copies `run`, lets `change(draft, random)` edit the copy, and saves the generator's state. */
function update(run, change) {
  const draft = structuredClone(run);
  const random = seededRandom(0);
  random.setState(draft.rng);
  change(draft, random);
  draft.rng = random.getState();
  return draft;
}

function expectPhase(run, phase) {
  if (run.phase !== phase) throw new Error(`The run is in phase "${run.phase}", not "${phase}".`);
}

/** Picks `count` distinct items of `items` at random. */
function pick(items, count, random) {
  const left = [...new Set(items)];
  const chosen = [];
  while (chosen.length < count && left.length > 0) chosen.push(...left.splice(Math.floor(random() * left.length), 1));
  return chosen;
}

/** Sets up the next fight of the current tier, against an opponent the run hasn't beaten or skipped. */
function pickEncounter(draft, content, random) {
  const tier = currentTier(draft, content);
  const fresh = tier.opponents.filter((id) => !draft.faced.includes(id));
  const [opponentId] = pick(fresh.length > 0 ? fresh : tier.opponents, 1, random);
  draft.encounter = { tierId: tier.id, opponentId, seed: newSeed(random) };
  draft.phase = RUN_PHASE.FIGHT;
}

/** Moves past the current fight: to the next one, the next tier, or victory. */
function advance(draft, content, random) {
  draft.offers = [];
  draft.fightIndex += 1;
  if (draft.fightIndex >= currentTier(draft, content).fights) {
    draft.tierIndex += 1;
    draft.fightIndex = 0;
  }
  if (draft.tierIndex >= content.ladder.length) {
    draft.encounter = null;
    draft.phase = RUN_PHASE.VICTORY;
    return;
  }
  pickEncounter(draft, content, random);
}

/**
 * Starts a run with a planeswalker and one of the starter decks it may use.
 * `seed` makes the whole run reproducible (random when omitted).
 */
export function startRun(content, { planeswalkerId, deckId, seed = Math.floor(Math.random() * 2 ** 32) }) {
  const walker = content.planeswalkers[planeswalkerId];
  if (!walker) throw new Error(`Unknown planeswalker: ${planeswalkerId}`);
  if (!startingDecks(content, planeswalkerId).includes(deckId)) {
    throw new Error(`${walker.name} can't start with deck "${deckId}".`);
  }
  const run = {
    version: RUN_VERSION,
    seed: seed >>> 0,
    rng: seededRandom(seed).getState(),
    planeswalkerId,
    starterDeckId: deckId,
    deck: [...content.starterDecks[deckId].cards],
    emblems: [...walker.emblems],
    /** Extra activations per turn, by emblem id (POWER.ACTIVATIONS). */
    emblemBonuses: {},
    /** Power ids gained, in order (repeatable ones may repeat). */
    powers: [],
    startingLife: walker.startingLife ?? STARTING_LIFE,
    lives: rulesOf(content).lives,
    tierIndex: 0,
    fightIndex: 0,
    /** Opponents beaten or skipped, so a tier doesn't repeat them. */
    faced: [],
    phase: RUN_PHASE.FIGHT,
    encounter: null,
    offers: [],
    /** `{ tierId, opponentId, result: 'won' | 'lost' | 'skipped', reward? }` per fight played or skipped. */
    history: [],
  };
  return update(run, (draft, random) => pickEncounter(draft, content, random));
}

/** The starter decks a planeswalker may begin with (all of them unless it lists some). */
export function startingDecks(content, planeswalkerId) {
  return content.planeswalkers[planeswalkerId]?.decks ?? Object.keys(content.starterDecks);
}

/**
 * Everything needed to play the current fight:
 * - `game`: options for `new Game(game)`;
 * - `cpu`: `{ playerId, opponentId, name, ai }` for createCpuController (cpu.js),
 *   where `ai.weights` defaults to the opponent's id (see weightsFor);
 * - `encounter`: `{ tierId, tierName, boss, opponentId, opponentName }` to show.
 * The starting player alternates with the encounter's seed.
 */
export function matchSetup(run, content, { playerId = 'player', cpuId = 'cpu', playerName = 'You' } = {}) {
  expectPhase(run, RUN_PHASE.FIGHT);
  const { opponentId, seed } = run.encounter;
  const opponent = content.opponents[opponentId];
  const tier = currentTier(run, content);
  const emblemDefinitions = { ...content.emblems };
  // An emblem with extra activations gets its own id, so a CPU with the same emblem isn't upgraded too.
  const playerEmblems = run.emblems.map((id) => {
    const bonus = run.emblemBonuses[id] ?? 0;
    if (bonus === 0) return id;
    const base = emblemsOf(content)[id];
    const upgraded = `${id}+${bonus}`;
    emblemDefinitions[upgraded] = { ...base, id: upgraded, activationsPerTurn: (base.activationsPerTurn ?? Infinity) + bonus };
    return upgraded;
  });
  const players = [{ id: playerId, name: playerName }, { id: cpuId, name: opponent.name }];
  return {
    game: {
      players,
      startingPlayerId: players[seed % 2].id,
      seed,
      cards: { ...content.cards },
      decks: { [playerId]: [...run.deck], [cpuId]: [...opponent.deck] },
      emblems: { [playerId]: playerEmblems, [cpuId]: [...(opponent.emblems ?? [])] },
      emblemDefinitions,
      startingLife: { [playerId]: run.startingLife, [cpuId]: opponent.startingLife ?? STARTING_LIFE },
      limits: { ...rulesOf(content).limits },
      mulligans: rulesOf(content).mulligans,
    },
    cpu: {
      playerId: cpuId, opponentId, name: opponent.name, ai: { ...opponent.ai, weights: opponent.ai.weights ?? opponentId },
    },
    encounter: {
      tierId: tier.id, tierName: tier.name, boss: Boolean(tier.boss), opponentId, opponentName: opponent.name,
    },
  };
}

/** Whether the run can still gain a power (repeatable ones always can). */
function powerAvailable(run, content, powerId) {
  const power = content.powers[powerId];
  if (power.kind === POWER.EMBLEM) {
    return !run.emblems.includes(power.emblemId)
      && abilityCount(content, [...run.emblems, power.emblemId]) <= rulesOf(content).maxAbilities;
  }
  if (power.repeatable) return true;
  if ((power.kind === POWER.ACTIVATIONS || power.kind === POWER.UPGRADE) && !run.emblems.includes(power.emblemId)) return false;
  return !run.powers.includes(powerId);
}

/** The offers after a win in the current tier. */
function rewardOffers(draft, content, random) {
  const tier = currentTier(draft, content);
  const rewards = rewardsOf(content, tier);
  const pool = poolFor(content, draft.planeswalkerId, tier.cardPool);
  const powers = content.planeswalkers[draft.planeswalkerId].powers ?? [];
  return [
    ...pick(pool, rewards.cards, random).map((cardId) => ({ kind: REWARD.CARD, cardId })),
    ...pick(powers.filter((id) => powerAvailable(draft, content, id)), rewards.powers, random)
      .map((powerId) => ({ kind: REWARD.POWER, powerId })),
    ...(rewards.removeCard && draft.deck.length > rulesOf(content).minDeckSize ? [{ kind: REWARD.REMOVE_CARD }] : []),
  ];
}

/**
 * Records the result of the current fight. A win leads to rewards (`run.offers`),
 * or to victory after the last fight; a loss costs a life.
 */
export function recordResult(run, content, { won }) {
  expectPhase(run, RUN_PHASE.FIGHT);
  return update(run, (draft, random) => {
    const { tierId, opponentId } = draft.encounter;
    draft.history.push({ tierId, opponentId, result: won ? 'won' : 'lost' });
    if (!won) {
      draft.lives -= 1;
      draft.phase = draft.lives > 0 ? RUN_PHASE.DEFEATED : RUN_PHASE.OVER;
      return;
    }
    draft.faced.push(opponentId);
    const last = draft.tierIndex === content.ladder.length - 1 && draft.fightIndex === currentTier(draft, content).fights - 1;
    if (last) {
      draft.encounter = null;
      draft.phase = RUN_PHASE.VICTORY;
      return;
    }
    draft.offers = rewardOffers(draft, content, random);
    draft.phase = RUN_PHASE.REWARD;
  });
}

function applyPower(draft, power) {
  switch (power.kind) {
    case POWER.EMBLEM: draft.emblems.push(power.emblemId); break;
    case POWER.ACTIVATIONS:
      draft.emblemBonuses[power.emblemId] = (draft.emblemBonuses[power.emblemId] ?? 0) + (power.amount ?? 1);
      break;
    case POWER.STARTING_LIFE: draft.startingLife += power.amount; break;
    case POWER.EXTRA_LIFE: draft.lives += power.amount ?? 1; break;
    case POWER.UPGRADE: {
      draft.emblems = draft.emblems.map((id) => (id === power.emblemId ? power.to : id));
      // Extra uses already gained carry over to the better emblem.
      const bonus = draft.emblemBonuses[power.emblemId];
      if (bonus) {
        draft.emblemBonuses[power.to] = (draft.emblemBonuses[power.to] ?? 0) + bonus;
        delete draft.emblemBonuses[power.emblemId];
      }
      break;
    }
    default: throw new Error(`Unknown power kind: ${power.kind}`);
  }
}

/**
 * Takes offer `index` of `run.offers` and moves on to the next fight. Removing a
 * card needs `{ cardId }`: one card of that id in the deck.
 */
export function chooseReward(run, content, index, { cardId } = {}) {
  expectPhase(run, RUN_PHASE.REWARD);
  const offer = run.offers[index];
  if (!offer) throw new Error(`There is no offer ${index}.`);
  return update(run, (draft, random) => {
    switch (offer.kind) {
      case REWARD.CARD: draft.deck.push(offer.cardId); break;
      case REWARD.POWER:
        applyPower(draft, content.powers[offer.powerId]);
        draft.powers.push(offer.powerId);
        break;
      case REWARD.REMOVE_CARD: {
        const at = draft.deck.indexOf(cardId);
        if (at === -1) throw new Error(`The deck has no "${cardId}" to remove.`);
        if (draft.deck.length <= rulesOf(content).minDeckSize) throw new Error('The deck is already at its minimum size.');
        draft.deck.splice(at, 1);
        break;
      }
      default: throw new Error(`Unknown reward kind: ${offer.kind}`);
    }
    draft.history.at(-1).reward = offer.kind === REWARD.REMOVE_CARD ? { ...offer, cardId } : offer;
    advance(draft, content, random);
  });
}

/** Declines the rewards and moves on to the next fight. */
export function skipReward(run, content) {
  expectPhase(run, RUN_PHASE.REWARD);
  return update(run, (draft, random) => advance(draft, content, random));
}

/** After a loss: fight the same opponent again (with a new shuffle). */
export function retryFight(run) {
  expectPhase(run, RUN_PHASE.DEFEATED);
  return update(run, (draft, random) => {
    draft.encounter = { ...draft.encounter, seed: newSeed(random) };
    draft.phase = RUN_PHASE.FIGHT;
  });
}

/** Whether the current fight can be skipped after a loss (not a boss). */
export const canSkipFight = (run, content) => run.phase === RUN_PHASE.DEFEATED && !currentTier(run, content).boss;

/** After a loss: move on without a reward. Bosses can't be skipped. */
export function skipFight(run, content) {
  expectPhase(run, RUN_PHASE.DEFEATED);
  if (!canSkipFight(run, content)) throw new Error('A boss can\'t be skipped.');
  return update(run, (draft, random) => {
    const { tierId, opponentId } = draft.encounter;
    draft.faced.push(opponentId);
    draft.history.push({ tierId, opponentId, result: 'skipped' });
    advance(draft, content, random);
  });
}

/**
 * Problems with campaign content, as messages (empty when it's all consistent):
 * unknown cards, emblems, powers and opponents, small decks, and tiers that can't
 * be played. Run it in a test whenever content changes.
 */
export function validateCampaign(content) {
  const problems = [];
  const cards = cardsOf(content);
  const emblems = emblemsOf(content);
  const { minDeckSize, maxAbilities } = rulesOf(content);
  const checkAbilities = (where, ids = []) => {
    const count = abilityCount(content, ids);
    if (count > maxAbilities) problems.push(`${where}: ${count} abilities, more than ${maxAbilities}`);
  };
  const checkCards = (where, ids) => {
    for (const id of new Set(ids)) if (!cards[id]) problems.push(`${where}: unknown card "${id}"`);
  };
  const checkEmblems = (where, ids = []) => {
    for (const id of ids) if (!emblems[id]) problems.push(`${where}: unknown emblem "${id}"`);
  };
  const checkDeck = (where, deck) => {
    if (!Array.isArray(deck)) return problems.push(`${where}: no deck`);
    checkCards(where, deck);
    if (deck.length < minDeckSize) problems.push(`${where}: ${deck.length} cards, fewer than ${minDeckSize}`);
  };

  const walkers = Object.entries(content.planeswalkers ?? {});
  if (walkers.length === 0) problems.push('no planeswalkers');
  for (const [id, walker] of walkers) {
    checkEmblems(`planeswalker ${id}`, walker.emblems);
    checkAbilities(`planeswalker ${id}`, walker.emblems);
    for (const powerId of walker.powers ?? []) {
      if (!content.powers?.[powerId]) problems.push(`planeswalker ${id}: unknown power "${powerId}"`);
    }
    for (const deckId of walker.decks ?? []) {
      if (!content.starterDecks?.[deckId]) problems.push(`planeswalker ${id}: unknown starter deck "${deckId}"`);
    }
    if (walker.cardPool && !content.cardPools?.[walker.cardPool]) problems.push(`planeswalker ${id}: unknown card pool "${walker.cardPool}"`);
    // Every tier should have card rewards in the planeswalker's colors.
    for (const tier of content.ladder ?? []) {
      if (!tier.cardPool || !content.cardPools?.[tier.cardPool]) continue;
      const wanted = rewardsOf(content, tier).cards;
      const fits = new Set(poolFor(content, id, tier.cardPool)).size;
      if (fits < wanted) problems.push(`planeswalker ${id}: card pool ${tier.cardPool} has ${fits} cards in its colors, fewer than ${wanted}`);
    }
  }
  const decks = Object.entries(content.starterDecks ?? {});
  if (decks.length === 0) problems.push('no starter decks');
  for (const [id, deck] of decks) checkDeck(`starter deck ${id}`, deck.cards);

  for (const [id, power] of Object.entries(content.powers ?? {})) {
    if (!Object.values(POWER).includes(power.kind)) problems.push(`power ${id}: unknown kind "${power.kind}"`);
    if (power.kind === POWER.EMBLEM || power.kind === POWER.ACTIVATIONS) checkEmblems(`power ${id}`, [power.emblemId]);
    if (power.kind === POWER.UPGRADE) checkEmblems(`power ${id}`, [power.emblemId, power.to]);
    if (power.kind === POWER.STARTING_LIFE && !(power.amount > 0)) problems.push(`power ${id}: needs a positive amount`);
  }

  for (const [id, opponent] of Object.entries(content.opponents ?? {})) {
    checkDeck(`opponent ${id}`, opponent.deck);
    checkEmblems(`opponent ${id}`, opponent.emblems);
    checkAbilities(`opponent ${id}`, opponent.emblems);
    if (!Object.values(AI_KIND).includes(opponent.ai?.kind)) problems.push(`opponent ${id}: unknown AI kind "${opponent.ai?.kind}"`);
  }

  for (const [id, pool] of Object.entries(content.cardPools ?? {})) checkCards(`card pool ${id}`, pool);

  const ladder = content.ladder ?? [];
  if (ladder.length === 0) problems.push('the ladder has no tiers');
  ladder.forEach((tier, i) => {
    const where = `tier ${tier.id ?? i}`;
    if (!(tier.fights >= 1)) problems.push(`${where}: needs at least one fight`);
    if (!tier.opponents?.length) problems.push(`${where}: no opponents`);
    for (const opponentId of tier.opponents ?? []) {
      if (!content.opponents?.[opponentId]) problems.push(`${where}: unknown opponent "${opponentId}"`);
    }
    if (tier.opponents?.length < tier.fights) problems.push(`${where}: fewer opponents than fights`);
    if (tier.cardPool && !content.cardPools?.[tier.cardPool]) problems.push(`${where}: unknown card pool "${tier.cardPool}"`);
    if (tier.boss && i !== ladder.length - 1) problems.push(`${where}: only the last tier can be a boss`);
  });
  return problems;
}

/**
 * Problems with a (saved) run against the current content, e.g. after a card or
 * opponent was removed. Empty when the run can carry on.
 */
export function validateRun(run, content) {
  const problems = [];
  const cards = cardsOf(content);
  const emblems = emblemsOf(content);
  if (run?.version !== RUN_VERSION) return [`run version ${run?.version}, expected ${RUN_VERSION}`];
  if (!content.planeswalkers[run.planeswalkerId]) problems.push(`unknown planeswalker "${run.planeswalkerId}"`);
  if (!Object.values(RUN_PHASE).includes(run.phase)) problems.push(`unknown phase "${run.phase}"`);
  for (const id of new Set(run.deck)) if (!cards[id]) problems.push(`unknown card "${id}"`);
  for (const id of run.emblems) if (!emblems[id]) problems.push(`unknown emblem "${id}"`);
  for (const id of run.powers) if (!content.powers[id]) problems.push(`unknown power "${id}"`);
  const finished = run.phase === RUN_PHASE.VICTORY || run.phase === RUN_PHASE.OVER;
  if (!finished) {
    const tier = currentTier(run, content);
    if (!tier) problems.push(`no tier ${run.tierIndex}`);
    else if (run.fightIndex >= tier.fights) problems.push(`tier ${tier.id} has no fight ${run.fightIndex}`);
    if (!content.opponents[run.encounter?.opponentId]) problems.push(`unknown opponent "${run.encounter?.opponentId}"`);
  }
  for (const offer of run.offers ?? []) {
    if (offer.kind === REWARD.CARD && !cards[offer.cardId]) problems.push(`offer of unknown card "${offer.cardId}"`);
    if (offer.kind === REWARD.POWER && !content.powers[offer.powerId]) problems.push(`offer of unknown power "${offer.powerId}"`);
  }
  return problems;
}
