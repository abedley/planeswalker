import { EventEmitter } from './EventEmitter.js';
import { ACTION } from './actions.js';
import { TURN_STRUCTURE, PHASE, STEP, PHASE_NAMES, STEP_NAMES } from './turnStructure.js';
import { seededRandom, shuffle } from './random.js';
import {
  CARDS, DEFAULT_DECK, EFFECT, KEYWORD, ACTIVATION_TIMING, TARGET, AFFECTED, COUNTER, CARD_TYPE, SPELL_TARGETS, TRIGGER,
  isLand, isCreature, isAura, isEquipment, isPermanentCard, isManaAbility, hasKeyword, anthemApplies,
  abilityEffects, effectAffects, matchesPermanentKind, TOKENS, COLORS_OF_MANA, needsManaColor, castsAtInstantSpeed,
  isLegendary, matchesFilter, countOf, TOKEN, scaleEffect, spellCost, canBlockCreature, colorsOf, tokenCardId, creatureTokenName,
  targetKindOf, targetFilterOf, isOptionalTarget, targetList, GRAVEYARD_TARGETS, triggersOn, WATCHER_TRIGGERS, isSaga,
  isInstant, isSorcery, isArtifact, isToken, withX, amassArmyToken, reduceGeneric, manaValue, COLORS_OF_MANA as COLORS, hasSubtype,
} from '../cards/cards.js';
import { blocksLegal } from './blockRules.js';
import { EMBLEMS, DEFAULT_EMBLEMS } from '../cards/emblems.js';
import {
  emptyManaPool, addMana, planManaPayment, canPayMana, manaPoolTotal, MANA_TYPES, formatMana,
} from './mana.js';

export const GAME_STATUS = Object.freeze({
  NOT_STARTED: 'notStarted',
  IN_PROGRESS: 'inProgress',
  GAME_OVER: 'gameOver',
});

export const DECISION = Object.freeze({
  DISCARD_TO_HAND_SIZE: 'discardToHandSize',
  DECLARE_ATTACKERS: 'declareAttackers',
  DECLARE_BLOCKERS: 'declareBlockers',
  ASSIGN_COMBAT_DAMAGE: 'assignCombatDamage',
  /**
   * A triggered ability with more than one legal target is being put on the stack
   * (603.3d). With `optional` ("you may"), the player may also decline (`targets: []`).
   */
  CHOOSE_TARGETS: 'chooseTargets',
  /** A modal triggered ability ("choose one —", 700.2) is being put on the stack: `options` lists the choices. */
  CHOOSE_MODE: 'chooseMode',
  /** 704.5j: the player controls legendary permanents with the same name (`cardIds`) and keeps one. */
  LEGEND_RULE: 'legendRule',
  /** 103.5: keep the opening hand or mulligan (`mulligans` taken so far). */
  MULLIGAN: 'mulligan',
  /** 103.5 (London mulligan): put `count` cards from the kept hand on the bottom of the library. */
  PUT_ON_BOTTOM: 'putOnBottom',
  /**
   * A choice made while a spell or ability resolves: one of `options` (ids, or words such
   * as 'decline'). `kind` says what it's for (see CHOICE); `cards` shows the cards the
   * player looks at (a revealed hand, a searched library), to that player only.
   */
  CHOOSE: 'choose',
  /**
   * Several choices at once, made one toggle at a time (`selected`, in order), between `min`
   * and `max` of `options`, then confirmed. Scrying is one: `selected` is what stays on top.
   */
  CHOOSE_MANY: 'chooseMany',
});

/** What a DECISION.CHOOSE or CHOOSE_MANY is for. */
export const CHOICE = Object.freeze({
  /** 701.54a: the creature that becomes your Ring-bearer. */
  RING_BEARER: 'ringBearer',
  /** 701.47a: the Army that gets the counters, when you control several. */
  ARMY: 'army',
  /** A permanent to sacrifice (701.17a), chosen by the player who sacrifices it. */
  SACRIFICE: 'sacrifice',
  /** A card to discard from your hand (701.8a). */
  DISCARD: 'discard',
  /** A card from an opponent's revealed hand, which they discard. */
  REVEALED_CARD: 'revealedCard',
  /** Cards found searching a library (701.19). */
  SEARCH: 'search',
  /** A card from your hand to put on the bottom of your library. */
  BOTTOM_FROM_HAND: 'bottomFromHand',
  /** "your choice of first strike or vigilance": a keyword. */
  KEYWORD: 'keyword',
  /** "You may …": 'yes' or 'no'. */
  MAY: 'may',
  /** "You may sacrifice a Food or pay {2}{W}": the index of the cost paid, or 'decline'. */
  OPTIONAL_COST: 'optionalCost',
  /** "… unless you pay …" (ward): 'pay' or 'decline'. */
  PAY: 'pay',
  /** Long List of the Ents: a creature type. */
  CREATURE_TYPE: 'creatureType',
  /** A card from your graveyard (Rise of the Witch-king). */
  GRAVEYARD_CARD: 'graveyardCard',
  /** A card from your hand to put onto the battlefield (Shadowfax). */
  HAND_CARD: 'handCard',
  /** 701.22a: the cards to keep on top, in order; the rest go to the bottom. */
  SCRY: 'scry',
  /** Cards from your graveyard (The Bath Song). */
  GRAVEYARD_CARDS: 'graveyardCards',
  /** Cards looked at on top of your library to put into your hand (Horn of the Mark); the rest go on the bottom. */
  LOOK: 'look',
  /** Cards to exile from your hand (Isildur's Fateful Strike). */
  EXILE_FROM_HAND: 'exileFromHand',
  /** Creatures to keep; the rest are destroyed (Mount Doom). */
  KEEP: 'keep',
  /** Creature cards from your hand to put onto the battlefield (Last March of the Ents). */
  HAND_CARDS: 'handCards',
  /** Cards from your graveyard to exile as part of a cost (Mines of Moria), chosen as it's paid (601.2h). */
  EXILE_COST: 'exileCost',
});

export const STARTING_LIFE = 20; // 103.4
export const OPENING_HAND_SIZE = 7; // 103.5
export const MAX_HAND_SIZE = 8; // 402.2 (house rule; the comprehensive rules say 7)
export const LAND_PLAYS_PER_TURN = 1; // 305.2

/**
 * Limits this game imposes on top of Magic's rules, so a whole board fits on a
 * phone screen (pass them as the `limits` option; a game has none by default):
 * - `hand`: a card drawn into, or returned to, a full hand is burned (put into
 *   the graveyard, with a `cardBurned` event);
 * - `creatures`: creature spells can't be cast, and creature tokens aren't
 *   created, once a player controls that many creatures (counting their creature
 *   spells on the stack);
 * - `permanents`: the same for other nonland permanents (artifacts, enchantments,
 *   Treasure and other tokens).
 */
export const GAME_LIMITS = Object.freeze({ hand: 7, creatures: 10, permanents: 8 });

const MAIN_PHASES = new Set([PHASE.PRECOMBAT_MAIN, PHASE.POSTCOMBAT_MAIN]);

/** Recursive structural equality for plain JSON-like values. */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => deepEqual(a[key], b[key]));
}

const emptyCombat = () => ({ declaredAttackers: [], attackers: [] });

/** What a player did this turn (reset as each turn begins). */
const emptyTally = () => ({
  cardsDrawn: 0,
  spellsCast: 0,
  creatureDied: false,
  /** How many creatures died under this player's control (Gimli, Mournful Avenger). */
  creaturesDied: 0,
  /** How many permanents this player sacrificed (The Balrog). */
  sacrificed: 0,
  /** The most creatures this player attacked with in one combat (Minas Tirith). */
  attackedWith: 0,
  permanentLeft: false,
  /** "triggers only once each turn": `sourceId:abilityId` keys. */
  triggered: {},
  /** "the second time this ability has resolved this turn": counts by `sourceId:abilityId`. */
  resolved: {},
  /** Long List of the Ents: creature types whose next creature spell this turn gets a counter. */
  notedTypes: [],
});

/** Every way to split `amount` among `ids`, as `{ [id]: n }` objects. */
function distributions(amount, ids) {
  if (ids.length === 1) return [{ [ids[0]]: amount }];
  const [first, ...rest] = ids;
  const result = [];
  for (let n = amount; n >= 0; n--) {
    for (const tail of distributions(amount - n, rest)) result.push({ [first]: n, ...tail });
  }
  return result;
}

/**
 * Fields that never change once a card, ability or stack object exists, so copies
 * of a game can share them instead of copying them.
 */
const IMMUTABLE_FIELDS = new Set([
  'abilities', 'triggeredAbilities', 'staticAbilities', 'spell', 'manaCost', 'types', 'subtypes', 'supertypes', 'additionalCost',
  'colors', 'effects', 'handAbilities', 'graveyardAbilities', 'costReduction', 'modes',
]);

/**
 * A deep copy of plain game data (snapshots, player views) that shares
 * IMMUTABLE_FIELDS with the original: much faster than structuredClone.
 */
export function copyGameData(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(copyGameData);
  const copy = {};
  for (const key of Object.keys(value)) copy[key] = IMMUTABLE_FIELDS.has(key) ? value[key] : copyGameData(value[key]);
  return copy;
}

/** What was paid for a cost, as events show it (without the copies of sacrificed permanents kept for the resolution). */
const publicPaid = ({ sacrificedObjects: _, ...paid }) => paid;

/** Two mana costs added together (either may be missing). */
function addCosts(a, b) {
  if (!b) return a;
  const sum = { ...(a ?? {}) };
  for (const [type, n] of Object.entries(b)) sum[type] = (sum[type] ?? 0) + n;
  return sum;
}

/** Every way to choose `n` of `ids`, in order. */
function combinations(ids, n) {
  if (n === 0) return [[]];
  return ids.flatMap((id, i) => combinations(ids.slice(i + 1), n - 1).map((rest) => [id, ...rest]));
}

/**
 * The game engine.
 *
 * Output: the game is an EventEmitter. Fine-grained events (`turnStarted`,
 * `stepStarted`, `cardsDrawn`, `spellCast`, `combatDamageDealt`, ...) describe each
 * transition, and a `state` event is emitted whenever the game settles and waits
 * for player input. Every `state` payload is a full snapshot that includes
 * `validActions`.
 *
 * The game waits for input in one of two ways: a player has priority, or a player
 * must make a decision (`pendingDecision`), such as declaring attackers.
 *
 * Input: player actions arrive through `dispatch(action)`, or by having the game
 * listen to any emitter that emits `action` events (see `listenTo`). Actions
 * dispatched while another action is being processed (e.g. by a listener
 * reacting to a `state` event) are queued and processed in order.
 */
export class Game extends EventEmitter {
  #players;
  #cardDefinitions;
  #emblemDefinitions;
  #zones = new Map(); // playerId -> { library, hand, graveyard, manaPool, life, ... }
  #battlefield = [];
  #startingPlayerId;
  #random;
  #shuffleLibraries;
  #mulligans = false;
  #status = GAME_STATUS.NOT_STARTED;
  #winnerId = null;
  #turn = 0;
  #activePlayerId = null;
  #priorityPlayerId = null;
  #pendingDecision = null;
  #segmentIndex = -1;
  #playersPassed = [];
  #stack = []; // last element is the top of the stack
  #nextStackObjectId = 1;
  /** Abilities that have triggered but aren't on the stack yet (603.3), oldest first. */
  #pendingTriggers = [];
  #nextTriggerId = 1;
  #combat = emptyCombat();
  /** Continuous effects from resolved spells, e.g. "+3/+3 until end of turn" (611.2). */
  #temporaryEffects = [];
  #nextEffectId = 1;
  #nextTokenNumber = 1;
  /**
   * The spell or ability resolving right now, while it waits for a choice (608.2c):
   * `{ stackObject, controllerId, frames: [{ effects, index }], context }`.
   */
  #resolving = null;
  /** 603.7: delayed triggered abilities, `{ at: 'endOfCombat', controllerId, sourceId, ... }`. */
  #delayedTriggers = [];
  #version = 0;
  #eventSeq = 0;
  #queue = [];
  #processing = false;
  #silent = false;
  #limits = {};

  /**
   * @param {object} options
   * @param {{id: string, name?: string}[]} options.players Players in turn order.
   * @param {string} [options.startingPlayerId] Defaults to the first player.
   * @param {Record<string, string[]>} [options.decks] Card ids per player id.
   *   Players without a deck get DEFAULT_DECK (20 Forests, 20 Llanowar Elves).
   * @param {number} [options.seed] Seed for shuffling; random when omitted.
   * @param {Record<string, object>} [options.cards] Extra card definitions, merged over CARDS.
   * @param {boolean} [options.shuffleLibraries] Set false to keep decks in the given order,
   *   so the first cards listed are the opening hand (handy for tests and puzzles).
   * @param {Record<string, string[]>} [options.emblems] Emblem ids per player id. Players
   *   without an entry get DEFAULT_EMBLEMS.
   * @param {Record<string, object>} [options.emblemDefinitions] Extra emblem definitions,
   *   merged over EMBLEMS.
   * @param {Record<string, number>} [options.startingLife] Starting life per player id
   *   (default STARTING_LIFE), e.g. for a boss or a planeswalker's upgrades.
   * @param {{hand?: number, creatures?: number, permanents?: number}} [options.limits] See GAME_LIMITS.
   * @param {boolean} [options.silent] Emit no events at all, for fast simulations (AI search).
   * @param {boolean} [options.mulligans] Let players mulligan their opening hands (103.5, the
   *   London mulligan): otherwise everyone keeps the seven cards they draw.
   */
  constructor({
    players, startingPlayerId, decks = {}, seed, cards = {}, shuffleLibraries = true,
    emblems = {}, emblemDefinitions = {}, startingLife = {}, limits = {}, silent = false, mulligans = false,
  } = {}) {
    super();
    if (!Array.isArray(players) || players.length < 2) {
      throw new Error('A game needs at least two players.');
    }
    const ids = new Set(players.map((p) => p.id));
    if (ids.size !== players.length) throw new Error('Player ids must be unique.');
    this.#players = players.map(({ id, name }) => Object.freeze({ id, name: name ?? id }));
    this.#startingPlayerId = startingPlayerId ?? this.#players[0].id;
    if (!ids.has(this.#startingPlayerId)) {
      throw new Error(`Unknown starting player: ${this.#startingPlayerId}`);
    }
    this.#random = seededRandom(seed ?? Math.floor(Math.random() * 2 ** 32));
    this.#cardDefinitions = { ...CARDS, ...cards };
    this.#emblemDefinitions = { ...EMBLEMS, ...emblemDefinitions };
    this.#shuffleLibraries = shuffleLibraries;
    this.#mulligans = mulligans;
    this.#silent = silent;
    this.#limits = { ...limits };

    for (const { id } of this.#players) {
      const deck = decks[id] ?? DEFAULT_DECK;
      const library = deck.map((cardId, i) => this.#createCard(cardId, id, `${id}-${i + 1}`));
      this.#zones.set(id, {
        library,
        hand: [],
        graveyard: [],
        exile: [],
        manaPool: emptyManaPool(),
        // 114.1: emblems live in the command zone.
        emblems: (emblems[id] ?? DEFAULT_EMBLEMS).map((emblemId, i) => this.#createEmblem(emblemId, id, i + 1)),
        life: startingLife[id] ?? STARTING_LIFE,
        landsPlayedThisTurn: 0,
        // What the other players have seen of the cards in this hand (see #noteHand).
        handNotes: {},
        attemptedDrawFromEmptyLibrary: false,
        hasLost: false,
        // 701.54: the Ring that tempts this player, and how many times it has (its abilities, up to 4).
        ring: { level: 0, bearerId: null },
        // Mana that can be spent as any color, some of it only on some spells (see mana.js).
        specialMana: [],
        // What happened this turn, for "this turn" conditions and triggers.
        turnTally: emptyTally(),
      });
    }
  }

  // Read-only views used by turn-structure skip rules.
  get turn() { return this.#turn; }
  get combat() { return this.#combat; }

  /** 510.4: whether an attacking or blocking creature has first strike or double strike. */
  get combatHasFirstStrike() {
    const ids = this.#combat.attackers.flatMap((a) => [a.cardId, ...a.blockerIds]);
    return ids.some((id) => {
      const creature = this.#permanent(id);
      return hasKeyword(creature, KEYWORD.FIRST_STRIKE) || hasKeyword(creature, KEYWORD.DOUBLE_STRIKE);
    });
  }

  start() {
    if (this.#status !== GAME_STATUS.NOT_STARTED) throw new Error('Game already started.');
    this.#runExclusive(() => {
      this.#status = GAME_STATUS.IN_PROGRESS;
      this.#emitEvent('gameStarted', {
        players: this.#players.map((p) => ({ ...p })),
        startingPlayerId: this.#startingPlayerId,
      });
      for (const { id } of this.#players) {
        // 103.3: each player shuffles their deck; 103.5: then draws an opening hand.
        if (this.#shuffleLibraries) {
          shuffle(this.#zones.get(id).library, this.#random);
          this.#emitEvent('libraryShuffled', { playerId: id });
        }
        this.#drawCards(id, OPENING_HAND_SIZE);
      }
      if (this.#mulligans) {
        // 103.5: starting with the starting player, each player in turn order decides.
        const order = [this.#startingPlayerId];
        while (order.length < this.#players.length) order.push(this.#nextPlayerId(order.at(-1)));
        this.#offerMulligan(order);
      } else this.#startFirstTurn();
      this.#emitState();
    });
  }

  /**
   * Submit a player action. Returns `{ ok, reason? }` when processed immediately,
   * or `{ ok: true, queued: true }` when dispatched from inside an event listener.
   */
  dispatch(action) {
    this.#queue.push(action);
    if (this.#processing) return { ok: true, queued: true };
    return this.#runExclusive();
  }

  /** Dispatch every `eventName` event emitted by `emitter`. Returns an unsubscribe function. */
  listenTo(emitter, eventName = 'action') {
    return emitter.on(eventName, (action) => this.dispatch(action));
  }

  getValidActions(playerId) {
    let actions = [];
    if (this.#status !== GAME_STATUS.IN_PROGRESS) return actions;
    if (this.#pendingDecision) {
      actions = this.#decisionActions(this.#pendingDecision);
    } else if (this.#priorityPlayerId) {
      actions = this.#priorityActions(this.#priorityPlayerId);
    }
    return playerId === undefined ? actions : actions.filter((a) => a.playerId === playerId);
  }

  /** A snapshot of the state for players and UIs, including `validActions`. */
  getState() {
    return structuredClone(this.peekState());
  }

  /**
   * Like getState(), but without copying: the objects are the game's own, so they
   * must not be changed, and they change as the game goes on. For fast AI simulations.
   */
  peekState() {
    const segment = this.#segment;
    return {
      version: this.#version,
      status: this.#status,
      winnerId: this.#winnerId,
      turn: this.#turn,
      players: this.#players.map((player) => {
        const zone = this.#zones.get(player.id);
        return {
          ...player,
          life: zone.life,
          library: zone.library,
          hand: zone.hand,
          graveyard: zone.graveyard,
          exile: zone.exile,
          manaPool: zone.manaPool,
          emblems: zone.emblems,
          landsPlayedThisTurn: zone.landsPlayedThisTurn,
          hasLost: zone.hasLost,
          ring: zone.ring,
          specialMana: zone.specialMana,
          turnTally: zone.turnTally,
        };
      }),
      battlefield: this.#battlefield,
      startingPlayerId: this.#startingPlayerId,
      activePlayerId: this.#activePlayerId,
      priorityPlayerId: this.#priorityPlayerId,
      pendingDecision: this.#pendingDecision,
      phase: segment?.phase ?? null,
      phaseName: segment ? PHASE_NAMES[segment.phase] : null,
      step: segment?.step ?? null,
      stepName: segment?.step ? STEP_NAMES[segment.step] : null,
      segmentIndex: this.#segmentIndex,
      playersPassed: this.#playersPassed,
      stack: this.#stack,
      pendingTriggers: this.#pendingTriggers,
      combat: this.#combat,
      temporaryEffects: this.#temporaryEffects,
      resolving: this.#resolving,
      validActions: this.getValidActions(),
    };
  }

  // ---------------------------------------------------------------------------
  // Snapshots, for saving games and for AI search

  /** Every field of the game, by reference (see serialize() for a copy). */
  #snapshot() {
    return {
      players: this.#players,
      startingPlayerId: this.#startingPlayerId,
      randomState: this.#random.getState(),
      shuffleLibraries: this.#shuffleLibraries,
      mulligans: this.#mulligans,
      limits: this.#limits,
      status: this.#status,
      winnerId: this.#winnerId,
      turn: this.#turn,
      activePlayerId: this.#activePlayerId,
      priorityPlayerId: this.#priorityPlayerId,
      pendingDecision: this.#pendingDecision,
      segmentIndex: this.#segmentIndex,
      playersPassed: this.#playersPassed,
      stack: this.#stack,
      pendingTriggers: this.#pendingTriggers,
      combat: this.#combat,
      temporaryEffects: this.#temporaryEffects,
      resolving: this.#resolving,
      delayedTriggers: this.#delayedTriggers,
      zones: Object.fromEntries(this.#zones),
      battlefield: this.#battlefield,
      counters: {
        nextStackObjectId: this.#nextStackObjectId,
        nextTriggerId: this.#nextTriggerId,
        nextEffectId: this.#nextEffectId,
        nextTokenNumber: this.#nextTokenNumber,
        version: this.#version,
        eventSeq: this.#eventSeq,
      },
    };
  }

  /** Card definitions that aren't the built-in CARDS: custom cards and tokens created so far. */
  #customCardDefinitions() {
    return Object.fromEntries(Object.entries(this.#cardDefinitions).filter(([id, card]) => CARDS[id] !== card));
  }

  #customEmblemDefinitions() {
    return Object.fromEntries(Object.entries(this.#emblemDefinitions).filter(([id, emblem]) => EMBLEMS[id] !== emblem));
  }

  /**
   * The whole game as a plain object (it survives structuredClone and postMessage,
   * though not JSON, because of `Infinity` activation limits). It includes the
   * random number generator's state, so it reveals every hidden card and the
   * order of every library: give players getPlayerView() instead.
   */
  serialize() {
    return structuredClone({
      ...this.#snapshot(),
      cardDefinitions: this.#customCardDefinitions(),
      emblemDefinitions: this.#customEmblemDefinitions(),
    });
  }

  /** Rebuilds a game from serialize(). `silent` games emit no events. */
  static deserialize(snapshot, { silent = false } = {}) {
    const empty = Object.fromEntries(snapshot.players.map((p) => [p.id, []]));
    const game = new Game({
      players: snapshot.players,
      startingPlayerId: snapshot.startingPlayerId,
      cards: snapshot.cardDefinitions,
      emblemDefinitions: snapshot.emblemDefinitions,
      decks: empty,
      emblems: empty,
      limits: snapshot.limits,
      silent,
    });
    game.#restore(copyGameData(snapshot));
    return game;
  }

  /** An independent copy of the game, without listeners. */
  clone({ silent = true } = {}) {
    const copy = new Game({
      players: this.#players,
      startingPlayerId: this.#startingPlayerId,
      decks: Object.fromEntries(this.#players.map((p) => [p.id, []])),
      emblems: Object.fromEntries(this.#players.map((p) => [p.id, []])),
      limits: this.#limits,
      silent,
    });
    copy.#cardDefinitions = { ...this.#cardDefinitions };
    copy.#emblemDefinitions = this.#emblemDefinitions;
    copy.#restore(copyGameData(this.#snapshot()));
    return copy;
  }

  #restore(snapshot) {
    this.#random.setState(snapshot.randomState);
    this.#shuffleLibraries = snapshot.shuffleLibraries;
    this.#mulligans = snapshot.mulligans ?? false;
    this.#status = snapshot.status;
    this.#winnerId = snapshot.winnerId;
    this.#turn = snapshot.turn;
    this.#activePlayerId = snapshot.activePlayerId;
    this.#priorityPlayerId = snapshot.priorityPlayerId;
    this.#pendingDecision = snapshot.pendingDecision;
    this.#segmentIndex = snapshot.segmentIndex;
    this.#playersPassed = snapshot.playersPassed;
    this.#stack = snapshot.stack;
    this.#pendingTriggers = snapshot.pendingTriggers;
    this.#combat = snapshot.combat;
    this.#temporaryEffects = snapshot.temporaryEffects;
    this.#resolving = snapshot.resolving ?? null;
    this.#delayedTriggers = snapshot.delayedTriggers ?? [];
    this.#zones = new Map(Object.entries(snapshot.zones));
    // Snapshots from before the Ring and turn tallies existed.
    for (const zone of this.#zones.values()) {
      zone.ring ??= { level: 0, bearerId: null };
      zone.specialMana ??= [];
      zone.turnTally ??= emptyTally();
    }
    this.#battlefield = snapshot.battlefield;
    ({
      nextStackObjectId: this.#nextStackObjectId,
      nextTriggerId: this.#nextTriggerId,
      nextEffectId: this.#nextEffectId,
      nextTokenNumber: this.#nextTokenNumber,
      version: this.#version,
      eventSeq: this.#eventSeq,
    } = snapshot.counters);
  }

  /**
   * What `playerId` is allowed to know, as a snapshot without hidden information:
   * - the opponents' hands become `handSize`, and every library becomes `librarySize`
   * - `unknownCards[id]`: the cards whose place that player can't see, as card
   *   objects sorted by `cardId`, with `id: null`: their own library, and each
   *   opponent's hand and library together. (Knowing an opponent's deck list, but
   *   not where each card is, is the assumption.)
   * - no random number generator state, so future shuffles are unknown too.
   * - what's public about an opponent's hand: cards it got back from the
   *   battlefield stay in `hand`, and `handInfo` has one `{ noLand, heldWithMana }`
   *   per hidden card (see #noteHand), sorted. `handSize` counts both.
   * Pass it to determinize() (src/ai/determinize.js) to get playable guesses.
   */
  getPlayerView(playerId) {
    const snapshot = this.serialize();
    delete snapshot.randomState;
    snapshot.viewerId = playerId;
    snapshot.unknownCards = {};
    const hide = (card) => ({ ...card, id: null });
    const byCardId = (a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0);
    // While a player looks at cards of their library (scrying, searching), they know those cards.
    const decision = snapshot.pendingDecision;
    if (decision?.cards && decision.playerId !== playerId) delete decision.cards;
    const looking = decision?.playerId === playerId && (decision.libraryTop || decision.wholeLibrary);
    for (const [id, zone] of Object.entries(snapshot.zones)) {
      const known = looking && id === playerId ? zone.library.slice(0, decision.wholeLibrary ? zone.library.length : decision.libraryTop) : [];
      if (known.length) zone.knownTop = known;
      const unknown = zone.library.slice(known.length);
      zone.librarySize = zone.library.length;
      zone.library = [];
      const notes = zone.handNotes ?? {};
      delete zone.handNotes;
      if (id !== playerId) {
        const hidden = zone.hand.filter((card) => !notes[card.id]?.revealed);
        unknown.push(...hidden);
        zone.handSize = zone.hand.length;
        zone.hand = zone.hand.filter((card) => notes[card.id]?.revealed);
        zone.handInfo = hidden
          .map((card) => ({ noLand: notes[card.id]?.noLand ?? false, heldWithMana: notes[card.id]?.heldWithMana ?? 0 }))
          .sort((a, b) => a.noLand - b.noLand || a.heldWithMana - b.heldWithMana);
      }
      snapshot.unknownCards[id] = unknown.map(hide).sort(byCardId);
    }
    return snapshot;
  }

  /**
   * Applies an action taken from getValidActions() without checking it again, and
   * without the action queue. For fast AI simulations only.
   */
  applyTrusted(action) {
    this.#processing = true;
    try {
      this.#process(action, true);
    } finally {
      this.#processing = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Valid actions

  #priorityActions(holder) {
    const actions = [{ type: ACTION.PASS_PRIORITY, playerId: holder }];
    const zone = this.#zones.get(holder);
    const { hand } = zone;
    if (this.#canPlayLand(holder)) {
      for (const card of hand.filter(isLand)) {
        actions.push({ type: ACTION.PLAY_LAND, playerId: holder, cardId: card.id });
      }
    }
    const sorceryTiming = this.#hasSorceryTiming(holder);
    for (const card of hand.filter((c) => !isLand(c))) {
      // 304.1: instants can be cast whenever the player has priority. 307.1 / 301.1 /
      // 302.1 / 303.1: sorceries and permanent spells only at sorcery speed.
      // 702.8a: flash lets a permanent spell be cast at instant speed too.
      if (!this.#castsAtInstantSpeed(holder, card) && !sorceryTiming) continue;
      if (this.#atLimit(holder, card)) continue;
      // 205.4d: a legendary instant or sorcery can be cast only while its caster controls a legendary creature.
      if ((isInstant(card) || isSorcery(card)) && isLegendary(card)
        && !this.#battlefield.some((p) => p.controllerId === holder && isCreature(p) && isLegendary(p))) continue;
      actions.push(...this.#castOptions(holder, card));
    }
    // Abilities that work from the hand, such as cycling (702.29a), and from the graveyard.
    const loose = [...hand, ...zone.graveyard];
    for (const card of loose) {
      for (const ability of this.#abilitiesOf(card)) {
        if (!this.#canActivate(holder, card, ability)) continue;
        actions.push(...this.#activationOptions(holder, card, ability));
      }
    }
    // 602.2 / 605.3a: a player with priority may activate abilities of permanents
    // they control, and of their emblems, as long as they can pay the cost.
    const sources = [
      ...this.#battlefield.filter((p) => p.controllerId === holder),
      ...zone.emblems,
    ];
    for (const source of sources) {
      for (const ability of this.#abilitiesOf(source)) {
        if (!this.#canActivate(holder, source, ability)) continue;
        actions.push(...this.#activationOptions(holder, source, ability));
      }
    }
    return actions;
  }

  /** 702.8a, and Gandalf, Friend of the Shire's "You may cast sorcery spells as though they had flash." */
  #castsAtInstantSpeed(playerId, card) {
    if (castsAtInstantSpeed(card)) return true;
    return isSorcery(card) && this.#staticRules('flashForSorceries').some((p) => p.controllerId === playerId);
  }

  /** The values {X} can take: up to what the pool could pay on top of the rest of the cost (107.3). */
  #xValues(playerId, manaCost, card = null) {
    if (!manaCost?.X) return [undefined];
    const pool = this.#poolFor(playerId, card);
    const total = manaPoolTotal(pool) + (pool.any ?? 0);
    const max = Math.max(0, Math.floor((total - manaValue(manaCost)) / manaCost.X));
    return Array.from({ length: max + 1 }, (_, x) => x);
  }

  /**
   * A spell's modes (700.2): each index, and, when `chooseTwo`'s condition holds as it's cast ("If you control a
   * Wizard as you cast this spell, you may choose two instead"), each pair of indexes.
   */
  #modeChoices(playerId, definition, cardId) {
    if (!definition.modes) return [undefined];
    const single = definition.modes.map((_, i) => i);
    if (!definition.chooseTwo || !this.#checkCondition(definition.chooseTwo, playerId, { sourceId: cardId })) return single;
    return [...single, ...combinations(single, 2)];
  }

  /**
   * What a spell does in the chosen mode: the card itself, one mode, or two modes together (their targets one
   * after the other, so each mode's effects point at its own targets).
   */
  #spellHolder(definition, mode) {
    if (mode === undefined || !definition.modes) return definition;
    if (!Array.isArray(mode)) return definition.modes[mode];
    const targets = [];
    const effects = [];
    for (const index of mode) {
      const chosen = definition.modes[index];
      const offset = targets.length;
      targets.push(...targetList(chosen));
      for (const effect of chosen.effects ?? []) {
        const aimed = effectAffects(effect) === AFFECTED.TARGET || effectAffects(effect) === AFFECTED.TARGET_CONTROLLER;
        effects.push(aimed ? { ...effect, targetIndex: (effect.targetIndex ?? 0) + offset } : effect);
      }
    }
    return { targets, effects, text: mode.map((i) => definition.modes[i].text).join(' ') };
  }

  /** Every way to cast `card` now: per mode, X, targets, cost choices and mana color (601.2b-c). */
  #castOptions(playerId, card) {
    const definition = this.#cardDefinitions[card.cardId];
    const modes = this.#modeChoices(playerId, definition, card.id).map((mode) => [mode, this.#spellHolder(definition, mode)]);
    const actions = [];
    for (const [mode, holder] of modes) {
      // 303.4a: an Aura spell targets what it will enchant.
      const kinds = definition.enchant ? [definition.enchant] : targetList(holder);
      const effects = holder.effects ?? [];
      for (const x of this.#xValues(playerId, definition.manaCost, card)) {
        const targetOptions = kinds.length ? this.#targetOptions(kinds, playerId, { sourceId: card.id, x }) : [undefined];
        for (const targets of targetOptions) {
          const manaCost = this.#spellCost(playerId, card, { x, targets });
          const pool = this.#poolFor(playerId, card);
          const additionalCost = definition.additionalCost ?? {};
          if (!this.#canPayCost(playerId, null, additionalCost, null)) continue;
          // An additional cost may have mana of its own ("sacrifice a creature or pay {4}").
          const choiceOptions = this.#costChoiceOptions(playerId, additionalCost, card.id).filter((choices) => {
            const extra = choices?.alternative !== undefined ? additionalCost.anyOf[choices.alternative].mana : additionalCost.mana;
            return canPayMana(pool, addCosts(manaCost, extra));
          });
          const base = {
            type: ACTION.CAST_SPELL, playerId, cardId: card.id,
            ...(targets ? { targets } : {}), ...(mode !== undefined ? { mode } : {}), ...(x !== undefined ? { x } : {}),
          };
          for (const choices of choiceOptions) {
            for (const color of this.#colorOptions(playerId, effects)) {
              actions.push({ ...base, ...(choices ? { costChoices: choices } : {}), ...color });
            }
          }
        }
      }
    }
    return actions;
  }

  /** Every way to activate `ability` of `source` now: per X, targets, cost choices and mana color. */
  #activationOptions(playerId, source, ability) {
    const effects = abilityEffects(ability);
    const kinds = targetList(ability);
    const attaches = effects.some((e) => e.type === EFFECT.ATTACH);
    const base = { type: ACTION.ACTIVATE_ABILITY, playerId, cardId: source.id, abilityId: ability.id };
    // The common case, with nothing to choose, without building option lists.
    if (!kinds.length && !ability.cost.mana?.X && !this.#costNeedsChoices(ability.cost) && !needsManaColor(effects)) {
      return canPayMana(this.#poolFor(playerId, null), this.#abilityManaCost(playerId, source, ability)) ? [base] : [];
    }
    const actions = [];
    for (const x of this.#xValues(playerId, ability.cost.mana)) {
      const mana = this.#abilityManaCost(playerId, source, ability, x);
      if (!canPayMana(this.#poolFor(playerId, null), mana)) continue;
      const targetOptions = kinds.length ? this.#targetOptions(kinds, playerId, {
        // Something can't be attached to itself, and attaching to what it's already
        // attached to would do nothing (701.3b).
        excludeId: attaches ? source.id : null,
        skip: attaches ? (target) => source.attachedTo === target.id : null,
        sourceId: source.id,
        x,
      }) : [undefined];
      for (const targets of targetOptions) {
        for (const choices of this.#costChoiceOptions(playerId, ability.cost, null, source.id)) {
          for (const color of this.#colorOptions(playerId, effects)) {
            actions.push({
              ...base, ...(targets ? { targets } : {}), ...(x !== undefined ? { x } : {}), ...(choices ? { costChoices: choices } : {}), ...color,
            });
          }
        }
      }
    }
    return actions;
  }

  /**
   * The color is a choice made on resolution, but a mana ability resolves at once (605.3b), so
   * it's made with the action. Spells that add any color are rare enough to work the same way.
   * The Grey Havens' "any color among legendary creature cards in your graveyard" narrows it.
   */
  #colorOptions(playerId, effects) {
    if (!needsManaColor(effects)) return [{}];
    const among = effects.find((e) => e.colorsFrom)?.colorsFrom;
    let colors = COLORS_OF_MANA;
    // Mount Doom: "Add {B} or {R}."
    if (Array.isArray(among)) colors = among;
    if (among === 'legendaryCreatureCardsInYourGraveyard') {
      const found = new Set(this.#zones.get(playerId).graveyard.filter((c) => isCreature(c) && isLegendary(c)).flatMap(colorsOf));
      colors = COLORS_OF_MANA.filter((c) => found.has(c));
    }
    return colors.map((manaColor) => ({ manaColor }));
  }

  #costNeedsChoices(cost = {}) {
    return Boolean(cost.sacrifice || cost.discard || cost.anyOf || cost.tapCreatures);
  }

  /** Untapped creatures `playerId` could tap for a cost ("Tap an untapped creature you control", crew). */
  #untappedCreatures(playerId, sourceId) {
    return this.#battlefield.filter((p) => p.controllerId === playerId && isCreature(p) && !p.tapped && p.id !== sourceId);
  }

  /** A sacrifice cost as `{ kind, filter?, count, other? }` (it may be written as just a TARGET kind). */
  #sacrificeSpec(sacrifice) {
    const spec = typeof sacrifice === 'string' ? { kind: sacrifice } : sacrifice;
    return { count: 1, ...spec };
  }

  /**
   * Every way to make the choices a cost needs, as `{ sacrifice?: [id], discard?: [id],
   * tap?: [id], alternative?: n }` objects, or `[null]` when it needs none. `excludeCardId`
   * is a spell being cast, which is no longer in its owner's hand when costs are paid
   * (601.2a); `sourceId` is the ability's source ("Sacrifice another creature").
   */
  #costChoiceOptions(playerId, cost = {}, excludeCardId = null, sourceId = null) {
    // "As an additional cost, sacrifice a creature or pay {4}": one alternative or the other.
    if (cost.anyOf) {
      return cost.anyOf.flatMap((alternative, i) => (this.#canPayCost(playerId, null, alternative, null)
        ? this.#costChoiceOptions(playerId, alternative, excludeCardId, sourceId).map((o) => ({ ...(o ?? {}), alternative: i }))
        : []));
    }
    let options = [{}];
    if (cost.sacrifice) {
      const spec = this.#sacrificeSpec(cost.sacrifice);
      const candidates = this.#battlefield
        .filter((p) => p.controllerId === playerId && matchesPermanentKind(p, spec.kind, playerId)
          && !(spec.other && p.id === sourceId)
          && (!spec.filter || matchesFilter(p, { controller: 'any', ...spec.filter }, this.#filterContext(playerId, sourceId))))
        .map((p) => p.id);
      options = options.flatMap((o) => combinations(candidates, spec.count).map((ids) => ({ ...o, sacrifice: ids })));
    }
    if (cost.discard) {
      const cards = this.#zones.get(playerId).hand.filter((c) => c.id !== excludeCardId).map((c) => c.id);
      options = options.flatMap((o) => combinations(cards, cost.discard).map((ids) => ({ ...o, discard: ids })));
    }
    if (cost.tapCreatures?.count) {
      // The Shire: "Tap an untapped creature you control" (no summoning sickness rule: it isn't {T}, 302.6).
      const ids = this.#untappedCreatures(playerId, sourceId).map((p) => p.id);
      options = options.flatMap((o) => combinations(ids, cost.tapCreatures.count).map((tap) => ({ ...o, tap })));
    } else if (cost.tapCreatures) {
      // Crew N (702.122a): untapped creatures with total power N or more; only sets that need every member.
      const creatures = this.#untappedCreatures(playerId, sourceId);
      const sets = [];
      for (let n = 1; n <= creatures.length; n++) {
        for (const ids of combinations(creatures.map((p) => p.id), n)) {
          const powers = ids.map((id) => Math.max(0, this.#permanent(id).power));
          const total = powers.reduce((a, b) => a + b, 0);
          if (total >= cost.tapCreatures.power && powers.every((power) => total - power < cost.tapCreatures.power)) sets.push(ids);
        }
      }
      options = options.flatMap((o) => sets.map((ids) => ({ ...o, tap: ids })));
    }
    return options.map((o) => (Object.keys(o).length ? o : null));
  }

  #decisionActions(decision) {
    const { playerId } = decision;
    switch (decision.type) {
      case DECISION.DISCARD_TO_HAND_SIZE:
        return this.#zones.get(playerId).hand
          .map((card) => ({ type: ACTION.DISCARD, playerId, cardId: card.id }));
      case DECISION.DECLARE_ATTACKERS:
        return [
          // 508.1d: a creature that attacks each combat if able (goaded) must; it can't be left out.
          ...this.#eligibleAttackers(playerId).filter((creature) => !hasKeyword(creature, KEYWORD.MUST_ATTACK))
            .map((creature) => ({ type: ACTION.TOGGLE_ATTACKER, playerId, cardId: creature.id })),
          { type: ACTION.CONFIRM_ATTACKERS, playerId },
        ];
      case DECISION.DECLARE_BLOCKERS: {
        const actions = [];
        for (const blocker of this.#eligibleBlockers(playerId)) {
          const current = decision.blocks[blocker.id] ?? null;
          for (const { cardId: attackerId } of this.#combat.attackers) {
            const attacker = this.#permanent(attackerId);
            // "Can't be blocked by more than one creature": no second blocker is offered.
            const full = hasKeyword(attacker, KEYWORD.MAX_ONE_BLOCKER) && Object.values(decision.blocks).includes(attackerId);
            if (attackerId !== current && !full && this.#canBlock(blocker, attacker)) {
              actions.push({ type: ACTION.SET_BLOCKER, playerId, cardId: blocker.id, attackerId });
            }
          }
          if (current) actions.push({ type: ACTION.SET_BLOCKER, playerId, cardId: blocker.id, attackerId: null });
        }
        if (this.#blocksAreLegal(decision.blocks)) actions.push({ type: ACTION.CONFIRM_BLOCKERS, playerId });
        return actions;
      }
      case DECISION.ASSIGN_COMBAT_DAMAGE: {
        const attacker = this.#combat.attackers.find((a) => a.cardId === decision.attackerId);
        return this.#damageAssignmentOptions(attacker).map((assignment) => ({
          type: ACTION.ASSIGN_COMBAT_DAMAGE, playerId, attackerId: decision.attackerId, assignment,
        }));
      }
      case DECISION.CHOOSE_TARGETS:
        return [
          ...this.#targetOptions(decision.targetKinds ?? [decision.targetKind], playerId, {
            excludeId: decision.excludeId ?? null, sourceId: decision.sourceId, amassedArmyId: decision.amassedArmyId ?? null,
          })
            .map((targets) => ({ type: ACTION.CHOOSE_TARGETS, playerId, targets })),
          ...(decision.optional ? [{ type: ACTION.CHOOSE_TARGETS, playerId, targets: [] }] : []),
        ];
      case DECISION.CHOOSE:
        return decision.options.map((choice) => ({ type: ACTION.CHOOSE, playerId, choice }));
      case DECISION.CHOOSE_MANY: {
        const { selected, options, min, max } = decision;
        return [
          // Toggling in is offered only while there's room; toggling out always.
          ...options.filter((o) => selected.includes(o) || selected.length < max).map((choice) => ({ type: ACTION.TOGGLE_CHOICE, playerId, choice })),
          ...(selected.length >= min ? [{ type: ACTION.CONFIRM_CHOICE, playerId }] : []),
        ];
      }
      case DECISION.CHOOSE_MODE:
        return decision.options.map((option) => ({ type: ACTION.CHOOSE_MODE, playerId, ...option }));
      case DECISION.LEGEND_RULE:
        return decision.cardIds.map((cardId) => ({ type: ACTION.KEEP_LEGEND, playerId, cardId }));
      case DECISION.MULLIGAN:
        return [
          { type: ACTION.KEEP_HAND, playerId },
          // Down to no cards at most.
          ...(decision.mulligans < OPENING_HAND_SIZE ? [{ type: ACTION.MULLIGAN, playerId }] : []),
        ];
      case DECISION.PUT_ON_BOTTOM:
        return this.#zones.get(playerId).hand
          .map((card) => ({ type: ACTION.PUT_ON_BOTTOM, playerId, cardId: card.id }));
      default:
        throw new Error(`Unknown decision type: ${decision.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Action processing

  /**
   * Run `work`, then drain the action queue. Actions dispatched by listeners in
   * the meantime are queued rather than re-entering the engine. Returns the
   * outcome of the first queued action.
   */
  #runExclusive(work) {
    this.#processing = true;
    let result;
    try {
      work?.();
      while (this.#queue.length > 0) {
        const outcome = this.#process(this.#queue.shift());
        result ??= outcome;
      }
    } finally {
      this.#processing = false;
    }
    return result;
  }

  #process(action, trusted = false) {
    const reason = trusted ? null : this.#validate(action);
    if (reason) {
      this.#emitEvent('actionRejected', { action, reason });
      return { ok: false, reason };
    }
    this.#emitEvent('actionAccepted', { action });
    const { playerId, cardId } = action;
    switch (action.type) {
      case ACTION.PASS_PRIORITY: this.#passPriority(playerId); break;
      case ACTION.PLAY_LAND: this.#playLand(playerId, cardId); break;
      case ACTION.CAST_SPELL: this.#castSpell(playerId, cardId, action); break;
      case ACTION.ACTIVATE_ABILITY:
        this.#activateAbility(playerId, cardId, action.abilityId, action.targets, action.costChoices, action.manaColor, action.x);
        break;
      case ACTION.TOGGLE_ATTACKER: this.#toggleAttacker(cardId); break;
      case ACTION.CONFIRM_ATTACKERS: this.#confirmAttackers(); break;
      case ACTION.SET_BLOCKER: this.#setBlocker(cardId, action.attackerId); break;
      case ACTION.CONFIRM_BLOCKERS: this.#confirmBlockers(); break;
      case ACTION.ASSIGN_COMBAT_DAMAGE: this.#assignCombatDamage(action.assignment); break;
      case ACTION.DISCARD: this.#discardToHandSize(playerId, cardId); break;
      case ACTION.CHOOSE_TARGETS: this.#chooseTriggerTargets(action.targets); break;
      case ACTION.CHOOSE_MODE: this.#chooseTriggerMode(action.mode, action.targets); break;
      case ACTION.KEEP_LEGEND: this.#keepLegend(playerId, cardId); break;
      case ACTION.KEEP_HAND: this.#keepHand(playerId); break;
      case ACTION.MULLIGAN: this.#mulligan(playerId); break;
      case ACTION.PUT_ON_BOTTOM: this.#putOnBottom(playerId, cardId); break;
      case ACTION.CHOOSE: this.#choose(action.choice); break;
      case ACTION.TOGGLE_CHOICE: this.#toggleChoice(action.choice); break;
      case ACTION.CONFIRM_CHOICE: this.#confirmChoice(); break;
    }
    this.#emitState();
    return { ok: true };
  }

  #validate(action) {
    if (!action || typeof action !== 'object') return 'Action must be an object.';
    if (this.#status !== GAME_STATUS.IN_PROGRESS) return 'Game is not in progress.';
    if (!Object.values(ACTION).includes(action.type)) return `Unknown action type: ${action.type}`;
    if (!this.#zones.has(action.playerId)) return `Unknown player: ${action.playerId}`;

    // An action is valid when it equals one of the valid actions.
    if (this.getValidActions(action.playerId).some((valid) => deepEqual(valid, action))) return null;
    const target = action.cardId ? ` with card ${action.cardId}` : '';
    return `${action.type}${target} is not a valid action for ${action.playerId} right now.`;
  }

  // ---------------------------------------------------------------------------
  // Priority (Comprehensive Rules 117)

  #passPriority(playerId) {
    this.#playersPassed.push(playerId);
    this.#emitEvent('priorityPassed', { playerId });

    if (this.#playersPassed.length < this.#players.length) {
      // 117.3d: the next player in turn order receives priority.
      this.#givePriority(this.#nextPlayerId(playerId));
      return;
    }

    // 117.4: all players passed in succession. The top object of the stack
    // resolves; with an empty stack the step or phase ends.
    this.#priorityPlayerId = null;
    if (this.#stack.length > 0) {
      this.#resolveTopOfStack();
    } else {
      this.#advance();
    }
  }

  /**
   * Returns false if state-based actions ended the game instead, or if a player
   * must first choose a target for a triggered ability.
   */
  #givePriority(playerId) {
    // 117.5 / 704.3: state-based actions are checked before a player receives priority,
    // then triggered abilities are put on the stack (603.3).
    if (this.#checkStateBasedActions()) return false;
    if (this.#checkLegendRule(playerId)) return false;
    if (this.#putTriggersOnStack(playerId)) return false;
    this.#priorityPlayerId = playerId;
    this.#emitEvent('priorityGranted', { playerId });
    return true;
  }

  /** 117.4: taking an action breaks the run of passes. */
  #resetPasses() {
    this.#playersPassed = [];
  }

  // ---------------------------------------------------------------------------
  // Cards and zones

  #createCard(cardId, ownerId, id) {
    const definition = this.#cardDefinitions[cardId];
    if (!definition) throw new Error(`Unknown card: ${cardId}`);
    const card = {
      id,
      cardId,
      name: definition.name,
      manaCost: definition.manaCost ?? null,
      supertypes: [...(definition.supertypes ?? [])],
      types: [...definition.types],
      subtypes: [...(definition.subtypes ?? [])],
      ...(definition.triggeredAbilities ? {
        triggeredAbilities: definition.triggeredAbilities.map((ability) => ({
          id: ability.id,
          text: ability.text,
          trigger: ability.trigger,
          effects: structuredClone(abilityEffects(ability)),
          target: ability.target ?? null,
          ...(ability.targets ? { targets: structuredClone(ability.targets) } : {}),
          ...(ability.modes ? { modes: structuredClone(ability.modes) } : {}),
          ...(ability.optional ? { optional: true } : {}),
        })),
      } : {}),
      // Abilities activated from the hand, such as cycling (702.29).
      ...(definition.handAbilities ? {
        handAbilities: definition.handAbilities.map(({ id, text, ...ability }) => ({
          id, text, isManaAbility: false, cost: structuredClone(ability.cost), effects: structuredClone(abilityEffects(ability)),
          timing: ability.timing ?? ACTIVATION_TIMING.INSTANT, target: ability.target ?? null,
        })),
      } : {}),
      // Abilities activated from the graveyard (Gollum, Patient Plotter).
      ...(definition.graveyardAbilities ? {
        graveyardAbilities: definition.graveyardAbilities.map(({ id, text, ...ability }) => ({
          id, text, isManaAbility: false, cost: structuredClone(ability.cost), effects: structuredClone(abilityEffects(ability)),
          timing: ability.timing ?? ACTIVATION_TIMING.INSTANT, target: ability.target ?? null,
        })),
      } : {}),
      ...(definition.entersTapped ? { entersTapped: true } : {}),
      // "This land enters tapped unless you control a legendary creature." (614.1c)
      ...(definition.entersTappedUnless ? { entersTappedUnless: structuredClone(definition.entersTappedUnless) } : {}),
      // "This enchantment enters with a hope counter on it for each creature you control." (614.1c)
      ...(definition.entersWithCounters ? { entersWithCounters: structuredClone(definition.entersWithCounters) } : {}),
      ...(definition.costReduction ? { costReduction: structuredClone(definition.costReduction) } : {}),
      // 105.2: its colors, when the definition says (otherwise colorsOf reads the mana cost).
      ...(definition.colors ? { colors: [...definition.colors] } : {}),
      // What an Aura or Equipment does to its creature (applied in #applyContinuousEffects).
      ...(definition.staticAbilities ? { staticAbilities: structuredClone(definition.staticAbilities) } : {}),
      abilities: (definition.abilities ?? []).map(({ id, text, ...ability }) => ({
        id,
        text,
        isManaAbility: isManaAbility(ability),
        cost: structuredClone(ability.cost),
        effects: structuredClone(abilityEffects(ability)),
        timing: ability.timing ?? ACTIVATION_TIMING.INSTANT,
        target: ability.target ?? null,
        ...(ability.targets ? { targets: structuredClone(ability.targets) } : {}),
      })),
      keywords: [...(definition.keywords ?? [])],
      text: definition.text ?? definition.oracleText ?? '',
      ownerId,
    };
    if (!isPermanentCard(definition)) {
      card.spell = {
        target: definition.target ?? null,
        ...(definition.targets ? { targets: structuredClone(definition.targets) } : {}),
        effects: structuredClone(definition.effects ?? []),
        // A modal spell ("Choose one —", 700.2): each mode's effects and targets.
        ...(definition.modes ? { modes: structuredClone(definition.modes) } : {}),
      };
    }
    if (definition.additionalCost) card.additionalCost = structuredClone(definition.additionalCost);
    if (isCreature(definition)) Object.assign(card, { power: definition.power, toughness: definition.toughness });
    if (definition.token) Object.assign(card, { token: true, colors: [...(definition.colors ?? [])] });
    return card;
  }

  /**
   * 111.1: a token with the characteristics the effect gives it: a predefined token
   * (a TOKEN name such as 'treasure', 111.10) or a creature token's description.
   */
  #tokenCardId(token) {
    return typeof token === 'string' ? this.#predefinedTokenId(token) : this.#creatureTokenId(token);
  }

  #createToken(token, controllerId, options = {}) {
    const cardId = this.#tokenCardId(token);
    // 111.2: the player who creates a token is its owner.
    const card = this.#createCard(cardId, controllerId, `${controllerId}-token-${this.#nextTokenNumber++}`);
    return this.#putOntoBattlefield(card, controllerId, options);
  }

  #predefinedTokenId(name) {
    const definition = TOKENS[name];
    if (!definition) throw new Error(`Unknown token: ${name}`);
    const cardId = tokenCardId(name);
    this.#cardDefinitions[cardId] ??= { ...structuredClone(definition), id: cardId, colors: [], token: true };
    return cardId;
  }

  #creatureTokenId(token) {
    const name = creatureTokenName(token);
    const keywords = token.keywords ?? [];
    const colors = token.colors ?? [];
    const cardId = tokenCardId(token);
    const keywordText = keywords.length ? ` with ${keywords.join(', ')}` : '';
    this.#cardDefinitions[cardId] ??= {
      id: cardId,
      name,
      // "a 2/1 colorless Construct artifact creature token" (Ballistic Boulder).
      types: [...(token.types ?? [CARD_TYPE.CREATURE])],
      subtypes: [...(token.subtypes ?? [])],
      power: token.power,
      toughness: token.toughness,
      keywords: [...keywords],
      colors: [...colors],
      token: true,
      // Smaug: "a legendary 6/6 red Dragon creature token with … 'When Smaug dies, create fourteen Treasure tokens.'"
      ...(token.supertypes ? { supertypes: [...token.supertypes] } : {}),
      ...(token.triggeredAbilities ? { triggeredAbilities: structuredClone(token.triggeredAbilities) } : {}),
      text: `${token.power}/${token.toughness} ${[...colors, ...(token.subtypes ?? [])].join(' ')} ${(token.types ?? [CARD_TYPE.CREATURE]).join(' ').toLowerCase()} token${keywordText}`,
    };
    return cardId;
  }

  #createEmblem(emblemId, ownerId, number) {
    const definition = this.#emblemDefinitions[emblemId];
    if (!definition) throw new Error(`Unknown emblem: ${emblemId}`);
    return {
      id: `${ownerId}-emblem-${number}`,
      emblemId,
      name: definition.name,
      ownerId,
      controllerId: ownerId,
      abilities: definition.abilities.map((ability) => ({
        id: ability.id,
        text: ability.text,
        cost: structuredClone(ability.cost),
        effects: structuredClone(abilityEffects(ability)),
        timing: ability.timing ?? ACTIVATION_TIMING.INSTANT,
        target: ability.target ?? null,
      })),
      activationsPerTurn: definition.activationsPerTurn ?? Infinity,
      activationsThisTurn: 0,
    };
  }

  /**
   * Activated ability definitions of a permanent (none once it has lost all abilities),
   * an emblem, or a card in a hand (cycling) or graveyard.
   */
  #abilitiesOf(source) {
    if (source.emblemId) return this.#emblemDefinitions[source.emblemId].abilities;
    const definition = this.#cardDefinitions[source.cardId];
    const permanent = this.#permanent(source.id);
    if (permanent) return permanent.abilitiesLost ? [] : definition.abilities ?? [];
    const inHand = [...this.#zones.values()].some((zone) => zone.hand.some((c) => c.id === source.id));
    return (inHand ? definition.handAbilities : definition.graveyardAbilities) ?? [];
  }

  /** A permanent, an emblem, or a card in a hand or graveyard, by id. */
  #findSource(id) {
    const zones = [...this.#zones.values()];
    return this.#permanent(id)
      ?? zones.flatMap((zone) => zone.emblems).find((e) => e.id === id)
      ?? zones.flatMap((zone) => zone.hand).find((c) => c.id === id)
      ?? zones.flatMap((zone) => zone.graveyard).find((c) => c.id === id)
      ?? null;
  }

  #permanent(id) {
    return this.#battlefield.find((p) => p.id === id) ?? null;
  }

  /**
   * Puts a card onto the battlefield under `controllerId`'s control: `tapped`, or tapped
   * and `attacking` (508.4: it was never declared as an attacker, so "whenever this
   * attacks" doesn't trigger).
   */
  #putOntoBattlefield(card, controllerId, { tapped = false, attacking = false, x = undefined } = {}) {
    const { extraCounters, ...rest } = card;
    const tappedUnless = card.entersTappedUnless && !this.#checkCondition(card.entersTappedUnless, controllerId, { sourceId: card.id });
    const permanent = {
      ...rest,
      controllerId,
      // "This land enters tapped." (614.1c, written as a field)
      tapped: Boolean(card.entersTapped) || tappedUnless || tapped || attacking,
      summoningSick: true,
      enteredThisTurn: true,
      damage: 0,
      damagedByDeathtouch: false,
      attachedTo: null,
      counters: {},
      // Printed values; power, toughness, keywords and types are recalculated from these (613).
      base: {
        power: card.power, toughness: card.toughness, keywords: [...card.keywords],
        types: [...card.types], subtypes: [...(card.subtypes ?? [])], supertypes: [...(card.supertypes ?? [])],
      },
    };
    // Long List of the Ents: "that creature enters with an additional +1/+1 counter on it" (614.1c).
    if (extraCounters) permanent.counters[COUNTER.PLUS_ONE] = extraCounters;
    // 107.3m: the value of X paid for it, which its abilities may refer to (Spiteful Banditry).
    if (x !== undefined) permanent.xPaid = x;
    if (card.entersWithCounters) {
      const { counter, count = 1, per } = card.entersWithCounters;
      const n = count * (per ? this.#countFor(per, controllerId, { sourceId: card.id }) : 1);
      if (n > 0) permanent.counters[counter] = n;
    }
    this.#battlefield.push(permanent);
    if (attacking) {
      this.#combat.attackers.push({
        cardId: permanent.id, defendingPlayerId: this.#nextPlayerId(controllerId), blocked: false, blockerIds: [], damageAssignment: null,
      });
    }
    this.#applyContinuousEffects();
    // 603.6a: "When this enters" triggers, and so do abilities watching for it ("Whenever
    // another creature you control enters", landfall).
    this.#trigger(permanent, TRIGGER.ENTERS_BATTLEFIELD, controllerId);
    if (isCreature(permanent)) this.#triggerWatchers(TRIGGER.CREATURE_ENTERS, permanent);
    if (isLand(permanent)) this.#triggerWatchers(TRIGGER.LAND_ENTERS, permanent);
    // 714.3a: a Saga enters with a lore counter on it, which triggers chapter I.
    if (isSaga(permanent)) this.#addCounters(permanent, COUNTER.LORE, 1);
    return permanent;
  }

  /**
   * Moves a permanent to its owner's graveyard. A creature that would die is exiled
   * instead under Stone of Erech (an opponent's) or Smite the Deathless (614.1a).
   */
  #putIntoGraveyard(permanent) {
    const exiled = isCreature(permanent) && (
      this.#temporaryEffects.some((e) => e.exileIfDies && e.targetId === permanent.id)
      || this.#staticRules('exileOpponentsDyingCreatures').some((p) => p.controllerId !== permanent.controllerId));
    if (exiled) {
      this.#moveFromBattlefield(permanent, 'exile');
      this.#emitEvent('permanentExiled', { cardId: permanent.id, cardName: permanent.name, controllerId: permanent.controllerId, reason: 'insteadOfDying' });
      return;
    }
    this.#moveFromBattlefield(permanent, 'graveyard');
  }

  /**
   * Moves a permanent to one of its owner's zones ('graveyard', 'hand', 'exile', or
   * 'library' at `position` from the top), stripping battlefield-only state.
   */
  #moveFromBattlefield(permanent, zoneName, position = 1) {
    this.#battlefield.splice(this.#battlefield.indexOf(permanent), 1);
    const controllerTally = this.#zones.get(permanent.controllerId).turnTally;
    controllerTally.permanentLeft = true;
    const dies = zoneName === 'graveyard' && isCreature(permanent);
    if (dies) {
      controllerTally.creatureDied = true;
      controllerTally.creaturesDied += 1;
    }
    // 700.4: a creature dies when it's put into a graveyard from the battlefield. Leaves-the-
    // battlefield abilities "look back in time" (603.10a), so this uses the permanent as it was.
    if (dies) this.#trigger(permanent, TRIGGER.DIES, permanent.controllerId, () => true, { ...permanent });
    if (zoneName === 'graveyard') this.#trigger(permanent, TRIGGER.PUT_INTO_GRAVEYARD, permanent.controllerId);
    this.#trigger(permanent, TRIGGER.LEAVES_BATTLEFIELD, permanent.controllerId);
    if (dies) {
      // "Whenever a creature an opponent controls dies", "Whenever another creature you control dies".
      this.#triggerWatchers(TRIGGER.CREATURE_DIES, { ...permanent }, { alsoFrom: [permanent, ...this.#leaving] });
    }
    const {
      controllerId, tapped, summoningSick, enteredThisTurn, damage, damagedByDeathtouch, attachedTo, counters, base,
      linkedExiles, abilitiesLost, grantedTriggers, dealtDamageThisTurn, blockedByOrBlockedLegendaryThisTurn, notedTypes, xPaid, wards,
      combatDamagedPlayers, ...card
    } = permanent;
    // 400.7: it becomes a new object with its printed characteristics.
    Object.assign(card, base.power === undefined ? { keywords: base.keywords } : { power: base.power, toughness: base.toughness, keywords: base.keywords });
    Object.assign(card, { types: [...this.#cardDefinitions[card.cardId].types], subtypes: [...(this.#cardDefinitions[card.cardId].subtypes ?? [])] });
    card.supertypes = [...(this.#cardDefinitions[card.cardId].supertypes ?? [])];
    if (zoneName === 'graveyard') card.leftBattlefieldTurn = this.#turn;
    // 111.7 / 704.5d: a token that leaves the battlefield ceases to exist, so it isn't kept anywhere.
    if (!card.token) {
      const zone = this.#zones.get(card.ownerId)[zoneName];
      if (zoneName === 'library') zone.splice(Math.min(position - 1, zone.length), 0, card);
      else zone.push(card);
    }
    // 400.7: effects that applied to it don't follow it.
    this.#temporaryEffects = this.#temporaryEffects.filter((e) => e.targetId !== permanent.id);
    this.#applyContinuousEffects();
    // 506.4: a permanent that leaves the battlefield is removed from combat.
    this.#removeFromCombat(permanent.id);
    // 610.3c: "until this leaves the battlefield": what it exiled returns.
    for (const { cardId, ownerId } of linkedExiles ?? []) {
      const exile = this.#zones.get(ownerId).exile;
      const index = exile.findIndex((c) => c.id === cardId);
      if (index === -1) continue;
      const [returned] = exile.splice(index, 1);
      const back = this.#putOntoBattlefield(returned, ownerId);
      this.#emitEvent('permanentEntered', { playerId: ownerId, card: this.#forEvent(back), returnedFromExile: true });
    }
  }

  /** Permanents leaving the battlefield together (704.3), so "another creature dies" sees them all (603.10a). */
  #leaving = [];

  #drawCards(playerId, count) {
    const zone = this.#zones.get(playerId);
    const drawn = [];
    const burned = [];
    let second = false;
    for (let i = 0; i < count; i++) {
      if (zone.library.length === 0) {
        // 121.4: the player loses the next time state-based actions are checked.
        zone.attemptedDrawFromEmptyLibrary = true;
        this.#emitEvent('drawFromEmptyLibrary', { playerId });
        break;
      }
      const card = zone.library.shift(); // index 0 is the top of the library
      zone.hand.push(card);
      drawn.push(card.id);
      zone.turnTally.cardsDrawn += 1;
      if (zone.turnTally.cardsDrawn === 2) second = true;
      if (zone.hand.length > (this.#limits.hand ?? Infinity)) burned.push(zone.hand.pop());
    }
    if (drawn.length) {
      this.#emitEvent('cardsDrawn', { playerId, cardIds: drawn, librarySize: zone.library.length });
    }
    for (const card of burned) this.#burn(playerId, card, 'draw');
    // "Whenever you draw your second card each turn".
    if (second) {
      for (const permanent of [...this.#battlefield].filter((p) => p.controllerId === playerId)) {
        this.#trigger(permanent, TRIGGER.DRAW_SECOND_CARD, playerId);
      }
    }
  }

  /**
   * Creates the tokens a CREATE_TOKEN effect describes for `playerId` (111.1): `count` of
   * `token`, maybe `tapped`, or tapped and `attacking` and sacrificed at end of combat.
   * Peregrin Took adds a Food each time (614.1a). Returns the tokens created.
   */
  #createTokens(effect, playerId, sourceId) {
    const created = [];
    const kinds = Array(effect.count ?? 1).fill(effect.token);
    // "If one or more tokens would be created under your control, those tokens plus an additional Food token are created instead."
    const extraFood = this.#staticRules('extraFoodToken').filter((p) => p.controllerId === playerId).length;
    kinds.push(...Array(extraFood).fill(TOKEN.FOOD));
    for (const [i, token] of kinds.entries()) {
      const cardId = this.#tokenCardId(token);
      if (this.#atLimit(playerId, this.#cardDefinitions[cardId])) {
        this.#emitEvent('tokensLimited', { playerId, count: kinds.length - i, sourceId });
        break;
      }
      const original = token === effect.token;
      const permanent = this.#createToken(token, playerId, original ? { tapped: effect.tapped, attacking: effect.attacking } : {});
      created.push(permanent);
      this.#emitEvent('tokenCreated', { playerId, card: this.#forEvent(permanent), sourceId });
      if (original && effect.sacrificeAtEndOfCombat) {
        this.#delayedTriggers.push({
          at: 'endOfCombat', controllerId: playerId, sourceId, sourceName: permanent.name, text: `Sacrifice ${permanent.name} at end of combat.`,
          effects: [{ type: EFFECT.SACRIFICE, affected: AFFECTED.YOU, subjectOnly: true, filter: {} }],
          subject: { id: permanent.id, controllerId: playerId },
        });
      }
      // "Whenever you create a token".
      this.#triggerWatchers(TRIGGER.TOKEN_CREATED, permanent);
    }
    return created;
  }

  #burn(playerId, card, reason) {
    this.#zones.get(playerId).graveyard.push(card);
    this.#emitEvent('cardBurned', { playerId, cardId: card.id, cardName: card.name, reason });
  }

  /** The hand limit (GAME_LIMITS): a card that took a full hand over it is burned. */
  #burnIfHandFull(playerId, cardId, reason) {
    const zone = this.#zones.get(playerId);
    if (!(zone.hand.length > (this.#limits.hand ?? Infinity))) return;
    const index = zone.hand.findIndex((c) => c.id === cardId);
    if (index === -1) return;
    this.#burn(playerId, zone.hand.splice(index, 1)[0], reason);
  }

  /**
   * Whether `playerId` already has as many creatures (or other nonland permanents,
   * for a noncreature `card`) as the limits allow, counting their spells on the stack.
   */
  #atLimit(playerId, card) {
    if (isLand(card) || !isPermanentCard(card)) return false;
    const creature = isCreature(card);
    const limit = creature ? this.#limits.creatures : this.#limits.permanents;
    if (limit === undefined) return false;
    const counts = (c) => !isLand(c) && isCreature(c) === creature;
    const onBattlefield = this.#battlefield.filter((p) => p.controllerId === playerId && counts(p)).length;
    const onStack = this.#stack.filter((o) => o.kind === 'spell' && o.controllerId === playerId && isPermanentCard(o.card) && counts(o.card)).length;
    return onBattlefield + onStack >= limit;
  }

  /**
   * Sorcery timing (307.1): the player's own main phase, with priority and an
   * empty stack. Lands (305.1) and creature spells (302.1) use it.
   */
  #hasSorceryTiming(playerId) {
    return playerId === this.#activePlayerId
      && playerId === this.#priorityPlayerId
      && MAIN_PHASES.has(this.#segment?.phase)
      && this.#stack.length === 0;
  }

  #canPlayLand(playerId) {
    // 305.2: one land per turn.
    return this.#hasSorceryTiming(playerId)
      && this.#zones.get(playerId).landsPlayedThisTurn < LAND_PLAYS_PER_TURN;
  }

  #playLand(playerId, cardId) {
    // 116.2a: playing a land is a special action; it doesn't use the stack.
    const zone = this.#zones.get(playerId);
    const [card] = zone.hand.splice(zone.hand.findIndex((c) => c.id === cardId), 1);
    const permanent = this.#putOntoBattlefield(card, playerId);
    zone.landsPlayedThisTurn += 1;
    this.#emitEvent('landPlayed', { playerId, card: this.#forEvent(permanent) });

    // 117.3c: after a special action the same player receives priority again.
    this.#resetPasses();
    this.#givePriority(playerId);
  }

  #discardToHandSize(playerId, cardId) {
    const zone = this.#zones.get(playerId);
    const [card] = zone.hand.splice(zone.hand.findIndex((c) => c.id === cardId), 1);
    zone.graveyard.push(card);
    this.#emitEvent('cardDiscarded', { playerId, cardId });

    this.#pendingDecision.count -= 1;
    if (this.#pendingDecision.count > 0) return;
    this.#pendingDecision = null;
    this.#advance();
  }

  // ---------------------------------------------------------------------------
  // Mulligans (103.5, the London mulligan)

  #startFirstTurn() {
    this.#beginTurn(this.#startingPlayerId);
    this.#advance();
  }

  /** Asks the first of `order` whether to keep; the rest decide after them. */
  #offerMulligan([playerId, ...waiting], mulligans = 0) {
    if (!playerId) {
      this.#pendingDecision = null;
      this.#startFirstTurn();
      return;
    }
    this.#requireDecision({ type: DECISION.MULLIGAN, playerId, mulligans, waiting });
  }

  #mulligan(playerId) {
    const zone = this.#zones.get(playerId);
    const decision = this.#pendingDecision;
    // The hand is shuffled back into the library, and a new seven drawn.
    zone.library.push(...zone.hand.splice(0));
    if (this.#shuffleLibraries) shuffle(zone.library, this.#random);
    decision.mulligans += 1;
    this.#emitEvent('mulliganTaken', { playerId, mulligans: decision.mulligans });
    this.#drawCards(playerId, OPENING_HAND_SIZE);
    this.#requireDecision(decision);
  }

  #keepHand(playerId) {
    const { mulligans, waiting } = this.#pendingDecision;
    this.#emitEvent('handKept', { playerId, mulligans });
    if (mulligans > 0) {
      // Then one card on the bottom for each mulligan taken.
      this.#requireDecision({
        type: DECISION.PUT_ON_BOTTOM, playerId, mulligans, count: Math.min(mulligans, this.#zones.get(playerId).hand.length), waiting,
      });
      if (this.#pendingDecision.count > 0) return;
    }
    this.#offerMulligan(waiting);
  }

  #putOnBottom(playerId, cardId) {
    const zone = this.#zones.get(playerId);
    zone.library.push(...zone.hand.splice(zone.hand.findIndex((c) => c.id === cardId), 1));
    this.#emitEvent('cardPutOnBottom', { playerId });
    this.#pendingDecision.count -= 1;
    if (this.#pendingDecision.count === 0) this.#offerMulligan(this.#pendingDecision.waiting);
  }

  // ---------------------------------------------------------------------------
  // Spells, activated abilities and the stack (Comprehensive Rules 601, 602, 605, 608)

  /**
   * A player's mana pool as it can pay for `card` (a spell being cast, or null for an
   * ability): with `any`, the mana that can be spent as any color, counting mana only
   * some spells may use when `card` is one of them (see mana.js).
   */
  #poolFor(playerId, card) {
    const zone = this.#zones.get(playerId);
    const any = zone.specialMana.filter((m) => this.#manaUsableFor(m, card)).reduce((sum, m) => sum + m.amount, 0);
    return any ? { ...zone.manaPool, any } : zone.manaPool;
  }

  /** Whether mana with a spending restriction ("Spend this mana only to cast legendary spells") can pay for `card`. */
  #manaUsableFor(mana, card) {
    if (!mana.restriction) return true;
    if (!card) return false;
    if (mana.restriction === 'instantOrSorcery') return isInstant(card) || isSorcery(card);
    if (mana.restriction === 'legendary') return isLegendary(card);
    return false;
  }

  /** Pays `cost` from the pool (spending restricted mana first, where `card` may use it). Returns what was paid. */
  #payManaFrom(playerId, cost, card) {
    const zone = this.#zones.get(playerId);
    const payment = planManaPayment(this.#poolFor(playerId, card), cost);
    for (const type of MANA_TYPES) zone.manaPool[type] -= payment[type];
    let any = payment.any ?? 0;
    // Restricted mana goes first, as it's the least useful to keep.
    const order = [...zone.specialMana].sort((a, b) => Boolean(b.restriction) - Boolean(a.restriction));
    for (const mana of order) {
      if (any === 0) break;
      if (!this.#manaUsableFor(mana, card)) continue;
      const used = Math.min(any, mana.amount);
      mana.amount -= used;
      any -= used;
      // Delighted Halfling: "that spell can't be countered".
      if (mana.uncounterable && used > 0) payment.uncounterable = true;
    }
    zone.specialMana = zone.specialMana.filter((m) => m.amount > 0);
    return payment;
  }

  /** What `card` costs `playerId` to cast now, with X and targets (cost reductions, 601.2f). */
  #spellCost(playerId, card, { x = 0, targets = [] } = {}) {
    return spellCost(this.#cardDefinitions[card.cardId] ?? card, {
      battlefield: this.#battlefield, controllerId: playerId, combat: this.#combat, x: x ?? 0,
      conditionMet: (condition) => this.#checkCondition(condition, playerId, { sourceId: card.id, targets: targets ?? [] }),
      countFor: (per) => this.#countFor(per, playerId, { sourceId: card.id }),
    });
  }

  /**
   * An ability's mana cost now, with X (107.3), its own cost reduction ("This ability costs
   * {2} less to activate if you control a legendary creature.") and Éowyn's "Equip abilities
   * you activate cost {1} less to activate."
   */
  #abilityManaCost(playerId, source, ability, x = 0) {
    let mana = withX(ability.cost.mana, x ?? 0);
    const reduction = ability.costReduction;
    if (reduction) {
      const context = { sourceId: source.id };
      const amount = reduction.per ? this.#countFor(reduction.per, playerId, context)
        : this.#checkCondition(reduction.condition, playerId, context) ? reduction.amount : 0;
      mana = reduceGeneric(mana, amount);
    }
    if (ability.id?.startsWith('equip')) {
      mana = reduceGeneric(mana, this.#staticRules('equipCostsLess').filter((p) => p.controllerId === playerId).length);
    }
    return mana;
  }

  #castSpell(playerId, cardId, action) {
    const { targets, costChoices, manaColor, mode, x } = action;
    // 601.2a: the card moves from hand to the stack; 601.2h: its cost is paid.
    // (Mana must already be in the pool; activating mana abilities mid-cast isn't modelled.)
    const zone = this.#zones.get(playerId);
    const [card] = zone.hand.splice(zone.hand.findIndex((c) => c.id === cardId), 1);
    const definition = this.#cardDefinitions[card.cardId];
    const additionalCost = definition.additionalCost;
    const stackObject = {
      id: `s${this.#nextStackObjectId++}`,
      kind: 'spell',
      controllerId: playerId,
      sourceId: card.id,
      sourceName: card.name,
      text: card.name,
      card,
      ...(targets ? { targets: [...targets] } : {}),
      ...(manaColor ? { manaColor } : {}),
      ...(mode !== undefined ? { mode: Array.isArray(mode) ? [...mode] : mode } : {}),
      ...(x !== undefined ? { x } : {}),
    };
    // 601.2f: the total cost, after any cost reduction, plus any mana in an additional cost.
    const alternative = costChoices?.alternative !== undefined ? additionalCost.anyOf[costChoices.alternative] : additionalCost;
    const cost = addCosts(this.#spellCost(playerId, card, { x, targets }), alternative?.mana);
    this.#stack.push(stackObject);
    const manaPaid = this.#payManaFrom(playerId, cost, card);
    // Boromir: "if no mana was spent to cast it".
    stackObject.manaSpent = MANA_TYPES.reduce((sum, type) => sum + manaPaid[type], manaPaid.any ?? 0);
    if (definition.cantBeCountered || manaPaid.uncounterable) stackObject.uncounterable = true;
    delete manaPaid.uncounterable;
    // 601.2f: additional costs, such as sacrificing a creature, are part of the total cost.
    const additionalCostPaid = alternative ? this.#payCost(playerId, null, { ...alternative, mana: undefined }, costChoices ?? {}) : null;
    if (additionalCostPaid?.sacrificedObjects) stackObject.sacrificed = additionalCostPaid.sacrificedObjects;
    // Long List of the Ents: the next creature spell of a noted type enters with a +1/+1 counter.
    if (isCreature(card)) {
      const notes = zone.turnTally.notedTypes;
      const matching = notes.filter((type) => hasSubtype(card, type));
      if (matching.length) {
        card.extraCounters = (card.extraCounters ?? 0) + matching.length;
        zone.turnTally.notedTypes = notes.filter((type) => !matching.includes(type));
      }
    }
    zone.turnTally.spellsCast += 1;
    this.#emitEvent('spellCast', {
      playerId,
      cardId,
      cardName: card.name,
      manaPaid,
      ...(additionalCostPaid ? { additionalCostPaid: publicPaid(additionalCostPaid) } : {}),
      stackObjectId: stackObject.id,
      targets: targets ?? [],
      ...(mode !== undefined ? { mode } : {}),
      ...(x !== undefined ? { x } : {}),
    });
    // 601.2i: abilities that trigger on a spell being cast ("Whenever a player casts a green spell"). The
    // subject is the spell: its card, with its stack object and targets.
    const subject = { ...card, controllerId: playerId, stackObjectId: stackObject.id, manaSpent: stackObject.manaSpent, targets: [...(targets ?? [])] };
    this.#triggerWatchers(TRIGGER.SPELL_CAST, subject, {
      matches: (ability, source) => (!ability.filter?.nthThisTurn || ability.filter.nthThisTurn === zone.turnTally.spellsCast)
        // Legolas, Master Archer: "a spell that targets Legolas", "a spell that targets a creature you don't control".
        && (!ability.targetsSource || subject.targets.includes(source.id))
        && (!ability.targetsCreatureYouDontControl || subject.targets.some((id) => {
          const target = this.#permanent(id);
          return target && isCreature(target) && target.controllerId !== source.controllerId;
        })),
    });
    this.#checkWard(stackObject);
    // 117.3c: the caster receives priority.
    this.#resetPasses();
    this.#givePriority(playerId);
  }

  #canActivate(playerId, source, ability) {
    if (ability.timing === ACTIVATION_TIMING.SORCERY && !this.#hasSorceryTiming(playerId)) return false;
    // Like 606.3 for loyalty abilities: a limited number of activations per emblem each turn.
    if (source.emblemId && source.activationsThisTurn >= source.activationsPerTurn) return false;
    // "Activate only once each turn."
    if (ability.oncePerTurn && this.#zones.get(playerId).turnTally.activated?.[`${source.id}:${ability.id}`]) return false;
    // "Activate only if you control a legendary creature."
    if (ability.activationCondition && !this.#checkCondition(ability.activationCondition, playerId, { sourceId: source.id })) return false;
    return this.#canPayCost(playerId, source, ability.cost, null);
  }

  /**
   * `permanent` is the ability's source: a permanent, an emblem, a card in a hand or
   * graveyard, or null for a spell's cost. `mana` is the mana to check, when it isn't the
   * cost's own (X, reductions); null leaves mana to the caller.
   */
  #canPayCost(playerId, permanent, cost, mana = cost.mana) {
    // 119.4: a player can pay life only if their life total is at least that much.
    if (cost.life && this.#zones.get(playerId).life < cost.life) return false;
    // Only a permanent can be tapped or sacrificed (701.21, 701.17).
    if ((cost.tap || cost.sacrificeSelf) && !this.#permanent(permanent?.id)) return false;
    if (cost.tap) {
      if (permanent.tapped) return false;
      // 302.6: a creature's {T} abilities can't be activated unless its controller
      // has controlled it continuously since their most recent turn began.
      if (this.#hasSummoningSickness(permanent)) return false;
    }
    if (mana && !canPayMana(this.#poolFor(playerId, null), mana)) return false;
    // "Discard this card" (cycling, 702.29a): it must be in its owner's hand.
    if (cost.discardSelf && !this.#zones.get(playerId).hand.some((c) => c.id === permanent?.id)) return false;
    // "Exile this card from your graveyard": it must be there.
    if (cost.exileSelfFromGraveyard && !this.#zones.get(playerId).graveyard.some((c) => c.id === permanent?.id)) return false;
    // "Exile three cards from your graveyard" (chosen as it's paid, see CHOICE.EXILE_COST).
    if (cost.exileFromGraveyard && this.#zones.get(playerId).graveyard.length < cost.exileFromGraveyard) return false;
    // "Remove an indestructible counter from Arwen".
    if (cost.removeCounter && !((permanent?.counters?.[cost.removeCounter.counter] ?? 0) >= (cost.removeCounter.count ?? 1))) return false;
    // Choices such as which creature to sacrifice are checked by #costChoiceOptions.
    return true;
  }

  /** 601.2h / 602.2b: pay the cost, with the choices it needs. Returns what was paid. */
  #payCost(playerId, permanent, cost, choices = {}, mana = cost.mana) {
    const paid = {};
    if (cost.tap) {
      permanent.tapped = true;
      paid.tap = true;
    }
    if (mana) paid.mana = this.#payManaFrom(playerId, mana, null);
    if (cost.life) {
      this.#zones.get(playerId).life -= cost.life;
      paid.life = cost.life;
    }
    for (const id of choices.tap ?? []) {
      // Crew: tapping untapped creatures is part of the cost.
      const creature = this.#permanent(id);
      creature.tapped = true;
      this.#emitEvent('permanentTapped', { cardId: id, sourceId: permanent?.id ?? null });
    }
    if (choices.tap?.length) paid.tapped = [...choices.tap];
    const sacrificed = [
      ...(cost.sacrificeSelf ? [permanent] : []),
      ...(choices.sacrifice ?? []).map((id) => this.#permanent(id)),
    ];
    if (sacrificed.length) {
      paid.sacrificed = sacrificed.map((p) => p.id);
      paid.sacrificedObjects = sacrificed.map((p) => ({ ...p }));
    }
    for (const sacrifice of sacrificed) this.#sacrifice(sacrifice, playerId);
    const discards = [...(cost.discardSelf ? [permanent.id] : []), ...(choices.discard ?? [])];
    if (discards.length) {
      for (const id of discards) this.#discardCard(playerId, id);
      paid.discarded = discards;
    }
    if (cost.removeCounter) {
      const { counter, count = 1 } = cost.removeCounter;
      permanent.counters[counter] -= count;
      if (!permanent.counters[counter]) delete permanent.counters[counter];
      this.#applyContinuousEffects();
      this.#emitEvent('countersRemoved', { cardId: permanent.id, counter, count, counters: { ...permanent.counters } });
      paid.removedCounters = { [counter]: count };
    }
    if (cost.exileSelfFromGraveyard) {
      const zone = this.#zones.get(playerId);
      zone.exile.push(...zone.graveyard.splice(zone.graveyard.findIndex((c) => c.id === permanent.id), 1));
      this.#emitEvent('cardExiledFromGraveyard', { playerId, cardId: permanent.id, sourceId: permanent.id });
      paid.exiled = [permanent.id];
    }
    return paid;
  }

  #activateAbility(playerId, cardId, abilityId, targets, costChoices, manaColor, x) {
    const permanent = this.#findSource(cardId);
    const ability = this.#abilitiesOf(permanent).find((a) => a.id === abilityId);
    const mana = this.#abilityManaCost(playerId, permanent, ability, x);
    const costPaid = this.#payCost(playerId, permanent, ability.cost, costChoices, mana);
    if (permanent.emblemId) permanent.activationsThisTurn += 1;
    if (ability.oncePerTurn) {
      const tally = this.#zones.get(playerId).turnTally;
      tally.activated = { ...tally.activated, [`${cardId}:${abilityId}`]: true };
    }
    if (ability.cost.discardSelf) this.#emitEvent('cardCycled', { playerId, cardId, cardName: permanent.name });
    const activation = {
      playerId, cardId, cardName: permanent.name, abilityId, text: ability.text, costPaid: publicPaid(costPaid),
    };
    this.#resetPasses();

    if (isManaAbility(ability)) {
      // 605.3b: a mana ability doesn't use the stack; it resolves immediately and
      // the player keeps priority.
      this.#emitEvent('abilityActivated', { ...activation, usesStack: false });
      const context = { sourceId: cardId, manaColor, x: x ?? 0, targets: [], sacrificed: costPaid.sacrificedObjects ?? [] };
      for (const effect of abilityEffects(ability)) this.#applyEffect(effect, playerId, context);
      return;
    }

    // 602.2a: the ability goes on the stack, then (602.2b) its costs are paid.
    const kinds = targetList(ability);
    const stackObject = {
      id: `s${this.#nextStackObjectId++}`,
      kind: 'activatedAbility',
      controllerId: playerId,
      sourceId: cardId,
      sourceName: permanent.name,
      abilityId,
      text: ability.text,
      effects: structuredClone(abilityEffects(ability)),
      ...(targets ? { targets: [...targets], targetKind: kinds.length === 1 ? kinds[0] : null, targetKinds: kinds } : {}),
      ...(manaColor ? { manaColor } : {}),
      ...(x !== undefined ? { x } : {}),
      ...(costPaid.sacrificedObjects ? { sacrificed: costPaid.sacrificedObjects } : {}),
    };
    this.#stack.push(stackObject);
    this.#emitEvent('abilityActivated', {
      ...activation, usesStack: true, stackObjectId: stackObject.id, targets: targets ?? [],
    });
    this.#checkWard(stackObject);
    if (ability.cost.exileFromGraveyard) {
      // Mines of Moria: the cards to exile are chosen as the cost is paid (601.2h), before anyone gets priority.
      const { graveyard } = this.#zones.get(playerId);
      const n = ability.cost.exileFromGraveyard;
      this.#priorityPlayerId = null;
      this.#requireDecision({
        type: DECISION.CHOOSE_MANY, kind: CHOICE.EXILE_COST, playerId, sourceId: cardId, sourceName: permanent.name,
        options: graveyard.map((c) => c.id), cards: structuredClone(graveyard), min: n, max: n, selected: [],
      });
      return;
    }
    // 117.3c: the player who activated the ability receives priority.
    this.#givePriority(playerId);
  }

  /**
   * 702.21a: ward triggers when a permanent with ward becomes the target of a spell or
   * ability an opponent controls: counter it unless that player pays the ward cost.
   */
  #checkWard(stackObject) {
    for (const id of new Set(stackObject.targets ?? [])) {
      const permanent = id && this.#permanent(id);
      if (!permanent || permanent.controllerId === stackObject.controllerId || !hasKeyword(permanent, KEYWORD.WARD)) continue;
      // Each ward ability triggers separately (702.21b).
      for (const cost of permanent.wards?.length ? permanent.wards : [{ mana: { generic: 1 } }]) this.#pendingTriggers.push({
        id: `t${this.#nextTriggerId++}`,
        sourceId: permanent.id,
        sourceName: permanent.name,
        controllerId: permanent.controllerId,
        abilityId: 'ward',
        text: `Ward—${formatMana(cost.mana ?? {})}`,
        trigger: 'ward',
        effects: [{ type: EFFECT.COUNTER_UNLESS_PAID, cost, affected: AFFECTED.SUBJECT }],
        targetKind: null,
        subject: { id: stackObject.id, controllerId: stackObject.controllerId },
      });
    }
  }

  /** LOOK_AT_TOP: look at the top cards of your library and maybe put some into your hand (the rest go on the bottom). */
  #lookAtTop(playerId, effect, context) {
    const { library } = this.#zones.get(playerId);
    const n = Math.min(effect.count ?? 1, library.length);
    if (n <= 0) return;
    const looked = library.slice(0, n);
    // Radagast: "a creature card that doesn't share a creature type with a creature you control".
    const yours = this.#battlefield.filter((p) => p.controllerId === playerId && isCreature(p));
    const options = looked.filter((c) => matchesFilter(c, { controller: 'any', ...effect.filter }, this.#filterContext(playerId, context.sourceId))
      && (!effect.sharesNoCreatureType || !yours.some((p) => (p.subtypes ?? []).some((t) => hasSubtype(c, t))))).map((c) => c.id);
    this.#ask({
      type: DECISION.CHOOSE_MANY, kind: CHOICE.LOOK, playerId, options, cards: structuredClone(looked), looked: looked.map((c) => c.id),
      min: 0, max: Math.min(effect.max ?? 1, options.length), libraryTop: n,
    });
  }

  /** REVEAL_UNTIL: `ownerId` reveals cards until `count` match; those go onto the battlefield under `controllerId`'s control. */
  #revealUntil(ownerId, controllerId, effect, sourceId) {
    const zone = this.#zones.get(ownerId);
    const wanted = effect.count ?? 1;
    const revealed = [];
    const hits = [];
    while (zone.library.length && hits.length < wanted) {
      const card = zone.library.shift();
      revealed.push(card);
      if (matchesFilter(card, { controller: 'any', ...effect.filter }, this.#filterContext(controllerId, sourceId))) hits.push(card);
    }
    if (revealed.length === 0) return;
    this.#emitEvent('cardsRevealed', { playerId: ownerId, cards: this.#forEvent(revealed), sourceId });
    const rest = revealed.filter((c) => !hits.includes(c));
    for (const card of hits) {
      if (this.#atLimit(controllerId, card)) {
        rest.push(card);
        continue;
      }
      const permanent = this.#putOntoBattlefield(card, controllerId, { tapped: effect.tapped });
      this.#emitEvent('permanentEntered', { playerId: controllerId, card: this.#forEvent(permanent), fromLibrary: true });
    }
    if (effect.rest === 'graveyard') {
      zone.graveyard.push(...rest);
      if (rest.length) this.#emitEvent('cardsMilled', { playerId: ownerId, cardIds: rest.map((c) => c.id), librarySize: zone.library.length });
    } else {
      // "the rest on the bottom of your library in a random order".
      shuffle(rest, this.#random);
      zone.library.push(...rest);
    }
  }

  #resolveTopOfStack() {
    // 608.2: the top object resolves.
    const stackObject = this.#stack.pop();
    this.#emitEvent('stackObjectResolving', { stackObject: this.#forEvent(stackObject) });
    const { controllerId, targets = [] } = stackObject;
    const definition = stackObject.kind === 'spell' ? this.#cardDefinitions[stackObject.card.cardId] : null;
    const mode = definition?.modes && stackObject.mode !== undefined ? this.#spellHolder(definition, stackObject.mode) : null;
    const effects = definition ? (mode ?? definition).effects ?? [] : stackObject.effects;
    const kinds = definition
      ? (definition.enchant ? [definition.enchant] : targetList(mode ?? definition))
      : stackObject.targetKinds ?? (stackObject.targetKind ? [stackObject.targetKind] : []);
    const excludeId = effects.some((e) => e.type === EFFECT.ATTACH) ? stackObject.sourceId : null;
    // Last known information about the targets (608.2h), for "its controller" once it's gone.
    const lki = {};
    for (const id of targets) if (id) lki[id] = this.#lastKnown(id);
    // 608.2b: each target is checked again; an illegal one is left out (kept in its place as null).
    const contextTargets = targets.map((id, i) => {
      if (!id) return null;
      const kind = kinds[Math.min(i, kinds.length - 1)];
      return kind && this.#isLegalTarget(kind, id, controllerId, excludeId, {
        sourceId: stackObject.sourceId, x: stackObject.x, chosen: targets.slice(0, i), amassedArmyId: stackObject.amassedArmyId,
      })
        ? id : null;
    });
    const chosen = targets.filter(Boolean).length;
    const legal = contextTargets.filter(Boolean).length;
    const abilityKey = stackObject.kind === 'spell' ? null : `${stackObject.sourceId}:${stackObject.abilityId}`;
    const context = {
      sourceId: stackObject.sourceId,
      targets: contextTargets,
      manaColor: stackObject.manaColor,
      x: stackObject.x ?? 0,
      subject: stackObject.subject ?? null,
      lki,
      sacrificed: [],
      ...(stackObject.amassedArmyId ? { amassedArmyId: stackObject.amassedArmyId } : {}),
      ...(stackObject.costPaid ? { costPaid: stackObject.costPaid } : {}),
      ...(abilityKey ? { abilityKey } : {}),
    };

    if (chosen > 0 && legal === 0) {
      // 608.2b: with every target illegal, it doesn't resolve. A spell goes to its owner's graveyard.
      if (stackObject.kind === 'spell') this.#zones.get(stackObject.card.ownerId).graveyard.push(stackObject.card);
      this.#emitEvent('stackObjectFizzled', { stackObjectId: stackObject.id, reason: 'All targets are illegal.' });
      this.#endResolution(stackObject);
      return;
    }
    if (stackObject.condition && !this.#checkCondition(stackObject.condition, controllerId, context)) {
      // 603.4: an intervening "if" that's no longer true: the ability does nothing.
      this.#emitEvent('stackObjectFizzled', { stackObjectId: stackObject.id, reason: 'Its condition is no longer true.' });
      this.#endResolution(stackObject);
      return;
    }
    if (stackObject.kind === 'spell' && isPermanentCard(stackObject.card)) {
      // 608.3: a permanent spell enters the battlefield under its controller's control.
      const permanent = this.#putOntoBattlefield(stackObject.card, controllerId, { x: stackObject.x });
      // 303.4f: an Aura spell enters attached to the object it targeted.
      if (isAura(permanent)) this.#attach(permanent, contextTargets[0]);
      this.#emitEvent('permanentEntered', { playerId: controllerId, card: this.#forEvent(permanent) });
      this.#endResolution(stackObject);
      return;
    }
    if (abilityKey) {
      const resolved = this.#zones.get(controllerId).turnTally.resolved;
      resolved[abilityKey] = (resolved[abilityKey] ?? 0) + 1;
      context.resolvedThisTurn = resolved[abilityKey];
    }
    // 608.2c: the effects happen in order. "You may" abilities without a target ask first.
    const frames = [{ effects, index: 0 }];
    this.#resolving = { stackObject, controllerId, frames, context };
    if (stackObject.mayOnResolution) {
      frames[0] = { effects: [{ type: EFFECT.MAY, effects }], index: 0 };
    }
    this.#continueResolution();
  }

  /**
   * Applies the resolving object's remaining effects, stopping when one needs a player's
   * choice (the choice's action carries on from there), then finishes it.
   */
  #continueResolution() {
    const resolving = this.#resolving;
    while (resolving.frames.length > 0) {
      const frame = resolving.frames.at(-1);
      if (frame.index >= frame.effects.length) {
        resolving.frames.pop();
        continue;
      }
      const effect = frame.effects[frame.index++];
      this.#applyEffect(effect, resolving.controllerId, resolving.context);
      if (this.#pendingDecision || this.#status !== GAME_STATUS.IN_PROGRESS) return;
    }
    this.#resolving = null;
    const { stackObject } = resolving;
    // 608.2n: an instant or sorcery goes to its owner's graveyard (unless it went somewhere else).
    if (stackObject.kind === 'spell') this.#zones.get(stackObject.card.ownerId).graveyard.push(stackObject.card);
    this.#endResolution(stackObject);
  }

  #endResolution(stackObject) {
    this.#emitEvent('stackObjectResolved', { stackObjectId: stackObject.id });
    // 117.3b: after resolution, the active player receives priority.
    this.#resetPasses();
    this.#givePriority(this.#activePlayerId);
  }

  /** Runs effects in a nested frame: inside a resolution, after the current effect; otherwise now. */
  #runEffects(effects, controllerId, context) {
    if (this.#resolving) {
      this.#resolving.frames.push({ effects, index: 0 });
      return;
    }
    for (const effect of effects) this.#applyEffect(effect, controllerId, context);
  }

  /** Asks a player to choose while something resolves (DECISION.CHOOSE / CHOOSE_MANY). */
  #ask(decision) {
    this.#priorityPlayerId = null;
    const resolving = this.#resolving;
    this.#requireDecision({
      sourceId: resolving?.context.sourceId ?? null,
      sourceName: resolving?.stackObject.sourceName ?? null,
      ...decision,
      ...(decision.type === DECISION.CHOOSE_MANY ? { selected: decision.selected ?? [] } : {}),
    });
  }

  /** What an object was, as last seen (608.2h): a permanent, a spell, a card in a graveyard, or a player. */
  #lastKnown(id) {
    const permanent = this.#permanent(id);
    if (permanent) return { ...permanent };
    const spell = this.#stack.find((s) => s.id === id);
    if (spell) return { ...(spell.card ?? {}), id, controllerId: spell.controllerId, stackObject: true };
    for (const [playerId, zone] of this.#zones) {
      const card = zone.graveyard.find((c) => c.id === id);
      if (card) return { ...card, controllerId: playerId };
    }
    return this.#zones.has(id) ? { id, player: true } : null;
  }

  /** An object as it is now, or as it last was. */
  #currentOrLastKnown(id, context) {
    return this.#permanent(id) ?? context.lki?.[id] ?? (id ? this.#lastKnown(id) : null);
  }

  /** Players with their graveyards, for countOf. */
  #graveyardsView() {
    return [...this.#zones].map(([id, zone]) => ({ id, graveyard: zone.graveyard }));
  }

  /** A "for each" / "where X is" number (608.2h), including the ones only a resolution knows. */
  #countFor(per, controllerId, context = {}) {
    const ref = (spec) => {
      if (spec.who === 'source') return this.#currentOrLastKnown(context.sourceId, context);
      // A trigger's subject as it last was: "When this creature dies, it deals damage equal to its power".
      if (spec.who === 'subject') return context.subject ? this.#permanent(context.subject.id) ?? context.subject : null;
      return this.#currentOrLastKnown(context.targets?.[spec.index ?? 0], context);
    };
    switch (per.of) {
      case 'x': return context.x ?? 0;
      case 'eventCount': return context.subject?.count ?? 0;
      case 'sacrificedCount': return context.sacrificed?.length ?? 0;
      case 'amassedArmyPower': {
        const army = this.#permanent(context.amassedArmyId);
        return Math.max(0, army?.power ?? 0);
      }
      case 'powerOf': return Math.max(0, ref(per)?.power ?? 0);
      // Radagast: "where X is that creature's mana value".
      case 'subjectManaValue': return manaValue(context.subject ? this.#currentOrLastKnown(context.subject.id, context)?.manaCost ?? context.subject.manaCost : null);
      // Spiteful Banditry: the X paid to cast this permanent (107.3m).
      case 'sourceX': return this.#currentOrLastKnown(context.sourceId, context)?.xPaid ?? 0;
      // One Ring to Rule Them All: "your Ring-bearer's power".
      case 'ringBearerPower': return Math.max(0, this.#ringBearer(controllerId)?.power ?? 0);
      // The Balrog: "each permanent sacrificed this turn" (by anyone).
      case 'permanentsSacrificedThisTurn': return [...this.#zones.values()].reduce((sum, z) => sum + z.turnTally.sacrificed, 0);
      // Shagrat: "the number of Equipment attached to Shagrat".
      case 'equipmentAttachedToSource': return this.#battlefield.filter((p) => isEquipment(p) && p.attachedTo === context.sourceId).length;
      // Dawn of a New Age, Lost Isle Calling: counters on the source (as it last was).
      case 'sourceCounters': return this.#currentOrLastKnown(context.sourceId, context)?.counters?.[per.counter] ?? 0;
      case 'toughnessOf': return Math.max(0, ref(per)?.toughness ?? 0);
      case 'cards':
        if (per.whose === 'target') return countOf({ ...per, whose: 'you', playerId: context.targets?.[per.index ?? 0] }, { battlefield: this.#battlefield, controllerId, players: this.#graveyardsView() });
        break;
      default:
        break;
    }
    if (per.sum) return per.sum.reduce((total, part) => total + this.#countFor(part, controllerId, context), 0);
    return countOf(per, {
      battlefield: this.#battlefield, controllerId, sourceId: context.sourceId ?? null, combat: this.#combat, players: this.#graveyardsView(),
    });
  }

  /** The filter context for matchesFilter, from `controllerId`'s point of view. */
  #filterContext(controllerId, sourceId = null, x = null) {
    return { controllerId, sourceId, combat: this.#combat, x, turn: this.#turn };
  }

  /**
   * Whether a condition holds (603.4, 608.2c), for `controllerId` with a resolution's
   * `context` (`sourceId`, `targets`, `subject`, ...). See CONDITIONS in cards.js.
   */
  #checkCondition(condition, controllerId, context = {}) {
    if (!condition) return true;
    const zone = this.#zones.get(controllerId);
    const matches = (object, filter) => object && matchesFilter(object, { controller: 'any', ...filter }, this.#filterContext(controllerId, context.sourceId, context.x));
    if (condition.all) return condition.all.every((c) => this.#checkCondition(c, controllerId, context));
    if (condition.any) return condition.any.some((c) => this.#checkCondition(c, controllerId, context));
    if (condition.not) return !this.#checkCondition(condition.not, controllerId, context);
    if (condition.youControl) {
      const count = this.#battlefield.filter((p) => matchesFilter(p, { ...condition.youControl, controller: 'you' }, this.#filterContext(controllerId, context.sourceId))).length;
      return count >= (condition.atLeast ?? 1);
    }
    if (condition.targetMatches) return Boolean(matches(this.#currentOrLastKnown(context.targets?.[condition.targetIndex ?? 0], context), condition.targetMatches));
    if (condition.targetEquipped) {
      const id = context.targets?.[condition.targetIndex ?? 0];
      return this.#battlefield.some((p) => isEquipment(p) && p.attachedTo === id);
    }
    if (condition.subjectMatches) return Boolean(context.subject && matches(this.#currentOrLastKnown(context.subject.id, context) ?? context.subject, condition.subjectMatches));
    if (condition.sacrificedMatches) return (context.sacrificed ?? []).some((p) => matches(p, condition.sacrificedMatches));
    if (condition.youSacrificed) return (context.sacrificed ?? []).some((p) => p.controllerId === controllerId);
    if (condition.hostMatches) {
      const host = this.#permanent(this.#permanent(context.sourceId)?.attachedTo);
      return Boolean(host && matches(host, condition.hostMatches));
    }
    if ('paid' in condition) return Boolean(context.paid) === condition.paid;
    if (condition.creatureDiedThisTurn) return zone.turnTally.creatureDied;
    if (condition.permanentLeftThisTurn) return zone.turnTally.permanentLeft;
    if (condition.drawnAtLeast) return zone.turnTally.cardsDrawn >= condition.drawnAtLeast;
    if ('ringBearer' in condition) return Boolean(this.#ringBearer(controllerId)) === condition.ringBearer;
    if (condition.sourceIsRingBearer) return this.#ringBearer(controllerId)?.id === context.sourceId;
    if (condition.chosenOtherThanSource) return Boolean(context.subject?.chosenId) && context.subject.chosenId !== context.sourceId;
    if (condition.resolvedThisTurn) return context.resolvedThisTurn === condition.resolvedThisTurn;
    if (condition.revealedMatches) return Boolean(context.revealed && matches(context.revealed, condition.revealedMatches));
    if (condition.sourceTapped) return Boolean(this.#permanent(context.sourceId)?.tapped);
    // "Do this only once each turn": an effect with `mark` did it.
    if (condition.unmarked) return !this.#zones.get(controllerId).turnTally.triggered[`${context.sourceId}:${condition.unmarked}`];
    if (condition.yourTurn) return this.#activePlayerId === controllerId;
    // Boromir: "if no mana was spent to cast it".
    if (condition.noManaSpent) return context.subject?.manaSpent === 0;
    // Call of the Ring: "Whenever you choose a creature as your Ring-bearer".
    if (condition.ringBearerChosen) return Boolean(context.subject?.chosenId);
    // Barad-dûr: "if a creature died this turn" (anyone's).
    if (condition.anyCreatureDiedThisTurn) return [...this.#zones.values()].some((z) => z.turnTally.creatureDied);
    // Gimli, Mournful Avenger: "as long as two or more creatures died under your control this turn".
    if (condition.creaturesDiedThisTurn) return zone.turnTally.creaturesDied >= condition.creaturesDiedThisTurn;
    // Minas Tirith: "if you attacked with two or more creatures this turn".
    if (condition.attackedWithAtLeast) return zone.turnTally.attackedWith >= condition.attackedWithAtLeast;
    // Merry: "as long as it's equipped".
    if (condition.sourceEquipped) return this.#battlefield.some((p) => isEquipment(p) && p.attachedTo === context.sourceId);
    // Dawn of a New Age: "if this enchantment has no hope counters on it": `{ counter, max?, min? }`.
    if (condition.sourceCounters) {
      const { counter, min = 0, max = Infinity } = condition.sourceCounters;
      const n = this.#permanent(context.sourceId)?.counters[counter] ?? 0;
      return n >= min && n <= max;
    }
    // Sting: "as long as it's blocking or blocked by a Goblin or Orc" (the equipped creature).
    if (condition.hostBlockingOrBlockedBy) {
      const hostId = this.#permanent(context.sourceId)?.attachedTo;
      if (!hostId) return false;
      const others = this.#combat.attackers.flatMap((a) => (a.cardId === hostId ? a.blockerIds : a.blockerIds.includes(hostId) ? [a.cardId] : []));
      return others.some((id) => matches(this.#permanent(id), condition.hostBlockingOrBlockedBy));
    }
    if (condition.controlsGreatestPower) {
      const creatures = this.#battlefield.filter(isCreature);
      const greatest = Math.max(...creatures.map((p) => p.power));
      return creatures.some((p) => p.controllerId === controllerId && p.power === greatest);
    }
    throw new Error(`Unknown condition: ${JSON.stringify(condition)}`);
  }

  /** Your Ring-bearer (701.54a), if you still control it. */
  #ringBearer(playerId) {
    const { bearerId } = this.#zones.get(playerId).ring;
    const bearer = bearerId && this.#permanent(bearerId);
    return bearer && bearer.controllerId === playerId && isCreature(bearer) ? bearer : null;
  }

  /**
   * The ids of whatever an effect applies to: players, permanents or (for
   * countering) stack objects. Only legal targets reach here (608.2b).
   */
  #affectedBy(effect, controllerId, context) {
    const { sourceId, targets = [] } = context;
    const livePlayers = this.#players.map((p) => p.id).filter((id) => !this.#zones.get(id).hasLost);
    // "each green creature that entered this turn": `filter` narrows the creatures an effect affects.
    const creatures = this.#battlefield.filter((p) => isCreature(p)
      && (!effect.filter || matchesFilter(p, { controller: 'any', ...effect.filter }, this.#filterContext(controllerId, sourceId, context.x)))
      && !(effect.otherThanTarget !== undefined && p.id === targets[effect.otherThanTarget])
      && !(effect.controlledByTarget !== undefined && p.controllerId !== this.#currentOrLastKnown(targets[effect.controlledByTarget], context)?.controllerId));
    const target = () => (effect.targetIndex !== undefined ? [targets[effect.targetIndex]] : targets).filter(Boolean);
    switch (effectAffects(effect)) {
      case AFFECTED.TARGET: return target();
      case AFFECTED.YOU: return [controllerId];
      case AFFECTED.EACH_OPPONENT: return livePlayers.filter((id) => id !== controllerId);
      case AFFECTED.EACH_PLAYER: return livePlayers;
      case AFFECTED.EACH_CREATURE: return creatures.map((p) => p.id);
      case AFFECTED.EACH_CREATURE_YOU_CONTROL:
        return creatures.filter((p) => p.controllerId === controllerId).map((p) => p.id);
      case AFFECTED.EACH_CREATURE_OPPONENTS_CONTROL:
        return creatures.filter((p) => p.controllerId !== controllerId).map((p) => p.id);
      // 113.7a: if the source has left the battlefield, an effect on "this permanent" does nothing.
      case AFFECTED.SOURCE: return this.#permanent(sourceId) ? [sourceId] : [];
      case AFFECTED.ATTACHED_PERMANENT: {
        const host = this.#permanent(this.#permanent(sourceId)?.attachedTo);
        return host ? [host.id] : [];
      }
      case AFFECTED.TARGET_CONTROLLER:
        return target().map((id) => this.#currentOrLastKnown(id, context)?.controllerId).filter(Boolean);
      case AFFECTED.SUBJECT: return context.subject?.id ? [context.subject.id] : [];
      case AFFECTED.SUBJECT_CONTROLLER: return context.subject?.controllerId ? [context.subject.controllerId] : [];
      case AFFECTED.AMASSED_ARMY: return context.amassedArmyId && this.#permanent(context.amassedArmyId) ? [context.amassedArmyId] : [];
      case AFFECTED.CREATURES_BLOCKING_SOURCE:
        return this.#combat.attackers.find((a) => a.cardId === sourceId)?.blockerIds.filter((id) => this.#permanent(id)) ?? [];
      case AFFECTED.YOU_AND_TARGET: return [controllerId, ...target()];
      case AFFECTED.SACRIFICED: return (context.sacrificed ?? []).map((p) => p.id);
      case AFFECTED.SUBJECT_SPELL: return context.subject?.stackObjectId ? [context.subject.stackObjectId] : [];
      default: throw new Error(`Unknown affected: ${effect.affected}`);
    }
  }

  #applyEffect(effect, controllerId, context = {}) {
    const { sourceId, manaColor } = context;
    // 608.2c: "If …": an effect that only happens if its condition holds.
    if (effect.condition && !this.#checkCondition(effect.condition, controllerId, context)) return;
    // 608.2h: "for each" and "where X is" amounts are worked out as the effect happens.
    if (effect.per) {
      const { condition: _, ...scaled } = scaleEffect(effect, this.#countFor(effect.per, controllerId, context));
      this.#applyEffect(scaled, controllerId, context);
      return;
    }
    if (effect.type === EFFECT.FIGHT) {
      // Gimli, Mournful Avenger: "Gimli fights up to one target creature".
      if (effect.withSource) {
        this.#fight(sourceId, context.targets[effect.targetIndex ?? 0]);
        return;
      }
      const [first, second] = effect.targetIndexes ?? [0, 1];
      this.#fight(context.targets[first], context.targets[second]);
      return;
    }
    if (effect.mark) this.#zones.get(controllerId).turnTally.triggered[`${sourceId}:${effect.mark}`] = true;
    const ids = this.#affectedBy(effect, controllerId, context).filter(Boolean);
    // Permanents still on the battlefield, and players, among what the effect applies to.
    const permanents = () => ids.map((id) => this.#permanent(id)).filter(Boolean);
    const players = ids.filter((id) => this.#zones.has(id));
    switch (effect.type) {
      case EFFECT.DEAL_DAMAGE: {
        // "Target creature you control deals damage equal to its power to …": the damage comes from it.
        const from = effect.from ? this.#damageSourceOf(effect.from, context) : sourceId;
        if (effect.from && !from) break;
        for (const id of ids) this.#dealDamage(from, id, effect.amount, { excessToController: effect.excessToController });
        break;
      }
      case EFFECT.DESTROY:
        this.#leaving = permanents();
        for (const permanent of permanents()) {
          // 702.12b: an indestructible permanent can't be destroyed.
          if (hasKeyword(permanent, KEYWORD.INDESTRUCTIBLE)) continue;
          // 701.7a: move it from the battlefield to its owner's graveyard.
          this.#putIntoGraveyard(permanent);
          this.#emitEvent('permanentDestroyed', {
            cardId: permanent.id, cardName: permanent.name, controllerId: permanent.controllerId, sourceId,
          });
        }
        this.#leaving = [];
        break;
      case EFFECT.EXILE:
        for (const permanent of permanents()) {
          // 701.5a: move it to the exile zone.
          this.#moveFromBattlefield(permanent, 'exile');
          this.#emitEvent('permanentExiled', {
            cardId: permanent.id, cardName: permanent.name, controllerId: permanent.controllerId, sourceId,
          });
        }
        break;
      case EFFECT.RETURN_TO_HAND:
        for (const permanent of permanents()) {
          this.#moveFromBattlefield(permanent, 'hand');
          // Everyone saw which card went back.
          if (!permanent.token) this.#notesOf(permanent.ownerId)[permanent.id] = { revealed: true };
          this.#emitEvent('permanentReturnedToHand', {
            cardId: permanent.id, cardName: permanent.name, ownerId: permanent.ownerId, sourceId,
          });
          if (!permanent.token) this.#burnIfHandFull(permanent.ownerId, permanent.id, 'returnToHand');
        }
        break;
      case EFFECT.RETURN_FROM_GRAVEYARD:
        // Rise of the Witch-king: "you may return another permanent card from your graveyard" (chosen, not targeted).
        if (effect.choose) {
          const sacrificed = new Set((context.sacrificed ?? []).map((p) => p.id));
          const options = this.#zones.get(controllerId).graveyard
            .filter((c) => !sacrificed.has(c.id) && matchesFilter(c, { controller: 'any', ...effect.choose }, this.#filterContext(controllerId)))
            .map((c) => c.id);
          if (options.length) this.#ask({ type: DECISION.CHOOSE, kind: CHOICE.GRAVEYARD_CARD, playerId: controllerId, options: [...options, 'decline'], to: effect.to ?? 'hand' });
          break;
        }
        for (const id of ids) {
          const owner = [...this.#zones.entries()].find(([, zone]) => zone.graveyard.some((c) => c.id === id));
          if (!owner) continue;
          const [ownerId, zone] = owner;
          const [card] = zone.graveyard.splice(zone.graveyard.findIndex((c) => c.id === id), 1);
          this.#arriveFromGraveyard(card, ownerId, effect.to === 'battlefield' ? controllerId : null, { tapped: effect.tapped, sourceId });
        }
        break;
      case EFFECT.TAP:
      case EFFECT.UNTAP: {
        const tapped = effect.type === EFFECT.TAP;
        for (const permanent of permanents().filter((p) => p.tapped !== tapped)) {
          permanent.tapped = tapped;
          this.#emitEvent(tapped ? 'permanentTapped' : 'permanentUntapped', { cardId: permanent.id, sourceId });
        }
        break;
      }
      case EFFECT.PUMP: {
        // "gains your choice of lifelink or indestructible": the choice comes first.
        if (effect.keywordChoice) {
          if (permanents().length === 0) break;
          this.#ask({
            type: DECISION.CHOOSE, kind: CHOICE.KEYWORD, playerId: controllerId, options: [...effect.keywordChoice], effect, ids,
          });
          break;
        }
        this.#pump(effect, permanents(), controllerId, sourceId);
        break;
      }
      case EFFECT.ADD_COUNTERS:
        for (const permanent of permanents()) this.#addCounters(permanent, effect.counter ?? COUNTER.PLUS_ONE, effect.count ?? 1, controllerId);
        break;
      case EFFECT.COUNTER_SPELL:
        for (const id of ids) {
          // 701.6a: a countered spell is removed from the stack and put into its owner's graveyard.
          const index = this.#stack.findIndex((s) => s.id === id);
          if (index === -1) continue;
          // "This spell can't be countered." (101.2)
          if (this.#stack[index].uncounterable) {
            this.#emitEvent('counterPrevented', { stackObjectId: id, sourceId });
            continue;
          }
          const [countered] = this.#stack.splice(index, 1);
          if (countered.card) this.#zones.get(countered.card.ownerId).graveyard.push(countered.card);
          this.#emitEvent('spellCountered', {
            stackObjectId: id, cardId: countered.card?.id, cardName: countered.card?.name ?? countered.sourceName, sourceId,
          });
        }
        break;
      case EFFECT.RETURN_SPELL_TO_HAND:
        for (const id of ids) {
          const index = this.#stack.findIndex((s) => s.id === id && s.kind === 'spell');
          if (index === -1) continue;
          const [returned] = this.#stack.splice(index, 1);
          const { ownerId } = returned.card;
          this.#zones.get(ownerId).hand.push(returned.card);
          this.#notesOf(ownerId)[returned.card.id] = { revealed: true };
          this.#emitEvent('spellReturnedToHand', { stackObjectId: id, cardId: returned.card.id, cardName: returned.card.name, ownerId, sourceId });
          this.#burnIfHandFull(ownerId, returned.card.id, 'returnToHand');
        }
        break;
      case EFFECT.ATTACH: {
        // 701.3a: attach the source to the target; nothing happens if the source has left.
        const source = this.#permanent(sourceId);
        // Shagrat: "attach up to one target Equipment to it" (the other way round; its controller doesn't change).
        if (effect.toSource) {
          const equipment = this.#permanent(ids[0]);
          if (equipment && source && isCreature(source) && equipment.attachedTo !== source.id) this.#attach(equipment, source.id);
          break;
        }
        const hostId = ids[0];
        if (source && hostId && source.controllerId === controllerId) this.#attach(source, hostId);
        break;
      }
      case EFFECT.ADD_MANA: {
        for (const playerId of players) {
          const zone = this.#zones.get(playerId);
          if (effect.anyCombination !== undefined) {
            if (effect.anyCombination <= 0) continue;
            // Mana in any combination of colors, or only for some spells, is kept as mana of any color.
            zone.specialMana.push({ amount: effect.anyCombination, restriction: effect.restriction ?? null, ...(effect.uncounterable ? { uncounterable: true } : {}) });
            this.#emitEvent('manaAdded', { playerId, mana: { any: effect.anyCombination }, manaPool: { ...zone.manaPool }, specialMana: structuredClone(zone.specialMana) });
            continue;
          }
          const mana = effect.mana ?? { [manaColor]: effect.anyColor };
          addMana(zone.manaPool, mana);
          this.#emitEvent('manaAdded', { playerId, mana: { ...mana }, manaPool: { ...zone.manaPool } });
        }
        break;
      }
      case EFFECT.DRAW_CARDS:
        for (const playerId of players) this.#drawCards(playerId, effect.count);
        break;
      case EFFECT.GAIN_LIFE:
        for (const playerId of players) this.#gainLife(playerId, effect.amount);
        break;
      case EFFECT.LOSE_LIFE:
        for (const playerId of players) {
          const zone = this.#zones.get(playerId);
          // "Each opponent loses 1 life for each creature card in that player's graveyard": counted for each of them.
          const amount = effect.perPlayer ? effect.amount * this.#countFor(effect.perPlayer, playerId, context) : effect.amount;
          if (amount <= 0) continue;
          zone.life -= amount;
          this.#emitEvent('lifeLost', { playerId, amount, life: zone.life });
        }
        break;
      case EFFECT.MILL:
        for (const playerId of players) {
          // 701.13a: the top cards of the library go to the graveyard (as many as there are).
          const zone = this.#zones.get(playerId);
          const milled = zone.library.splice(0, effect.count);
          zone.graveyard.push(...milled);
          this.#emitEvent('cardsMilled', { playerId, cardIds: milled.map((c) => c.id), librarySize: zone.library.length });
        }
        break;
      case EFFECT.CREATE_TOKEN:
        for (const playerId of players) this.#createTokens(effect, playerId, sourceId);
        break;
      case EFFECT.SCRY:
        for (const playerId of players) this.#scry(playerId, effect.count);
        break;
      case EFFECT.RING_TEMPTS:
        for (const playerId of players) this.#ringTempts(playerId);
        break;
      case EFFECT.AMASS:
        this.#amass(controllerId, effect, context);
        break;
      case EFFECT.DISCARD:
        this.#askDiscard(players, effect.count ?? 1);
        break;
      case EFFECT.REVEAL_HAND_DISCARD:
        for (const playerId of players) {
          const { hand } = this.#zones.get(playerId);
          this.#emitEvent('handRevealed', { playerId, cards: this.#forEvent(hand), sourceId });
          for (const card of hand) this.#notesOf(playerId)[card.id] = { revealed: true };
          const options = hand.filter((c) => matchesFilter(c, { controller: 'any', ...effect.filter }, this.#filterContext(controllerId))).map((c) => c.id);
          if (options.length === 0) continue;
          this.#ask({
            type: DECISION.CHOOSE, kind: CHOICE.REVEALED_CARD, playerId: controllerId, owner: playerId, options, cards: structuredClone(hand),
          });
          return;
        }
        break;
      case EFFECT.SEARCH_LIBRARY:
        this.#searchLibrary(controllerId, effect, context);
        break;
      case EFFECT.PUT_FROM_HAND_ON_BOTTOM: {
        const { hand } = this.#zones.get(controllerId);
        if (hand.length === 0) break;
        this.#ask({
          type: DECISION.CHOOSE, kind: CHOICE.BOTTOM_FROM_HAND, playerId: controllerId, options: hand.map((c) => c.id), remaining: effect.count ?? 1,
        });
        break;
      }
      case EFFECT.PUT_INTO_LIBRARY:
        for (const id of ids) this.#putIntoLibrary(id, effect.position ?? 1, sourceId);
        break;
      case EFFECT.GAIN_CONTROL: {
        const newController = effect.toTarget !== undefined ? context.targets[effect.toTarget] : controllerId;
        if (!newController) break;
        // Rangers of Ithilien, Scroll of Isildur: "for as long as you control this creature" (it must still be there).
        if (effect.whileSourceControlled && this.#permanent(sourceId)?.controllerId !== controllerId) break;
        for (const permanent of permanents()) {
          this.#changeControl(permanent, newController, { untilEndOfTurn: effect.untilEndOfTurn, whileSourceControlled: effect.whileSourceControlled, sourceId });
        }
        break;
      }
      case EFFECT.FLICKER:
        for (const permanent of permanents()) {
          this.#moveFromBattlefield(permanent, 'exile');
          this.#emitEvent('permanentExiled', { cardId: permanent.id, cardName: permanent.name, controllerId: permanent.controllerId, sourceId });
          if (permanent.token) continue;
          // 400.7: it returns as a new object.
          const exile = this.#zones.get(permanent.ownerId).exile;
          const [card] = exile.splice(exile.findIndex((c) => c.id === permanent.id), 1);
          const returned = this.#putOntoBattlefield(card, controllerId);
          this.#emitEvent('permanentEntered', { playerId: controllerId, card: this.#forEvent(returned) });
        }
        break;
      case EFFECT.EXILE_UNTIL_SOURCE_LEAVES: {
        // 610.3c: if the source has already left, nothing is exiled.
        const source = this.#permanent(sourceId);
        if (!source) break;
        for (const permanent of permanents()) {
          this.#moveFromBattlefield(permanent, 'exile');
          this.#emitEvent('permanentExiled', { cardId: permanent.id, cardName: permanent.name, controllerId: permanent.controllerId, sourceId });
          if (!permanent.token) source.linkedExiles = [...(source.linkedExiles ?? []), { cardId: permanent.id, ownerId: permanent.ownerId }];
        }
        break;
      }
      case EFFECT.SACRIFICE:
        this.#askSacrifice(this.#apnapOrder().filter((id) => players.includes(id)), effect, context);
        break;
      case EFFECT.OPTIONAL_COST: {
        const options = this.#optionalCostOptions(controllerId, effect.options, sourceId);
        this.#ask({ type: DECISION.CHOOSE, kind: CHOICE.OPTIONAL_COST, playerId: controllerId, options: [...options, 'decline'], costs: structuredClone(effect.options) });
        break;
      }
      case EFFECT.COUNTER_UNLESS_PAID:
        for (const id of ids) {
          const spell = this.#stack.find((s) => s.id === id);
          if (!spell) continue;
          const canPay = this.#canAutoPay(spell.controllerId, effect.cost);
          if (!canPay) {
            this.#applyEffect({ type: EFFECT.COUNTER_SPELL, affected: AFFECTED.TARGET }, controllerId, { ...context, targets: [id] });
            continue;
          }
          this.#ask({
            type: DECISION.CHOOSE, kind: CHOICE.PAY, playerId: spell.controllerId, options: ['pay', 'decline'], cost: effect.cost, counterId: id,
          });
          return;
        }
        break;
      case EFFECT.UNLESS_PAID:
        for (const playerId of players) {
          if (!this.#canAutoPay(playerId, effect.cost)) {
            this.#runEffects(effect.otherwise, controllerId, context);
            continue;
          }
          this.#ask({
            type: DECISION.CHOOSE, kind: CHOICE.PAY, playerId, options: ['pay', 'decline'], cost: effect.cost, otherwise: effect.otherwise,
          });
          return;
        }
        break;
      case EFFECT.REFLEXIVE_TRIGGER:
        this.#queueTrigger(effect.ability, {
          sourceId, sourceName: this.#resolving?.stackObject.sourceName ?? this.#currentOrLastKnown(sourceId, context)?.name ?? '', controllerId,
          subject: context.subject, amassedArmyId: context.amassedArmyId,
        });
        break;
      case EFFECT.IF:
        this.#runEffects(this.#checkCondition(effect.if, controllerId, context) ? effect.then : effect.else ?? [], controllerId, context);
        break;
      case EFFECT.MAY:
        this.#ask({ type: DECISION.CHOOSE, kind: CHOICE.MAY, playerId: controllerId, options: ['yes', 'no'], effects: effect.effects, text: effect.text ?? null });
        break;
      case EFFECT.EXILE_GRAVEYARD:
        for (const playerId of players) {
          const zone = this.#zones.get(playerId);
          const exiled = zone.graveyard.splice(0);
          zone.exile.push(...exiled);
          this.#emitEvent('graveyardExiled', { playerId, cardIds: exiled.map((c) => c.id), sourceId });
        }
        break;
      case EFFECT.SHUFFLE_INTO_LIBRARY: {
        const { graveyard } = this.#zones.get(controllerId);
        const options = graveyard.filter((c) => matchesFilter(c, { controller: 'any', ...effect.filter }, this.#filterContext(controllerId))).map((c) => c.id);
        if (options.length === 0) break;
        this.#ask({ type: DECISION.CHOOSE_MANY, kind: CHOICE.GRAVEYARD_CARDS, playerId: controllerId, options, min: 0, max: options.length });
        break;
      }
      case EFFECT.REMOVE_FROM_COMBAT:
        for (const permanent of permanents()) this.#removeFromCombat(permanent.id);
        break;
      case EFFECT.NOTE_CREATURE_TYPE: {
        const saga = this.#permanent(sourceId);
        const noted = saga?.notedTypes ?? [];
        const zone = this.#zones.get(controllerId);
        const types = new Set([...zone.hand, ...zone.library].filter(isCreature).flatMap((c) => c.subtypes ?? []));
        const options = [...types].filter((t) => !noted.includes(t)).sort();
        if (options.length === 0) break;
        this.#ask({ type: DECISION.CHOOSE, kind: CHOICE.CREATURE_TYPE, playerId: controllerId, options });
        break;
      }
      case EFFECT.PUT_FROM_HAND_ONTO_BATTLEFIELD: {
        const source = this.#currentOrLastKnown(sourceId, context);
        const filter = { controller: 'any', ...effect.filter };
        const options = this.#zones.get(controllerId).hand
          .filter((c) => matchesFilter(c, filter, this.#filterContext(controllerId))
            && (!effect.lesserPowerThanSource || (c.power ?? 0) < (source?.power ?? 0))
            && !this.#atLimit(controllerId, c))
          .map((c) => c.id);
        if (options.length === 0) break;
        // Last March of the Ents: "put any number of creature cards from your hand onto the battlefield".
        if (effect.any) {
          this.#ask({ type: DECISION.CHOOSE_MANY, kind: CHOICE.HAND_CARDS, playerId: controllerId, options, min: 0, max: options.length });
          break;
        }
        this.#ask({
          type: DECISION.CHOOSE, kind: CHOICE.HAND_CARD, playerId: controllerId, options: [...options, 'decline'], tapped: effect.tapped, attacking: effect.attacking,
        });
        break;
      }
      case EFFECT.RETURN_SOURCE_FROM_GRAVEYARD: {
        const owner = [...this.#zones].find(([, zone]) => zone.graveyard.some((c) => c.id === sourceId));
        if (!owner) break;
        const [ownerId, zone] = owner;
        const [card] = zone.graveyard.splice(zone.graveyard.findIndex((c) => c.id === sourceId), 1);
        this.#arriveFromGraveyard(card, ownerId, effect.to === 'battlefield' ? controllerId : null, { tapped: effect.tapped, sourceId });
        break;
      }
      case EFFECT.EXILE_SOURCE_FROM_GRAVEYARD: {
        const zone = this.#zones.get(controllerId);
        const index = zone.graveyard.findIndex((c) => c.id === sourceId);
        // "If you do": only if it was still there.
        context.paid = index !== -1;
        if (index === -1) break;
        zone.exile.push(...zone.graveyard.splice(index, 1));
        this.#emitEvent('cardExiledFromGraveyard', { playerId: controllerId, cardId: sourceId, sourceId });
        break;
      }
      case EFFECT.SHUFFLE_SOURCE_INTO_LIBRARY: {
        const owner = [...this.#zones].find(([, zone]) => zone.graveyard.some((c) => c.id === sourceId));
        if (!owner) break;
        const [ownerId, zone] = owner;
        zone.library.push(...zone.graveyard.splice(zone.graveyard.findIndex((c) => c.id === sourceId), 1));
        this.#shuffleLibrary(ownerId);
        break;
      }
      case EFFECT.BECOME_CREATURE:
        for (const permanent of permanents()) {
          this.#addTemporaryEffect({ sourceId, targetId: permanent.id, addTypes: [CARD_TYPE.ARTIFACT, CARD_TYPE.CREATURE] });
          this.#emitEvent('becameCreature', { cardId: permanent.id, sourceId });
        }
        break;
      case EFFECT.DELAYED_TRIGGER:
        this.#delayedTriggers.push({
          at: effect.at, controllerId, sourceId, sourceName: this.#resolving?.stackObject.sourceName ?? '', text: effect.text ?? '',
          effects: structuredClone(effect.effects), subject: ids[0] ? { id: ids[0], controllerId: this.#permanent(ids[0])?.controllerId } : context.subject,
        });
        break;
      case EFFECT.NOTHING:
        break;
      case EFFECT.REVEAL_TOP:
        for (const playerId of players) {
          const [top] = this.#zones.get(playerId).library;
          context.revealed = top ? { ...top, controllerId: playerId } : null;
          if (top) this.#emitEvent('cardRevealed', { playerId, card: this.#forEvent(top), sourceId });
        }
        break;
      case EFFECT.PUT_REVEALED_ONTO_BATTLEFIELD: {
        const { revealed } = context;
        const library = revealed && this.#zones.get(revealed.controllerId).library;
        const index = library ? library.findIndex((c) => c.id === revealed.id) : -1;
        if (index === -1 || this.#atLimit(controllerId, library[index])) break;
        const [card] = library.splice(index, 1);
        const attacking = Boolean(effect.attacking) && this.#segment?.phase === PHASE.COMBAT;
        const permanent = this.#putOntoBattlefield(card, controllerId, { tapped: effect.tapped, attacking });
        this.#emitEvent('permanentEntered', { playerId: controllerId, card: this.#forEvent(permanent), fromLibrary: true });
        // "it gains trample until your next turn": later effects can refer to it as their subject.
        context.subject = { id: permanent.id, controllerId };
        break;
      }
      case EFFECT.REMOVE_COUNTERS: {
        let removed = false;
        for (const permanent of permanents()) {
          const have = permanent.counters[effect.counter] ?? 0;
          const n = Math.min(have, effect.count ?? 1);
          if (n <= 0) continue;
          if (have - n > 0) permanent.counters[effect.counter] = have - n;
          else delete permanent.counters[effect.counter];
          removed = true;
          this.#applyContinuousEffects();
          this.#emitEvent('countersRemoved', { cardId: permanent.id, counter: effect.counter, count: n, counters: { ...permanent.counters } });
        }
        // "Remove a hope counter from this enchantment. If you do, draw a card."
        context.paid = removed;
        break;
      }
      case EFFECT.LOOK_AT_TOP:
        this.#lookAtTop(controllerId, effect, context);
        break;
      case EFFECT.REVEAL_UNTIL:
        for (const playerId of players) this.#revealUntil(playerId, controllerId, effect, sourceId);
        break;
      case EFFECT.EXILE_HAND_EXCESS:
        for (const playerId of players) {
          const { hand } = this.#zones.get(playerId);
          const excess = hand.length - (effect.keep ?? 4);
          if (excess <= 0) continue;
          this.#ask({ type: DECISION.CHOOSE_MANY, kind: CHOICE.EXILE_FROM_HAND, playerId, options: hand.map((c) => c.id), min: excess, max: excess });
          return;
        }
        break;
      case EFFECT.KEEP_AND_DESTROY_REST: {
        const creatures = this.#battlefield.filter(isCreature).map((p) => p.id);
        if (creatures.length === 0) break;
        this.#ask({ type: DECISION.CHOOSE_MANY, kind: CHOICE.KEEP, playerId: controllerId, options: creatures, min: 0, max: Math.min(effect.keep ?? 2, creatures.length) });
        break;
      }
      case EFFECT.GOAD:
        // 701.15a: until your next turn, it attacks each combat if able (and, with two players, it can only attack you).
        for (const permanent of permanents()) {
          this.#addTemporaryEffect({ sourceId, targetId: permanent.id, keywords: [KEYWORD.MUST_ATTACK], duration: 'untilYourNextTurn', controllerId });
          this.#emitEvent('goaded', { cardId: permanent.id, cardName: permanent.name, playerId: controllerId, sourceId });
        }
        break;
      default:
        throw new Error(`Unknown effect type: ${effect.type}`);
    }
  }

  /** The creature an effect's damage comes from: `{ target: n }` (the nth target) or `{ subject: true }`. */
  #damageSourceOf(from, context) {
    if (from.subject) return context.subject?.id ?? null;
    const id = context.targets[from.target];
    return id && this.#permanent(id) ? id : null;
  }

  /** "+N/+N and gains … until end of turn", and other effects that last a while (611.2). */
  #pump(effect, permanents, controllerId, sourceId) {
    for (const permanent of permanents) {
      if (!isCreature(permanent) && !effect.loseAbilities && !effect.exileIfDies) continue;
      this.#addTemporaryEffect({
        sourceId,
        targetId: permanent.id,
        power: effect.power ?? 0,
        toughness: effect.toughness ?? 0,
        keywords: [...(effect.keywords ?? [])],
        ...(effect.setBase ? { setBase: { ...effect.setBase } } : {}),
        ...(effect.loseAbilities ? { loseAbilities: true } : {}),
        ...(effect.removeKeywords ? { removeKeywords: [...effect.removeKeywords] } : {}),
        ...(effect.exileIfDies ? { exileIfDies: true } : {}),
        // Fall of Gil-galad: "gains 'When this creature dies, draw two cards.'"
        ...(effect.grantTriggers ? { grantTriggers: structuredClone(effect.grantTriggers) } : {}),
        // "until your next turn" (Doors of Durin).
        ...(effect.untilYourNextTurn ? { duration: 'untilYourNextTurn', controllerId } : {}),
        // Tale of Tinúviel: "for as long as you control this Saga".
        ...(effect.whileSourceControlled ? { duration: 'whileSourceControlled', controllerId } : {}),
      });
    }
  }

  #addTemporaryEffect(fields) {
    // 611.2a: a continuous effect from a resolving spell or ability, until end of turn unless it says otherwise.
    const temporary = {
      id: `e${this.#nextEffectId++}`, power: 0, toughness: 0, keywords: [], duration: 'endOfTurn', ...fields,
    };
    this.#temporaryEffects.push(temporary);
    this.#applyContinuousEffects();
    this.#emitEvent('temporaryEffectCreated', this.#forEvent(temporary));
    return temporary;
  }

  /**
   * 122.1: puts counters on a permanent. Mauhúr's replacement (614.1a) adds one more +1/+1
   * counter to an Army, Goblin or Orc its controller controls. Lore counters on a Saga
   * trigger its chapter abilities (714.2c).
   */
  #addCounters(permanent, counter, count, sourceControllerId = null) {
    if (count <= 0) return;
    let total = count;
    if (counter === COUNTER.PLUS_ONE && ['Army', 'Goblin', 'Orc'].some((t) => hasSubtype(permanent, t))) {
      total += this.#staticRules('morePlusOneCounters').filter((s) => s.controllerId === permanent.controllerId).length;
    }
    const before = permanent.counters[counter] ?? 0;
    permanent.counters[counter] = before + total;
    this.#applyContinuousEffects();
    this.#emitEvent('countersAdded', {
      cardId: permanent.id, counter, count: total, counters: { ...permanent.counters },
    });
    if (counter === COUNTER.LORE) this.#triggerChapters(permanent, before, before + total);
  }

  /**
   * Permanents with a static ability that changes the rules (`{ rule }`), such as
   * Gandalf's "You may cast sorcery spells as though they had flash."
   */
  #staticRules(rule) {
    return this.#battlefield.filter((p) => !p.abilitiesLost
      && (this.#cardDefinitions[p.cardId].staticAbilities ?? []).some((s) => s.rule === rule));
  }

  /** A card arriving from a graveyard: to its owner's hand, or onto the battlefield under `battlefieldControllerId`. */
  #arriveFromGraveyard(card, ownerId, battlefieldControllerId, { tapped = false, sourceId = null } = {}) {
    delete card.leftBattlefieldTurn;
    if (battlefieldControllerId) {
      const permanent = this.#putOntoBattlefield(card, battlefieldControllerId, { tapped });
      this.#emitEvent('permanentEntered', { playerId: battlefieldControllerId, card: this.#forEvent(permanent), fromGraveyard: true });
      return;
    }
    this.#zones.get(ownerId).hand.push(card);
    this.#notesOf(ownerId)[card.id] = { revealed: true };
    this.#emitEvent('cardReturnedFromGraveyard', { cardId: card.id, cardName: card.name, ownerId, sourceId });
    this.#burnIfHandFull(ownerId, card.id, 'returnToHand');
  }

  /** A permanent, or a card in a graveyard, goes into its owner's library `position` from the top. */
  #putIntoLibrary(id, position, sourceId) {
    const permanent = this.#permanent(id);
    let card;
    let ownerId;
    if (permanent) {
      ownerId = permanent.ownerId;
      this.#moveFromBattlefield(permanent, 'library', position);
      if (permanent.token) return;
    } else {
      const owner = [...this.#zones].find(([, zone]) => zone.graveyard.some((c) => c.id === id));
      if (!owner) return;
      const [playerId, zone] = owner;
      ownerId = playerId;
      [card] = zone.graveyard.splice(zone.graveyard.findIndex((c) => c.id === id), 1);
      delete card.leftBattlefieldTurn;
      const { library } = this.#zones.get(ownerId);
      library.splice(Math.min(position - 1, library.length), 0, card);
    }
    this.#emitEvent('cardPutIntoLibrary', { cardId: id, ownerId, position, sourceId });
  }

  #shuffleLibrary(playerId) {
    shuffle(this.#zones.get(playerId).library, this.#random);
    this.#emitEvent('libraryShuffled', { playerId });
  }

  /** 701.12 / 613.1b: `permanent` comes under `playerId`'s control (until end of turn, or for good). */
  #changeControl(permanent, playerId, {
    untilEndOfTurn = false, whileSourceControlled = false, sourceId = null,
  } = {}) {
    const from = permanent.controllerId;
    if (from === playerId) return;
    if (untilEndOfTurn) this.#temporaryEffects.push({ id: `e${this.#nextEffectId++}`, sourceId, targetId: permanent.id, power: 0, toughness: 0, keywords: [], duration: 'endOfTurn', revertControlTo: from });
    if (whileSourceControlled) {
      this.#temporaryEffects.push({
        id: `e${this.#nextEffectId++}`, sourceId, targetId: permanent.id, power: 0, toughness: 0, keywords: [], duration: 'whileSourceControlled', controllerId: playerId, revertControlTo: from,
      });
    }
    this.#setController(permanent, playerId);
    this.#emitEvent('controlChanged', { cardId: permanent.id, cardName: permanent.name, from, to: playerId, sourceId, untilEndOfTurn });
  }

  #setController(permanent, playerId) {
    permanent.controllerId = playerId;
    // 302.6: its new controller hasn't controlled it continuously since their turn began.
    permanent.summoningSick = true;
    // 506.4: a permanent whose controller changes is removed from combat.
    this.#removeFromCombat(permanent.id);
    this.#applyContinuousEffects();
  }

  #removeFromCombat(id) {
    this.#combat.attackers = this.#combat.attackers.filter((a) => a.cardId !== id);
    for (const attacker of this.#combat.attackers) attacker.blockerIds = attacker.blockerIds.filter((b) => b !== id);
  }

  /** 701.22: scry `count`: the player looks at the top cards and decides which stay on top, in what order. */
  #scry(playerId, count) {
    const { library } = this.#zones.get(playerId);
    const n = Math.min(count, library.length);
    // 701.22b: scrying 0 cards isn't scrying, so nothing triggers.
    if (n === 0) return;
    const looked = library.slice(0, n);
    this.#ask({
      type: DECISION.CHOOSE_MANY, kind: CHOICE.SCRY, playerId, options: looked.map((c) => c.id), cards: structuredClone(looked),
      min: 0, max: n, ordered: true, libraryTop: n,
    });
  }

  /** The Ring tempts `playerId` (701.54a). */
  #ringTempts(playerId) {
    const { ring } = this.#zones.get(playerId);
    ring.level = Math.min(4, ring.level + 1);
    ring.temptations = (ring.temptations ?? 0) + 1;
    this.#emitEvent('ringTempted', { playerId, level: ring.level });
    const creatures = this.#battlefield.filter((p) => p.controllerId === playerId && isCreature(p));
    if (creatures.length === 0) {
      ring.bearerId = null;
      this.#ringBearerChosen(playerId, null);
    } else if (creatures.length === 1) {
      this.#ringBearerChosen(playerId, creatures[0].id);
    } else {
      this.#ask({ type: DECISION.CHOOSE, kind: CHOICE.RING_BEARER, playerId, options: creatures.map((p) => p.id) });
    }
  }

  #ringBearerChosen(playerId, cardId) {
    const { ring } = this.#zones.get(playerId);
    if (cardId) ring.bearerId = cardId;
    this.#applyContinuousEffects();
    this.#emitEvent('ringBearerChosen', { playerId, cardId, level: ring.level });
    // 701.54b: "Whenever the Ring tempts you" abilities trigger, whatever was chosen.
    const subject = { chosenId: cardId, controllerId: playerId };
    for (const permanent of [...this.#battlefield].filter((p) => p.controllerId === playerId)) {
      this.#trigger(permanent, TRIGGER.RING_TEMPTS, playerId, () => true, subject);
    }
  }

  /** 701.47a: amass Orcs N. */
  #amass(controllerId, effect, context) {
    const armies = this.#battlefield.filter((p) => p.controllerId === controllerId && isCreature(p) && hasSubtype(p, 'Army'));
    if (armies.length > 1) {
      this.#ask({ type: DECISION.CHOOSE, kind: CHOICE.ARMY, playerId: controllerId, options: armies.map((p) => p.id), effect });
      return;
    }
    let army = armies[0];
    if (!army) {
      // 701.47a: with no Army, a 0/0 black Army token of that creature type is created first.
      [army] = this.#createTokens({ count: 1, token: amassArmyToken(effect.subtype) }, controllerId, context.sourceId);
      if (!army) return;
    }
    this.#amassOnto(army, effect, context);
  }

  #amassOnto(army, effect, context) {
    context.amassedArmyId = army.id;
    // "It's also an Orc."
    const subtype = effect.subtype ?? 'Orc';
    if (!army.base.subtypes.includes(subtype)) army.base.subtypes.push(subtype);
    this.#addCounters(army, COUNTER.PLUS_ONE, effect.count ?? 1);
    this.#emitEvent('amassed', { playerId: army.controllerId, cardId: army.id, count: effect.count ?? 1 });
  }

  /** Each of `playerIds` discards `count` cards of their choice (701.8a), one at a time. */
  #askDiscard(playerIds, count) {
    for (const [i, playerId] of playerIds.entries()) {
      const { hand } = this.#zones.get(playerId);
      if (hand.length === 0) continue;
      if (hand.length <= count) {
        for (const card of [...hand]) this.#discardCard(playerId, card.id);
        continue;
      }
      this.#ask({
        type: DECISION.CHOOSE, kind: CHOICE.DISCARD, playerId, options: hand.map((c) => c.id), remaining: count, count, waiting: playerIds.slice(i + 1),
      });
      return;
    }
  }

  #discardCard(playerId, cardId) {
    const zone = this.#zones.get(playerId);
    const index = zone.hand.findIndex((c) => c.id === cardId);
    if (index === -1) return;
    zone.graveyard.push(...zone.hand.splice(index, 1));
    this.#emitEvent('cardDiscarded', { playerId, cardId });
  }

  /** 701.17a: each of `playerIds` sacrifices permanents of their choice, in turn. */
  #askSacrifice(playerIds, effect, context) {
    const count = effect.count ?? 1;
    for (const [i, playerId] of playerIds.entries()) {
      let candidates = this.#battlefield.filter((p) => p.controllerId === playerId
        && matchesFilter(p, { controller: 'any', ...(effect.filter ?? { types: [CARD_TYPE.CREATURE] }) }, this.#filterContext(playerId)));
      // Ring level 3: "that creature's controller sacrifices it": only that one.
      if (effect.subjectOnly) candidates = candidates.filter((p) => p.id === context.subject?.id);
      // Dawn of a New Age: "sacrifice it" (the source).
      if (effect.sourceOnly) candidates = candidates.filter((p) => p.id === context.sourceId);
      // Witch-king of Angmar: "a creature of their choice that dealt combat damage to you this turn".
      if (effect.dealtCombatDamageToYou) {
        const you = this.#resolving?.controllerId;
        candidates = candidates.filter((p) => p.combatDamagedPlayers?.includes(you));
      }
      if (candidates.length === 0) continue;
      if (candidates.length <= count) {
        for (const permanent of candidates) this.#sacrifice(permanent, playerId, context);
        continue;
      }
      this.#ask({
        type: DECISION.CHOOSE, kind: CHOICE.SACRIFICE, playerId, options: candidates.map((p) => p.id), remaining: count, waiting: playerIds.slice(i + 1), effect,
      });
      return;
    }
  }

  /** 701.17a: sacrificing moves a permanent to its owner's graveyard. */
  #sacrifice(permanent, playerId, context = null) {
    context?.sacrificed.push({ ...permanent });
    this.#zones.get(playerId).turnTally.sacrificed += 1;
    this.#putIntoGraveyard(permanent);
    this.#emitEvent('permanentSacrificed', { cardId: permanent.id, cardName: permanent.name, controllerId: playerId });
    if (permanent.token) this.#triggerWatchers(TRIGGER.TOKEN_SACRIFICED, { ...permanent, controllerId: playerId });
  }

  /** 701.19: search a library for cards matching a filter, up to `count` of them. */
  #searchLibrary(playerId, effect, context) {
    const { library } = this.#zones.get(playerId);
    const filter = { controller: 'any', ...effect.filter };
    // Ringsight: "a card that shares a color with a legendary creature you control".
    const legendaryColors = new Set(this.#battlefield.filter((p) => p.controllerId === playerId && isCreature(p) && isLegendary(p)).flatMap(colorsOf));
    const options = library.filter((c) => matchesFilter(c, filter, this.#filterContext(playerId))
      && (!effect.sharesColorWithLegendary || colorsOf(c).some((color) => legendaryColors.has(color)))).map((c) => c.id);
    const count = effect.count ?? 1;
    if (options.length === 0) {
      this.#shuffleLibrary(playerId);
      return;
    }
    this.#ask({
      type: DECISION.CHOOSE_MANY, kind: CHOICE.SEARCH, playerId, options, cards: structuredClone(library.filter((c) => options.includes(c.id))),
      min: 0, max: Math.min(count, options.length), destination: effect.destination ?? 'hand', tapped: Boolean(effect.tapped), wholeLibrary: true,
      searchFilter: structuredClone(filter),
    });
    context.searched = true;
  }

  /**
   * Choices for "you may <cost>" (OPTIONAL_COST): each payable cost's index, as `'i'`, or
   * `'i:<id>'` for each permanent a sacrifice could be.
   */
  #optionalCostOptions(playerId, costs, sourceId) {
    const options = [];
    costs.forEach((cost, i) => {
      if (cost.sacrifice) {
        for (const choice of this.#costChoiceOptions(playerId, cost, null, sourceId)) {
          if (choice?.sacrifice) options.push(`${i}:${choice.sacrifice.join(',')}`);
        }
      } else if ((!cost.life || this.#zones.get(playerId).life >= cost.life) && (!cost.mana || this.#canAutoPay(playerId, cost))) {
        options.push(`${i}`);
      }
    });
    return options;
  }

  /**
   * Whether `playerId` can pay a cost's mana (and life) in the middle of a resolution: from
   * their pool and by tapping their untapped mana sources (605.3a lets a player activate
   * mana abilities whenever they're asked to pay mana).
   */
  #canAutoPay(playerId, cost) {
    if (cost.life && this.#zones.get(playerId).life < cost.life) return false;
    if (!cost.mana) return true;
    return this.#autoPayPlan(playerId, cost.mana) !== null;
  }

  /** The mana abilities to activate (tap-only ones, with their colors) so the pool can pay `mana`, or null. */
  #autoPayPlan(playerId, mana) {
    const pool = this.#poolFor(playerId, null);
    if (canPayMana(pool, mana)) return [];
    const sources = [];
    for (const permanent of this.#battlefield.filter((p) => p.controllerId === playerId && !p.tapped)) {
      for (const ability of this.#abilitiesOf(permanent)) {
        const cost = ability.cost ?? {};
        if (!isManaAbility(ability) || !cost.tap || cost.mana || cost.sacrificeSelf || cost.sacrifice || cost.life) continue;
        if (this.#hasSummoningSickness(permanent)) continue;
        const effect = abilityEffects(ability)[0];
        if (!effect || effect.per || effect.restriction) continue;
        const colors = effect.anyColor ? COLORS : Object.keys(effect.mana ?? {});
        if (colors.length === 0) continue;
        sources.push({ permanent, ability, colors, amount: effect.anyColor ?? Object.values(effect.mana)[0] });
        break;
      }
    }
    // Greedy: sources that make one needed color first, then any others.
    const plan = [];
    const working = { ...pool };
    const left = sources.slice().sort((a, b) => a.colors.length - b.colors.length);
    while (!canPayMana(working, mana)) {
      const needed = MANA_TYPES.filter((t) => (mana[t] ?? 0) > working[t]);
      const index = left.findIndex((s) => needed.length === 0 || s.colors.some((c) => needed.includes(c)));
      if (index === -1) return null;
      const [source] = left.splice(index, 1);
      const color = source.colors.find((c) => needed.includes(c)) ?? source.colors[0];
      working[color] += source.amount;
      plan.push({ cardId: source.permanent.id, abilityId: source.ability.id, color });
    }
    return plan;
  }

  /** Pays a cost's mana and life during a resolution, tapping mana sources as needed. */
  #autoPay(playerId, cost) {
    if (cost.mana) {
      for (const { cardId, abilityId, color } of this.#autoPayPlan(playerId, cost.mana) ?? []) {
        this.#activateAbility(playerId, cardId, abilityId, undefined, undefined, color);
      }
      this.#payManaFrom(playerId, cost.mana, null);
    }
    if (cost.life) this.#payLife(playerId, cost.life);
  }

  #payLife(playerId, amount) {
    const zone = this.#zones.get(playerId);
    zone.life -= amount;
    this.#emitEvent('lifePaid', { playerId, amount, life: zone.life });
  }

  /**
   * 701.14a: each creature deals damage equal to its power to the other. 701.14b: if
   * either is gone or no longer a legal target, neither deals damage.
   */
  #fight(firstId, secondId) {
    const first = firstId && this.#permanent(firstId);
    const second = secondId && this.#permanent(secondId);
    if (!first || !second || !isCreature(first) || !isCreature(second)) return;
    const [firstPower, secondPower] = [first.power, second.power];
    this.#emitEvent('fought', { cardIds: [first.id, second.id] });
    this.#dealDamage(first.id, second.id, firstPower);
    if (first.id !== second.id) this.#dealDamage(second.id, first.id, secondPower);
  }

  #gainLife(playerId, amount) {
    // Gríma Wormtongue: "Your opponents can't gain life."
    if (this.#staticRules('opponentsCantGainLife').some((p) => p.controllerId !== playerId)) return;
    const zone = this.#zones.get(playerId);
    zone.life += amount;
    this.#emitEvent('lifeGained', { playerId, amount, life: zone.life });
  }

  /** Noncombat damage from a spell or ability (120.3). */
  #dealDamage(sourceId, targetId, amount, { excessToController = false } = {}) {
    if (amount <= 0) return;
    // A spell or an emblem isn't a permanent, so only a permanent source can have deathtouch or lifelink.
    const source = this.#permanent(sourceId);
    if (this.#zones.has(targetId)) {
      // 120.3a: damage to a player causes that much life loss.
      this.#zones.get(targetId).life -= amount;
      this.#emitEvent('damageDealt', { sourceId, targetPlayerId: targetId, amount });
    } else {
      const target = this.#permanent(targetId);
      if (!target || !isCreature(target)) return;
      // 120.4a: "Excess damage is dealt to that creature's controller instead."
      const excess = excessToController ? Math.max(0, amount - Math.max(0, target.toughness - target.damage)) : 0;
      // 120.3e: damage to a creature is marked on it; state-based actions do the rest.
      target.damage += amount - excess;
      target.dealtDamageThisTurn = true;
      if (source && hasKeyword(source, KEYWORD.DEATHTOUCH)) target.damagedByDeathtouch = true;
      this.#emitEvent('damageDealt', { sourceId, targetCardId: targetId, amount: amount - excess });
      if (source) this.#trigger(source, TRIGGER.DEALS_DAMAGE_TO_CREATURE, source.controllerId, (ability) => (
        matchesFilter(target, { controller: 'any', ...ability.filter }, this.#filterContext(source.controllerId, source.id))
      ), { id: target.id, controllerId: target.controllerId });
      if (excess > 0) {
        // The excess is dealt by the same source, lifelink and all.
        this.#dealDamage(sourceId, target.controllerId, excess);
        if (source && hasKeyword(source, KEYWORD.LIFELINK)) this.#gainLife(source.controllerId, amount - excess);
        return;
      }
    }
    // 702.15b: damage dealt by a source with lifelink causes its controller to gain that much life.
    if (source && hasKeyword(source, KEYWORD.LIFELINK)) this.#gainLife(source.controllerId, amount);
  }

  // ---------------------------------------------------------------------------
  // Triggered abilities (Comprehensive Rules 603)

  /**
   * A permanent's triggered abilities: its own (none once it has lost all abilities,
   * 613.1f), plus those its Auras give it (Morgul-Knife Wound's "At the beginning of your
   * upkeep, …").
   */
  #triggeredAbilitiesOf(permanent) {
    const own = permanent.abilitiesLost ? [] : this.#cardDefinitions[permanent.cardId].triggeredAbilities ?? [];
    return permanent.grantedTriggers?.length ? [...own, ...permanent.grantedTriggers] : own;
  }

  /**
   * 603.2: an event happened; any of the permanent's abilities that trigger on it trigger.
   * `subject` is what the event was about ("that creature", the scry's `count`).
   */
  #trigger(permanent, type, controllerId, matches = () => true, subject = null) {
    for (const ability of this.#triggeredAbilitiesOf(permanent)) {
      if (!triggersOn(ability, type) || ability.zone === 'graveyard' || !matches(ability)) continue;
      this.#triggerAbility(ability, { sourceId: permanent.id, sourceName: permanent.name, controllerId, subject });
    }
  }

  /** An ability triggers, unless its intervening "if" (603.4) or "only once each turn" stops it. */
  #triggerAbility(ability, { sourceId, sourceName, controllerId, subject }) {
    if (ability.condition && !this.#checkCondition(ability.condition, controllerId, { sourceId, subject })) return;
    if (ability.oncePerTurn) {
      const { triggered } = this.#zones.get(controllerId).turnTally;
      const key = `${sourceId}:${ability.id}`;
      if (triggered[key]) return;
      triggered[key] = true;
    }
    this.#queueTrigger(ability, { sourceId, sourceName, controllerId, subject });
  }

  /** A triggered ability waits to be put on the stack (603.3). */
  #queueTrigger(ability, { sourceId, sourceName, controllerId, subject = null, amassedArmyId = null }) {
    const kinds = targetList(ability);
    const trigger = {
      id: `t${this.#nextTriggerId++}`,
      sourceId,
      sourceName,
      // 603.3a: the ability's controller is its source's controller when it triggered.
      controllerId,
      abilityId: ability.id ?? 'reflexive',
      text: ability.text ?? '',
      trigger: ability.trigger ?? null,
      effects: structuredClone(abilityEffects(ability)),
      targetKind: kinds.length === 1 ? kinds[0] : null,
      ...(kinds.length ? { targetKinds: structuredClone(kinds) } : {}),
      // "another target Elf": the source can't be its own target.
      ...(ability.targetOther ? { excludeId: sourceId } : {}),
      ...(ability.optional ? { optional: true } : {}),
      ...(ability.modes ? { modes: structuredClone(ability.modes) } : {}),
      ...(ability.condition ? { condition: structuredClone(ability.condition) } : {}),
      ...(subject ? { subject: structuredClone(subject) } : {}),
      ...(amassedArmyId ? { amassedArmyId } : {}),
    };
    this.#pendingTriggers.push(trigger);
    this.#emitEvent('abilityTriggered', this.#forEvent(trigger));
  }

  /**
   * 603.2: something happened to `subject` (a permanent entering, a spell being cast,
   * with its `controllerId`); abilities of permanents on the battlefield that watch for
   * it trigger when it matches their `filter`. `alsoFrom` are permanents that left the
   * battlefield with it, whose abilities look back in time (603.10a). Abilities that
   * work from a graveyard trigger there.
   */
  #triggerWatchers(type, subject, { alsoFrom = [], matches = () => true } = {}) {
    const sources = [...this.#battlefield, ...alsoFrom.filter((p) => !this.#permanent(p.id))];
    for (const permanent of sources) {
      this.#trigger(permanent, type, permanent.controllerId, (ability) => (
        matchesFilter(subject, ability.filter, this.#filterContext(permanent.controllerId, permanent.id)) && matches(ability, permanent)
      ), subject);
    }
    for (const [playerId, zone] of this.#zones) {
      for (const card of [...zone.graveyard]) {
        for (const ability of this.#cardDefinitions[card.cardId].triggeredAbilities ?? []) {
          if (ability.zone !== 'graveyard' || !triggersOn(ability, type) || !matchesFilter(subject, ability.filter, this.#filterContext(playerId, card.id))
            || !matches(ability, { ...card, controllerId: playerId })) continue;
          this.#triggerAbility(ability, { sourceId: card.id, sourceName: card.name, controllerId: playerId, subject });
        }
      }
    }
  }

  /** Players in APNAP order (101.4): the active player, then the others in turn order. */
  #apnapOrder() {
    const index = this.#players.findIndex((p) => p.id === this.#activePlayerId);
    return [...this.#players.slice(index), ...this.#players.slice(0, index)].map((p) => p.id);
  }

  /**
   * Every legal choice of targets for these target kinds, as lists of ids (with null for an
   * optional target left out), or [[]] when there are none to choose. "Up to two target
   * creatures" in a different order is the same choice, so it's listed once.
   */
  #targetOptions(kinds, controllerId, {
    excludeId = null, skip = null, sourceId = null, x = null, amassedArmyId = null,
  } = {}) {
    let options = [[]];
    for (const kind of kinds) {
      options = options.flatMap((chosen) => {
        const legal = this.#legalTargets(kind, controllerId, excludeId, { sourceId, x, chosen, amassedArmyId })
          .filter((target) => !chosen.includes(target.id) && !skip?.(target));
        const next = legal.map((target) => [...chosen, target.id]);
        if (isOptionalTarget(kind)) next.push([...chosen, null]);
        return next;
      });
    }
    if (kinds.length < 2) return options;
    // Positions with the same kind are interchangeable: keep each set of ids once.
    const seen = new Set();
    return options.filter((option) => {
      const key = kinds.map((kind, i) => {
        const same = kinds.map((k, j) => (JSON.stringify(k) === JSON.stringify(kind) ? option[j] : undefined)).filter((id) => id !== undefined);
        return `${i}:${[...same].sort((a, b) => String(a).localeCompare(String(b))).join(',')}`;
      }).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 603.3b: puts abilities that triggered since a player last received priority on
   * the stack, the active player's first, so the last player's end up on top. Each
   * player's go on in the order they triggered (choosing that order isn't modelled).
   * Returns true when a player must first choose a target (603.3d), which leaves
   * `priorityPlayerId` waiting.
   */
  #putTriggersOnStack(priorityPlayerId) {
    const order = this.#apnapOrder();
    this.#pendingTriggers.sort((a, b) => order.indexOf(a.controllerId) - order.indexOf(b.controllerId));
    while (this.#pendingTriggers.length > 0) {
      const trigger = this.#pendingTriggers[0];
      const optionsFor = (kinds) => this.#targetOptions(kinds, trigger.controllerId, {
        excludeId: trigger.excludeId ?? null, sourceId: trigger.sourceId, amassedArmyId: trigger.amassedArmyId ?? null,
      });
      if (trigger.modes) {
        // 700.2a: the mode is chosen as the ability is put on the stack, with its target.
        const options = trigger.modes.flatMap((mode, i) => {
          const kinds = targetList(mode);
          return kinds.length ? optionsFor(kinds).map((targets) => ({ mode: i, targets })) : [{ mode: i }];
        });
        if (options.length === 0) {
          this.#pendingTriggers.shift();
          this.#emitEvent('triggeredAbilityRemoved', { triggerId: trigger.id, sourceId: trigger.sourceId, reason: 'No legal targets.' });
          continue;
        }
        if (options.length === 1) {
          this.#chooseMode(this.#pendingTriggers.shift(), options[0]);
          continue;
        }
        this.#priorityPlayerId = null;
        this.#requireDecision({
          type: DECISION.CHOOSE_MODE,
          playerId: trigger.controllerId,
          triggerId: trigger.id,
          sourceId: trigger.sourceId,
          sourceName: trigger.sourceName,
          text: trigger.text,
          modes: structuredClone(trigger.modes),
          options,
          priorityPlayerId,
        });
        return true;
      }
      const kinds = trigger.targetKinds ?? [];
      if (kinds.length === 0) {
        this.#putTriggerOnStack(this.#pendingTriggers.shift(), null);
        continue;
      }
      const options = optionsFor(kinds);
      if (options.length === 0) {
        // 603.3d: with no legal target, the ability is removed from the stack.
        this.#pendingTriggers.shift();
        this.#emitEvent('triggeredAbilityRemoved', { triggerId: trigger.id, sourceId: trigger.sourceId, reason: 'No legal targets.' });
        continue;
      }
      // "You may": the player chooses even with one target, and may decline.
      if (options.length === 1 && !trigger.optional) {
        this.#putTriggerOnStack(this.#pendingTriggers.shift(), options[0]);
        continue;
      }
      this.#priorityPlayerId = null;
      this.#requireDecision({
        type: DECISION.CHOOSE_TARGETS,
        playerId: trigger.controllerId,
        triggerId: trigger.id,
        sourceId: trigger.sourceId,
        sourceName: trigger.sourceName,
        text: trigger.text,
        targetKind: trigger.targetKind,
        targetKinds: structuredClone(kinds),
        effects: structuredClone(trigger.effects),
        ...(trigger.excludeId ? { excludeId: trigger.excludeId } : {}),
        ...(trigger.optional ? { optional: true } : {}),
        ...(trigger.amassedArmyId ? { amassedArmyId: trigger.amassedArmyId } : {}),
        priorityPlayerId,
      });
      return true;
    }
    return false;
  }

  #putTriggerOnStack(trigger, targets) {
    const kinds = trigger.targetKinds ?? [];
    const stackObject = {
      id: `s${this.#nextStackObjectId++}`,
      kind: 'triggeredAbility',
      controllerId: trigger.controllerId,
      sourceId: trigger.sourceId,
      sourceName: trigger.sourceName,
      abilityId: trigger.abilityId,
      text: trigger.text,
      effects: trigger.effects,
      ...(targets ? { targets: [...targets], targetKind: trigger.targetKind, targetKinds: kinds } : {}),
      ...(trigger.subject ? { subject: trigger.subject } : {}),
      ...(trigger.condition ? { condition: trigger.condition } : {}),
      ...(trigger.amassedArmyId ? { amassedArmyId: trigger.amassedArmyId } : {}),
      // "You may …" without a target: the choice is made as it resolves.
      ...(trigger.optional && kinds.length === 0 ? { mayOnResolution: true } : {}),
    };
    this.#stack.push(stackObject);
    this.#emitEvent('triggeredAbilityPutOnStack', {
      triggerId: trigger.id, stackObjectId: stackObject.id, sourceId: trigger.sourceId, targets: targets ?? [],
    });
    this.#checkWard(stackObject);
  }

  #chooseTriggerTargets(targets) {
    const { priorityPlayerId } = this.#pendingDecision;
    this.#pendingDecision = null;
    const trigger = this.#pendingTriggers.shift();
    if (targets.length === 0) {
      // An optional ability ("you may") its controller declined.
      this.#emitEvent('triggeredAbilityRemoved', { triggerId: trigger.id, sourceId: trigger.sourceId, reason: 'Declined.' });
    } else {
      this.#putTriggerOnStack(trigger, targets);
    }
    // Put any other triggered abilities on the stack, then give priority as was about to happen.
    this.#givePriority(priorityPlayerId);
  }

  /** Puts a modal triggered ability on the stack with the chosen mode's effects and target. */
  #chooseMode(trigger, { mode, targets }) {
    const chosen = trigger.modes[mode];
    const kinds = targetList(chosen);
    this.#emitEvent('modeChosen', { triggerId: trigger.id, sourceId: trigger.sourceId, mode, text: chosen.text });
    this.#putTriggerOnStack({
      ...trigger,
      effects: structuredClone(abilityEffects(chosen)),
      targetKind: kinds.length === 1 ? kinds[0] : null,
      targetKinds: kinds,
    }, targets ?? null);
  }

  #chooseTriggerMode(mode, targets) {
    const { priorityPlayerId } = this.#pendingDecision;
    this.#pendingDecision = null;
    this.#chooseMode(this.#pendingTriggers.shift(), { mode, targets });
    this.#givePriority(priorityPlayerId);
  }

  // ---------------------------------------------------------------------------
  // Choices while a spell or ability resolves (608.2c-d)

  /** DECISION.CHOOSE: does what the choice is for, then the resolution carries on. */
  #choose(choice) {
    const decision = this.#pendingDecision;
    this.#pendingDecision = null;
    const { playerId } = decision;
    const resolving = this.#resolving;
    const context = resolving?.context ?? { sacrificed: [] };
    const controllerId = resolving?.controllerId ?? playerId;
    this.#emitEvent('choiceMade', { playerId, kind: decision.kind, choice });
    switch (decision.kind) {
      case CHOICE.RING_BEARER:
        this.#ringBearerChosen(playerId, choice);
        break;
      case CHOICE.ARMY:
        this.#amassOnto(this.#permanent(choice), decision.effect, context);
        break;
      case CHOICE.SACRIFICE: {
        this.#sacrifice(this.#permanent(choice), playerId, context);
        const left = decision.options.filter((id) => id !== choice && this.#permanent(id));
        const remaining = decision.remaining - 1;
        if (remaining > 0 && left.length > remaining) {
          this.#ask({ ...decision, options: left, remaining });
          return;
        }
        if (remaining > 0) for (const id of left) this.#sacrifice(this.#permanent(id), playerId, context);
        this.#askSacrifice(decision.waiting, decision.effect, context);
        break;
      }
      case CHOICE.DISCARD: {
        this.#discardCard(playerId, choice);
        const remaining = decision.remaining - 1;
        const { hand } = this.#zones.get(playerId);
        if (remaining > 0 && hand.length > remaining) {
          this.#ask({ ...decision, options: hand.map((c) => c.id), remaining });
          return;
        }
        if (remaining > 0) for (const card of [...hand]) this.#discardCard(playerId, card.id);
        this.#askDiscard(decision.waiting, decision.count ?? 1);
        break;
      }
      case CHOICE.REVEALED_CARD:
        this.#discardCard(decision.owner, choice);
        break;
      case CHOICE.BOTTOM_FROM_HAND: {
        const zone = this.#zones.get(playerId);
        zone.library.push(...zone.hand.splice(zone.hand.findIndex((c) => c.id === choice), 1));
        this.#emitEvent('cardPutOnBottom', { playerId });
        if (decision.remaining > 1 && zone.hand.length > 0) {
          this.#ask({ ...decision, options: zone.hand.map((c) => c.id), remaining: decision.remaining - 1 });
          return;
        }
        break;
      }
      case CHOICE.KEYWORD: {
        const { effect } = decision;
        const { keywordChoice: _, ...pump } = effect;
        this.#pump({ ...pump, keywords: [...(effect.keywords ?? []), choice] }, decision.ids.map((id) => this.#permanent(id)).filter(Boolean), controllerId, context.sourceId);
        break;
      }
      case CHOICE.MAY:
        if (choice === 'yes') this.#runEffects(decision.effects, controllerId, context);
        break;
      case CHOICE.OPTIONAL_COST: {
        context.paid = choice !== 'decline';
        if (!context.paid) break;
        const [index, ids] = String(choice).split(':');
        const cost = decision.costs[Number(index)];
        for (const id of ids ? ids.split(',') : []) this.#sacrifice(this.#permanent(id), playerId, context);
        this.#autoPay(playerId, cost);
        break;
      }
      case CHOICE.PAY:
        if (choice === 'pay') {
          this.#autoPay(playerId, decision.cost);
        } else if (decision.counterId) {
          this.#applyEffect({ type: EFFECT.COUNTER_SPELL, affected: AFFECTED.TARGET }, controllerId, { ...context, targets: [decision.counterId] });
        } else {
          this.#runEffects(decision.otherwise, controllerId, context);
        }
        break;
      case CHOICE.CREATURE_TYPE: {
        this.#zones.get(playerId).turnTally.notedTypes.push(choice);
        const saga = this.#permanent(context.sourceId);
        if (saga) saga.notedTypes = [...(saga.notedTypes ?? []), choice];
        this.#emitEvent('creatureTypeNoted', { playerId, subtype: choice, sourceId: context.sourceId });
        break;
      }
      case CHOICE.GRAVEYARD_CARD: {
        if (choice === 'decline') break;
        const zone = this.#zones.get(playerId);
        const [card] = zone.graveyard.splice(zone.graveyard.findIndex((c) => c.id === choice), 1);
        this.#arriveFromGraveyard(card, playerId, decision.to === 'battlefield' ? playerId : null, { sourceId: context.sourceId });
        break;
      }
      case CHOICE.HAND_CARD: {
        if (choice === 'decline') break;
        const zone = this.#zones.get(playerId);
        const [card] = zone.hand.splice(zone.hand.findIndex((c) => c.id === choice), 1);
        const permanent = this.#putOntoBattlefield(card, playerId, { tapped: decision.tapped, attacking: decision.attacking && this.#combat.attackers.length > 0 });
        this.#emitEvent('permanentEntered', { playerId, card: this.#forEvent(permanent) });
        break;
      }
      default:
        throw new Error(`Unknown choice: ${decision.kind}`);
    }
    if (!this.#pendingDecision && this.#resolving) this.#continueResolution();
  }

  /** DECISION.CHOOSE_MANY: one option in or out (in the order chosen). */
  #toggleChoice(choice) {
    const decision = this.#pendingDecision;
    decision.selected = decision.selected.includes(choice)
      ? decision.selected.filter((c) => c !== choice)
      : [...decision.selected, choice];
  }

  #confirmChoice() {
    const decision = this.#pendingDecision;
    this.#pendingDecision = null;
    const { playerId, selected } = decision;
    const zone = this.#zones.get(playerId);
    this.#emitEvent('choiceMade', { playerId, kind: decision.kind, choice: [...selected] });
    switch (decision.kind) {
      case CHOICE.SCRY: {
        // 701.22a: the chosen cards stay on top in that order; the rest go to the bottom.
        const looked = zone.library.splice(0, decision.options.length);
        const byId = (id) => looked.find((c) => c.id === id);
        const top = selected.map(byId);
        const bottom = looked.filter((c) => !selected.includes(c.id));
        zone.library.unshift(...top);
        zone.library.push(...bottom);
        this.#emitEvent('scried', { playerId, count: looked.length, top: top.length, bottom: bottom.length });
        // 701.22b: "Whenever you scry" abilities trigger.
        this.#triggerWatchers(TRIGGER.SCRY, { id: null, controllerId: playerId, count: looked.length });
        break;
      }
      case CHOICE.SEARCH: {
        for (const id of selected) {
          const [card] = zone.library.splice(zone.library.findIndex((c) => c.id === id), 1);
          if (decision.destination === 'battlefield') {
            const permanent = this.#putOntoBattlefield(card, playerId, { tapped: decision.tapped });
            this.#emitEvent('permanentEntered', { playerId, card: this.#forEvent(permanent) });
          } else {
            zone.hand.push(card);
            // 701.19: a searched card is revealed, so everyone knows it.
            this.#notesOf(playerId)[card.id] = { revealed: true };
            this.#emitEvent('cardSearchedForHand', { playerId, cardId: card.id, cardName: card.name });
            this.#burnIfHandFull(playerId, card.id, 'search');
          }
        }
        this.#shuffleLibrary(playerId);
        break;
      }
      case CHOICE.GRAVEYARD_CARDS: {
        for (const id of selected) zone.library.push(...zone.graveyard.splice(zone.graveyard.findIndex((c) => c.id === id), 1));
        if (selected.length) this.#emitEvent('cardsShuffledIntoLibrary', { playerId, cardIds: [...selected] });
        this.#shuffleLibrary(playerId);
        break;
      }
      case CHOICE.LOOK: {
        // The chosen cards are revealed and put into the hand; the rest go on the bottom in a random order.
        const looked = zone.library.splice(0, decision.looked.length);
        const rest = looked.filter((c) => !selected.includes(c.id));
        for (const card of looked.filter((c) => selected.includes(c.id))) {
          zone.hand.push(card);
          this.#notesOf(playerId)[card.id] = { revealed: true };
          this.#emitEvent('cardSearchedForHand', { playerId, cardId: card.id, cardName: card.name });
          this.#burnIfHandFull(playerId, card.id, 'search');
        }
        shuffle(rest, this.#random);
        zone.library.push(...rest);
        this.#emitEvent('cardsPutOnBottom', { playerId, count: rest.length });
        break;
      }
      case CHOICE.EXILE_FROM_HAND:
        for (const id of selected) zone.exile.push(...zone.hand.splice(zone.hand.findIndex((c) => c.id === id), 1));
        this.#emitEvent('cardsExiledFromHand', { playerId, cardIds: [...selected] });
        break;
      case CHOICE.KEEP: {
        // Mount Doom: "Choose up to two creatures, then destroy the rest."
        const doomed = this.#battlefield.filter((p) => isCreature(p) && !selected.includes(p.id) && !hasKeyword(p, KEYWORD.INDESTRUCTIBLE));
        this.#leaving = doomed;
        for (const permanent of doomed) {
          this.#putIntoGraveyard(permanent);
          this.#emitEvent('permanentDestroyed', { cardId: permanent.id, cardName: permanent.name, controllerId: permanent.controllerId, sourceId: decision.sourceId });
        }
        this.#leaving = [];
        break;
      }
      case CHOICE.HAND_CARDS:
        for (const id of selected) {
          const index = zone.hand.findIndex((c) => c.id === id);
          if (index === -1 || this.#atLimit(playerId, zone.hand[index])) continue;
          const [card] = zone.hand.splice(index, 1);
          const permanent = this.#putOntoBattlefield(card, playerId);
          this.#emitEvent('permanentEntered', { playerId, card: this.#forEvent(permanent) });
        }
        break;
      case CHOICE.EXILE_COST:
        // 601.2h: the rest of the cost is paid; then the player who activated the ability gets priority.
        for (const id of selected) zone.exile.push(...zone.graveyard.splice(zone.graveyard.findIndex((c) => c.id === id), 1));
        this.#emitEvent('cardsExiledFromGraveyard', { playerId, cardIds: [...selected], sourceId: decision.sourceId });
        this.#givePriority(playerId);
        return;
      default:
        throw new Error(`Unknown choice: ${decision.kind}`);
    }
    if (!this.#pendingDecision && this.#resolving) this.#continueResolution();
  }

  /**
   * 704.5j: a player who controls legendary permanents with the same name chooses
   * one to keep. Returns true when a player must choose, which leaves
   * `priorityPlayerId` waiting.
   */
  #checkLegendRule(priorityPlayerId) {
    for (const playerId of this.#apnapOrder()) {
      const byName = new Map();
      for (const p of this.#battlefield) {
        if (p.controllerId === playerId && isLegendary(p)) byName.set(p.name, [...(byName.get(p.name) ?? []), p.id]);
      }
      const [name, cardIds] = [...byName].find(([, ids]) => ids.length > 1) ?? [];
      if (!name) continue;
      this.#priorityPlayerId = null;
      this.#requireDecision({ type: DECISION.LEGEND_RULE, playerId, name, cardIds, priorityPlayerId });
      return true;
    }
    return false;
  }

  #keepLegend(playerId, cardId) {
    const { cardIds, priorityPlayerId } = this.#pendingDecision;
    this.#pendingDecision = null;
    for (const id of cardIds.filter((id) => id !== cardId)) {
      const permanent = this.#permanent(id);
      this.#putIntoGraveyard(permanent);
      this.#emitEvent('permanentToGraveyard', {
        cardId: id, cardName: permanent.name, controllerId: playerId, reason: 'legendRule',
      });
    }
    this.#givePriority(priorityPlayerId);
  }

  // ---------------------------------------------------------------------------
  // Targets, attachments and continuous effects (Comprehensive Rules 115, 301.5, 303.4, 613)

  /**
   * Whether `id` (a player, permanent, stack object or card in a graveyard) is a legal
   * target of `kind` (a TARGET kind or a spec, see targetKindOf) for `controllerId`;
   * `excludeId` never is. `chosen` are the targets chosen before it, for a spec that
   * depends on them ("another target creature that player controls").
   */
  #isLegalTarget(kind, id, controllerId, excludeId = null, {
    sourceId = null, x = null, chosen = [], amassedArmyId = null,
  } = {}) {
    const base = targetKindOf(kind);
    if (!Object.values(TARGET).includes(base)) throw new Error(`Unknown target kind: ${base}`);
    if (!id || id === excludeId) return false;
    const spec = typeof kind === 'object' ? kind : {};
    if (spec.other && id === sourceId) return false;
    const filter = targetFilterOf(kind);
    const passes = (object) => !filter || matchesFilter(object, { controller: 'any', ...filter }, this.#filterContext(controllerId, sourceId, x));
    if (GRAVEYARD_TARGETS.has(base)) {
      const card = this.#zones.get(controllerId).graveyard.find((c) => c.id === id);
      if (!card || (base === TARGET.PERMANENT_CARD_IN_YOUR_GRAVEYARD && !isPermanentCard(card))) return false;
      return passes({ ...card, controllerId });
    }
    if (this.#zones.has(id)) {
      // 115.4: "any target" includes players. Players who have lost have left the game.
      if (this.#zones.get(id).hasLost) return false;
      return base === TARGET.ANY || base === TARGET.PLAYER || (base === TARGET.OPPONENT && id !== controllerId);
    }
    const stackObject = this.#stack.find((s) => s.id === id);
    if (stackObject) {
      // 115.1a: "target spell" means a spell on the stack, not an ability.
      if (!SPELL_TARGETS.has(base) || stackObject.kind !== 'spell') return false;
      if (base === TARGET.CREATURE_SPELL && !isCreature(stackObject.card)) return false;
      if (base === TARGET.NONCREATURE_SPELL && isCreature(stackObject.card)) return false;
      return passes({ ...stackObject.card, controllerId: stackObject.controllerId });
    }
    const permanent = this.#permanent(id);
    if (!permanent) return false;
    if (!matchesPermanentKind(permanent, base, controllerId, this.#combat) || !passes(permanent)) return false;
    // 702.11b: hexproof: not a legal target for spells and abilities its opponents control.
    if (hasKeyword(permanent, KEYWORD.HEXPROOF) && permanent.controllerId !== controllerId) return false;
    // Rangers of Ithilien: "target creature with lesser power" (than the source).
    if (spec.lesserPowerThanSource && !(permanent.power < (this.#permanent(sourceId)?.power ?? -Infinity))) return false;
    // Grishnákh: "with power less than or equal to the amassed Army's power".
    if (spec.powerAtMostAmassedArmy && !(permanent.power <= Math.max(0, this.#permanent(amassedArmyId)?.power ?? -1))) return false;
    if (spec.sameControllerAsTarget !== undefined) {
      const other = this.#permanent(chosen[spec.sameControllerAsTarget]);
      if (!other || other.controllerId !== permanent.controllerId) return false;
    }
    return true;
  }

  /**
   * Legal targets as `{ id }` objects: permanents, then players, then spells (top of the
   * stack first); or cards, for a graveyard target kind.
   */
  #legalTargets(kind, controllerId, excludeId, options = {}) {
    if (GRAVEYARD_TARGETS.has(targetKindOf(kind))) {
      return this.#zones.get(controllerId).graveyard.filter((c) => this.#isLegalTarget(kind, c.id, controllerId, null, options));
    }
    return [...this.#battlefield, ...this.#players, ...[...this.#stack].reverse()]
      .filter((p) => this.#isLegalTarget(kind, p.id, controllerId, excludeId, options));
  }

  /** Whether an attached Aura or Equipment is attached to something it legally can be. */
  #isLegallyAttached(permanent) {
    const host = this.#permanent(permanent.attachedTo);
    if (!host || host.id === permanent.id) return false;
    // 303.4a: an Aura's enchant ability says what it can be attached to.
    if (isAura(permanent)) {
      const { enchant } = this.#cardDefinitions[permanent.cardId];
      return enchant === TARGET.CREATURE ? isCreature(host) : false;
    }
    // 301.5c: Equipment can be attached only to a creature.
    if (isEquipment(permanent)) return isCreature(host);
    return false;
  }

  #attach(permanent, hostId) {
    const from = permanent.attachedTo;
    permanent.attachedTo = hostId;
    this.#emitEvent('attached', { cardId: permanent.id, cardName: permanent.name, attachedTo: hostId, from });
    this.#applyContinuousEffects();
  }

  #unattach(permanent) {
    const from = permanent.attachedTo;
    permanent.attachedTo = null;
    this.#emitEvent('unattached', { cardId: permanent.id, cardName: permanent.name, from });
    this.#applyContinuousEffects();
  }

  /**
   * 613: recalculates every permanent's characteristics from its printed values plus
   * continuous effects, layer by layer: types (4), abilities (6), then power and toughness
   * (7a characteristic-defining, 7b setting, 7c modifying and counters). Within a layer,
   * static abilities apply before effects from resolved spells, which apply in the order
   * they were created (613.7). Losing all abilities removes the permanent's own static and
   * triggered abilities and every ability it had been given before the effect began; later
   * grants still apply.
   */
  #applyContinuousEffects() {
    // "for as long as you control this Saga": such an effect ends when that stops being true, and control
    // it gave goes back (Rangers of Ithilien).
    const ended = this.#temporaryEffects.filter((e) => e.duration === 'whileSourceControlled' && this.#permanent(e.sourceId)?.controllerId !== e.controllerId);
    if (ended.length) {
      this.#temporaryEffects = this.#temporaryEffects.filter((e) => !ended.includes(e));
      for (const effect of ended.filter((e) => e.revertControlTo)) {
        const permanent = this.#permanent(effect.targetId);
        if (!permanent || permanent.controllerId === effect.revertControlTo) continue;
        this.#setController(permanent, effect.revertControlTo);
        this.#emitEvent('controlChanged', { cardId: permanent.id, cardName: permanent.name, to: effect.revertControlTo, reverted: true });
      }
    }
    for (const permanent of this.#battlefield) {
      const { base } = permanent;
      permanent.keywords = [...base.keywords];
      // 702.21: its ward costs, printed and granted (Flowering of the White Tree).
      const ward = this.#cardDefinitions[permanent.cardId].ward;
      permanent.wards = ward ? [ward] : [];
      if (base.power !== undefined) {
        permanent.power = base.power;
        permanent.toughness = base.toughness;
      }
      permanent.types = [...(base.types ?? permanent.types)];
      permanent.subtypes = [...(base.subtypes ?? permanent.subtypes ?? [])];
      permanent.supertypes = [...(base.supertypes ?? permanent.supertypes ?? [])];
      permanent.abilitiesLost = false;
      permanent.grantedTriggers = [];
    }
    for (const effect of this.#temporaryEffects) {
      const target = effect.loseAbilities && this.#permanent(effect.targetId);
      if (target) target.abilitiesLost = true;
    }
    const statics = [];
    for (const source of this.#battlefield) {
      if (source.abilitiesLost) continue;
      for (const effect of this.#cardDefinitions[source.cardId].staticAbilities ?? []) {
        if (!effect.rule) statics.push([source, effect]);
      }
    }
    const holds = ([source, effect]) => !effect.condition
      || this.#checkCondition(effect.condition, source.controllerId, { sourceId: source.id });
    const affected = (source, effect) => {
      if (effect.affected === AFFECTED.ATTACHED_PERMANENT) {
        const host = source.attachedTo && this.#permanent(source.attachedTo);
        return host ? [host] : [];
      }
      if (effect.affected === AFFECTED.SOURCE) return [source];
      // Anthems and lords (613.1): every creature they apply to, as it is now.
      if (effect.affected === AFFECTED.EACH_CREATURE_YOU_CONTROL) return this.#battlefield.filter((p) => anthemApplies(effect, source, p));
      return [];
    };
    // Layer 4: type-changing effects (Fog on the Barrow-Downs, Grond, crew).
    for (const [source, effect] of statics) {
      if ((!effect.setSubtypes && !effect.addTypes) || !holds([source, effect])) continue;
      for (const permanent of affected(source, effect)) {
        if (effect.setSubtypes) permanent.subtypes = [...effect.setSubtypes];
        for (const type of effect.addTypes ?? []) if (!permanent.types.includes(type)) permanent.types.push(type);
      }
    }
    for (const effect of this.#temporaryEffects) {
      const target = effect.addTypes && this.#permanent(effect.targetId);
      if (target) for (const type of effect.addTypes) if (!target.types.includes(type)) target.types.push(type);
    }
    // The Ring, level 1 (701.54c): "Your Ring-bearer is legendary and can't be blocked by creatures with greater power."
    for (const [playerId, zone] of this.#zones) {
      const bearer = zone.ring.level >= 1 && this.#ringBearer(playerId);
      if (!bearer) continue;
      if (!bearer.supertypes.includes('Legendary')) bearer.supertypes.push('Legendary');
      if (!bearer.keywords.includes(KEYWORD.CANT_BE_BLOCKED_BY_GREATER_POWER)) bearer.keywords.push(KEYWORD.CANT_BE_BLOCKED_BY_GREATER_POWER);
    }
    // Layer 7a: characteristic-defining abilities (Old Man Willow: the number of lands you control).
    for (const [source, effect] of statics) {
      if (!effect.setPowerToughness) continue;
      const n = this.#countFor(effect.setPowerToughness, source.controllerId, { sourceId: source.id });
      source.power = n;
      source.toughness = n;
    }
    // Layer 7b: "has base power and toughness 5/5 until end of turn".
    for (const effect of this.#temporaryEffects) {
      const target = effect.setBase && this.#permanent(effect.targetId);
      if (!target) continue;
      target.power = effect.setBase.power;
      target.toughness = effect.setBase.toughness;
    }
    const grant = (permanent, effect) => {
      if (isCreature(permanent)) {
        permanent.power += effect.power ?? 0;
        permanent.toughness += effect.toughness ?? 0;
      }
      for (const keyword of effect.keywords ?? []) {
        if (!permanent.keywords.includes(keyword)) permanent.keywords.push(keyword);
      }
      if (effect.grantTriggers) permanent.grantedTriggers.push(...effect.grantTriggers);
      if (effect.ward) permanent.wards.push(effect.ward);
    };
    // Layers 6 and 7c: static abilities.
    for (const [source, effect] of statics) {
      if (effect.setSubtypes || effect.addTypes || effect.setPowerToughness || !holds([source, effect])) continue;
      for (const permanent of affected(source, effect)) {
        // "+2/+2 for each other creature that shares a creature type with it" (Alpha Status).
        grant(permanent, effect.per ? scaleEffect(effect, countOf(effect.per, {
          battlefield: this.#battlefield, controllerId: source.controllerId, sourceId: source.id, subject: permanent, combat: this.#combat,
        })) : effect);
      }
    }
    // Losing all abilities takes away the keywords and triggers it had (but it keeps its counters' and effects' bonuses).
    for (const permanent of this.#battlefield.filter((p) => p.abilitiesLost)) {
      permanent.keywords = [];
      permanent.grantedTriggers = [];
      permanent.wards = [];
    }
    // 613.4c: +1/+1 counters.
    for (const permanent of this.#battlefield) {
      const plusOne = permanent.counters[COUNTER.PLUS_ONE] ?? 0;
      if (plusOne && isCreature(permanent)) {
        permanent.power += plusOne;
        permanent.toughness += plusOne;
      }
    }
    // Effects from resolved spells apply after static abilities, in the order they were created (613.7).
    for (const effect of this.#temporaryEffects) {
      const target = this.#permanent(effect.targetId);
      if (!target) continue;
      if (isCreature(target)) {
        target.power += effect.power;
        target.toughness += effect.toughness;
      }
      for (const keyword of effect.keywords) {
        if (!target.keywords.includes(keyword)) target.keywords.push(keyword);
      }
      if (effect.grantTriggers) target.grantedTriggers.push(...effect.grantTriggers);
      if (effect.removeKeywords) target.keywords = target.keywords.filter((k) => !effect.removeKeywords.includes(k));
    }
  }

  /** 714.2c: chapter abilities trigger as lore counters reach their numbers. */
  #triggerChapters(saga, from, to) {
    for (const ability of this.#triggeredAbilitiesOf(saga)) {
      if (!triggersOn(ability, TRIGGER.CHAPTER)) continue;
      for (const chapter of ability.chapters ?? []) {
        if (chapter > from && chapter <= to) {
          this.#queueTrigger(ability, { sourceId: saga.id, sourceName: saga.name, controllerId: saga.controllerId, subject: { chapter } });
        }
      }
    }
  }

  /** 714.2d: a Saga's final chapter number. */
  #finalChapter(saga) {
    return Math.max(0, ...(this.#cardDefinitions[saga.cardId].triggeredAbilities ?? [])
      .filter((a) => triggersOn(a, TRIGGER.CHAPTER)).flatMap((a) => a.chapters ?? []));
  }

  // ---------------------------------------------------------------------------
  // Combat (Comprehensive Rules 506–511)

  #defendingPlayerId() {
    // 506.2: in a two-player game, the defending player is the nonactive player.
    return this.#nextPlayerId(this.#activePlayerId);
  }

  /** 302.6 / 702.10b: summoning sickness, which haste ignores. */
  #hasSummoningSickness(permanent) {
    return isCreature(permanent) && permanent.summoningSick && !hasKeyword(permanent, KEYWORD.HASTE);
  }

  #eligibleAttackers(playerId) {
    // 508.1a: untapped creatures without summoning sickness. 702.3b: defender can't
    // attack, nor can a creature with "can't attack" (508.1c).
    return this.#battlefield.filter((p) => (
      p.controllerId === playerId && isCreature(p) && !p.tapped
      && !this.#hasSummoningSickness(p) && !hasKeyword(p, KEYWORD.DEFENDER) && !hasKeyword(p, KEYWORD.CANT_ATTACK)
    ));
  }

  #eligibleBlockers(playerId) {
    // 509.1a: untapped creatures the defending player controls.
    return this.#battlefield.filter((p) => p.controllerId === playerId && isCreature(p) && !p.tapped);
  }

  #canBlock(blocker, attacker) {
    // 509.1b: restrictions on blocking ("can't block", flying, ...).
    return canBlockCreature(blocker, attacker);
  }

  /**
   * 509.1b-c: restrictions on how many creatures block an attacker (menace, "more than
   * one creature"), and requirements ("must be blocked if able", "all creatures able to
   * block it do so"), obeyed as far as possible (see blockRules.js).
   */
  #blocksAreLegal(blocks) {
    const attackers = this.#combat.attackers.map(({ cardId }) => this.#permanent(cardId));
    const blockers = this.#eligibleBlockers(this.#defendingPlayerId());
    return blocksLegal(attackers, blockers, blocks, (b, a) => this.#canBlock(b, a));
  }

  #beginDeclareAttackers() {
    // 508.1: the active player declares attackers (a turn-based action).
    const playerId = this.#activePlayerId;
    if (this.#eligibleAttackers(playerId).length === 0) {
      this.#emitEvent('attackersDeclared', { playerId, attackers: [], defendingPlayerId: this.#defendingPlayerId() });
      return;
    }
    const required = this.#eligibleAttackers(playerId).filter((p) => hasKeyword(p, KEYWORD.MUST_ATTACK)).map((p) => p.id);
    this.#requireDecision({ type: DECISION.DECLARE_ATTACKERS, playerId, attackers: required });
  }

  #toggleAttacker(cardId) {
    const decision = this.#pendingDecision;
    decision.attackers = decision.attackers.includes(cardId)
      ? decision.attackers.filter((id) => id !== cardId)
      : [...decision.attackers, cardId];
  }

  #confirmAttackers() {
    const { playerId, attackers } = this.#pendingDecision;
    this.#pendingDecision = null;
    const defendingPlayerId = this.#defendingPlayerId();
    // 508.1f: attacking creatures become tapped, except those with vigilance (702.20b).
    for (const id of attackers) {
      const creature = this.#permanent(id);
      if (!hasKeyword(creature, KEYWORD.VIGILANCE)) creature.tapped = true;
    }
    this.#combat.declaredAttackers = [...attackers];
    this.#combat.attackers = attackers.map((cardId) => (
      { cardId, defendingPlayerId, blocked: false, blockerIds: [], damageAssignment: null }
    ));
    this.#emitEvent('attackersDeclared', { playerId, attackers: [...attackers], defendingPlayerId });
    const tally = this.#zones.get(playerId).turnTally;
    tally.attackedWith = Math.max(tally.attackedWith, attackers.length);
    // 508.3a: "Whenever this creature attacks" abilities trigger.
    const attacking = attackers.map((id) => this.#permanent(id));
    for (const creature of attacking) {
      this.#trigger(creature, TRIGGER.ATTACKS, creature.controllerId);
      this.#trigger(creature, TRIGGER.ATTACKS_OR_BLOCKS, creature.controllerId);
      // "Whenever an Army you control attacks".
      this.#triggerWatchers(TRIGGER.CREATURE_ATTACKS, creature);
      // Andúril: "Whenever equipped creature attacks".
      for (const equipment of this.#battlefield.filter((p) => p.attachedTo === creature.id && isEquipment(p))) {
        this.#trigger(equipment, TRIGGER.EQUIPPED_ATTACKS, equipment.controllerId, () => true, { id: creature.id, controllerId: creature.controllerId });
      }
    }
    // "Whenever you attack with one or more Elves", "Whenever two or more creatures you control attack", "Whenever you
    // attack" (any attackers), "Whenever you attack with Merry and another legendary creature" (`includesSource`).
    if (attacking.length) {
      for (const permanent of [...this.#battlefield]) {
        this.#trigger(permanent, TRIGGER.ATTACKS_WITH, permanent.controllerId, (ability) => permanent.controllerId === playerId
          && (!ability.includesSource || attackers.includes(permanent.id))
          && attacking.filter((c) => matchesFilter(c, ability.filter, this.#filterContext(permanent.controllerId, permanent.id))).length >= (ability.minCount ?? 1));
      }
    }
    // The Ring, level 2 (701.54c): "Whenever your Ring-bearer attacks, draw a card, then discard a card."
    const bearer = this.#ringBearer(playerId);
    if (bearer && attackers.includes(bearer.id) && this.#zones.get(playerId).ring.level >= 2) {
      this.#ringTrigger(playerId, bearer, 'Whenever your Ring-bearer attacks, draw a card, then discard a card.', [
        { type: EFFECT.DRAW_CARDS, count: 1 }, { type: EFFECT.DISCARD, count: 1 },
      ]);
    }
    // 508.2: the active player then receives priority.
    this.#givePriority(this.#activePlayerId);
  }

  #beginDeclareBlockers() {
    // 509.1: the defending player declares blockers (a turn-based action).
    const playerId = this.#defendingPlayerId();
    const canBlockSomething = this.#eligibleBlockers(playerId).some((blocker) => (
      this.#combat.attackers.some(({ cardId }) => this.#canBlock(blocker, this.#permanent(cardId)))
    ));
    if (!canBlockSomething) {
      this.#emitEvent('blockersDeclared', { playerId, blocks: [] });
      return;
    }
    this.#requireDecision({ type: DECISION.DECLARE_BLOCKERS, playerId, blocks: {} });
  }

  #setBlocker(cardId, attackerId) {
    const { blocks } = this.#pendingDecision;
    if (attackerId === null) delete blocks[cardId];
    else blocks[cardId] = attackerId;
  }

  #confirmBlockers() {
    const { playerId, blocks } = this.#pendingDecision;
    this.#pendingDecision = null;
    // 509.1g / 509.1h: each blocker blocks one attacker, which becomes blocked.
    for (const [blockerId, attackerId] of Object.entries(blocks)) {
      const attacker = this.#combat.attackers.find((a) => a.cardId === attackerId);
      attacker.blocked = true;
      attacker.blockerIds.push(blockerId);
    }
    this.#emitEvent('blockersDeclared', {
      playerId,
      blocks: Object.entries(blocks).map(([blockerId, attackerId]) => ({ blockerId, attackerId })),
    });
    // 509.3c: "Whenever this creature blocks" abilities trigger.
    for (const blockerId of Object.keys(blocks)) {
      const creature = this.#permanent(blockerId);
      this.#trigger(creature, TRIGGER.ATTACKS_OR_BLOCKS, creature.controllerId);
    }
    for (const attacker of this.#combat.attackers.filter((a) => a.blocked)) {
      const creature = this.#permanent(attacker.cardId);
      // 509.3c: "Whenever this creature becomes blocked".
      this.#trigger(creature, TRIGGER.BECOMES_BLOCKED, creature.controllerId);
      for (const blockerId of attacker.blockerIds) {
        const blocker = this.#permanent(blockerId);
        // You Cannot Pass!: "a creature that blocked or was blocked by a legendary creature this turn".
        if (isLegendary(creature)) blocker.blockedByOrBlockedLegendaryThisTurn = true;
        if (isLegendary(blocker)) creature.blockedByOrBlockedLegendaryThisTurn = true;
        // Barrow-Blade: "Whenever equipped creature blocks or becomes blocked by a creature".
        for (const [own, other] of [[creature, blocker], [blocker, creature]]) {
          for (const equipment of this.#battlefield.filter((p) => p.attachedTo === own.id)) {
            this.#trigger(equipment, TRIGGER.EQUIPPED_BLOCKS_OR_BLOCKED, equipment.controllerId, () => true, { id: other.id, controllerId: other.controllerId });
          }
        }
      }
      // The Ring, level 3: "Whenever your Ring-bearer becomes blocked by a creature, that creature's
      // controller sacrifices it at end of combat."
      if (this.#ringBearer(creature.controllerId)?.id === creature.id && this.#zones.get(creature.controllerId).ring.level >= 3) {
        for (const blockerId of attacker.blockerIds) {
          const blocker = this.#permanent(blockerId);
          this.#ringTrigger(creature.controllerId, creature, "Whenever your Ring-bearer becomes blocked by a creature, that creature's controller sacrifices it at end of combat.", [
            { type: EFFECT.DELAYED_TRIGGER, at: 'endOfCombat', affected: AFFECTED.SUBJECT, text: `${blocker.name}'s controller sacrifices it.`,
              effects: [{ type: EFFECT.SACRIFICE, affected: AFFECTED.SUBJECT_CONTROLLER, subjectOnly: true, filter: {} }] },
          ], { id: blocker.id, controllerId: blocker.controllerId });
        }
      }
    }
    // Abilities that depend on blocks ("as long as it's blocking or blocked by a Goblin or Orc") apply now.
    this.#applyContinuousEffects();
    // 509.2: the active player then receives priority.
    this.#givePriority(this.#activePlayerId);
  }

  /**
   * 510.4: with first strike or double strike in combat there are two combat damage
   * steps. Creatures with first strike deal damage in the first, creatures without
   * it in the second, and creatures with double strike (702.4b) in both.
   */
  #dealsDamageThisStep(creature) {
    if (hasKeyword(creature, KEYWORD.DOUBLE_STRIKE)) return true;
    return hasKeyword(creature, KEYWORD.FIRST_STRIKE) === (this.#segment.step === STEP.FIRST_STRIKE_DAMAGE);
  }

  /** The damage needed to destroy `blocker`, counting damage already marked (702.19b). */
  #lethalDamage(blocker, source) {
    const remaining = Math.max(0, blocker.toughness - blocker.damage);
    // 702.2c: any nonzero damage from a deathtouch source is lethal.
    return hasKeyword(source, KEYWORD.DEATHTOUCH) ? Math.min(1, remaining) : remaining;
  }

  /**
   * Every legal way for an attacking creature to assign its combat damage, as
   * `{ [blockerId or defendingPlayerId]: amount }` objects (510.1).
   */
  /** The combat damage a creature assigns (510.1a): its power, or its toughness for Bill the Pony's. */
  #combatDamageOf(creature) {
    return hasKeyword(creature, KEYWORD.DAMAGE_BY_TOUGHNESS) ? creature.toughness : creature.power;
  }

  #damageAssignmentOptions(attacker) {
    const creature = this.#permanent(attacker.cardId);
    const power = this.#combatDamageOf(creature);
    if (power <= 0) return [];
    const player = attacker.defendingPlayerId;
    // 510.1a: an unblocked creature assigns its damage to the player it's attacking.
    if (!attacker.blocked) return [{ [player]: power }];
    const trample = hasKeyword(creature, KEYWORD.TRAMPLE);
    // 510.1c: a blocked creature with no blockers left assigns no damage...
    // 702.19e: ... unless it has trample, in which case it all goes to the player.
    if (attacker.blockerIds.length === 0) return trample ? [{ [player]: power }] : [];
    // 510.1c: otherwise its damage is divided among its blockers as the attacking player chooses.
    if (!trample) return distributions(power, attacker.blockerIds);
    // 702.19b: with trample, damage can go to the player only once every blocker
    // has been assigned lethal damage.
    const lethal = attacker.blockerIds.map((id) => this.#lethalDamage(this.#permanent(id), creature));
    return distributions(power, [...attacker.blockerIds, player]).filter((split) => (
      split[player] === 0 || attacker.blockerIds.every((id, i) => split[id] >= lethal[i])
    ));
  }

  #beginCombatDamageStep() {
    for (const attacker of this.#combat.attackers) attacker.damageAssignment = null;
    if (!this.#requestDamageAssignment()) this.#dealCombatDamage();
  }

  /**
   * Asks the attacking player to choose how the next attacker assigns its damage,
   * when there's more than one legal way. Returns false when nothing is left to choose.
   */
  #requestDamageAssignment() {
    for (const attacker of this.#combat.attackers) {
      const creature = this.#permanent(attacker.cardId);
      if (attacker.damageAssignment || !this.#dealsDamageThisStep(creature)) continue;
      const options = this.#damageAssignmentOptions(attacker);
      if (options.length < 2) continue;
      this.#requireDecision({
        type: DECISION.ASSIGN_COMBAT_DAMAGE,
        playerId: this.#activePlayerId,
        attackerId: attacker.cardId,
        power: this.#combatDamageOf(creature),
        blockerIds: [...attacker.blockerIds],
        trample: hasKeyword(creature, KEYWORD.TRAMPLE),
      });
      return true;
    }
    return false;
  }

  #assignCombatDamage(assignment) {
    const { attackerId } = this.#pendingDecision;
    this.#pendingDecision = null;
    this.#combat.attackers.find((a) => a.cardId === attackerId).damageAssignment = { ...assignment };
    if (this.#requestDamageAssignment()) return;
    this.#dealCombatDamage();
    this.#givePriority(this.#activePlayerId);
  }

  #dealCombatDamage() {
    // 510.1: work out all combat damage first; 510.2: then deal it simultaneously.
    const damage = [];
    for (const attacker of this.#combat.attackers) {
      const creature = this.#permanent(attacker.cardId);
      if (this.#dealsDamageThisStep(creature)) {
        const assignment = attacker.damageAssignment ?? this.#damageAssignmentOptions(attacker)[0] ?? {};
        for (const [targetId, amount] of Object.entries(assignment)) {
          if (amount <= 0) continue;
          const target = targetId === attacker.defendingPlayerId ? { targetPlayerId: targetId } : { targetCardId: targetId };
          damage.push({ sourceId: creature.id, ...target, amount });
        }
      }
      // 510.1d: each blocker assigns its damage to the creature it blocks.
      for (const blockerId of attacker.blockerIds) {
        const blocker = this.#permanent(blockerId);
        if (this.#combatDamageOf(blocker) > 0 && this.#dealsDamageThisStep(blocker)) {
          damage.push({ sourceId: blocker.id, targetCardId: creature.id, amount: this.#combatDamageOf(blocker) });
        }
      }
    }

    const lifeGained = {};
    for (const { sourceId, targetPlayerId, targetCardId, amount } of damage) {
      const source = this.#permanent(sourceId);
      if (targetPlayerId) {
        // 120.3a: damage to a player causes that much life loss.
        this.#zones.get(targetPlayerId).life -= amount;
      } else {
        // 120.3e: damage to a creature is marked on it.
        const target = this.#permanent(targetCardId);
        target.damage += amount;
        target.dealtDamageThisTurn = true;
        if (hasKeyword(source, KEYWORD.DEATHTOUCH)) target.damagedByDeathtouch = true;
      }
      // 702.15b: damage dealt by a source with lifelink causes its controller to gain that much life.
      if (hasKeyword(source, KEYWORD.LIFELINK)) {
        lifeGained[source.controllerId] = (lifeGained[source.controllerId] ?? 0) + amount;
      }
    }
    for (const [playerId, amount] of Object.entries(lifeGained)) {
      // Gríma Wormtongue: "Your opponents can't gain life."
      if (this.#staticRules('opponentsCantGainLife').some((p) => p.controllerId !== playerId)) {
        delete lifeGained[playerId];
        continue;
      }
      this.#zones.get(playerId).life += amount;
    }

    this.#emitEvent('combatDamageDealt', {
      step: this.#segment.step,
      damage,
      lifeGained,
      life: Object.fromEntries([...this.#zones].map(([id, zone]) => [id, zone.life])),
    });
    // 510.3a: abilities that trigger on combat damage being dealt.
    const toPlayers = new Set();
    const damagedPlayers = new Set();
    for (const { sourceId, targetPlayerId, targetCardId } of damage) {
      const source = this.#permanent(sourceId);
      if (!source) continue;
      if (targetPlayerId) {
        damagedPlayers.add(targetPlayerId);
        // Witch-king of Angmar: "a creature … that dealt combat damage to you this turn".
        if (!source.combatDamagedPlayers?.includes(targetPlayerId)) source.combatDamagedPlayers = [...(source.combatDamagedPlayers ?? []), targetPlayerId];
        if (toPlayers.has(sourceId)) continue;
        toPlayers.add(sourceId);
        this.#trigger(source, TRIGGER.DEALS_COMBAT_DAMAGE_TO_PLAYER, source.controllerId);
        this.#triggerWatchers(TRIGGER.CREATURE_DEALS_COMBAT_DAMAGE_TO_PLAYER, source);
        // The Ring, level 4: "Whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life."
        if (this.#ringBearer(source.controllerId)?.id === source.id && this.#zones.get(source.controllerId).ring.level >= 4) {
          this.#ringTrigger(source.controllerId, source, 'Whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.', [
            { type: EFFECT.LOSE_LIFE, amount: 3, affected: AFFECTED.EACH_OPPONENT },
          ]);
        }
      } else {
        const target = this.#permanent(targetCardId);
        if (!target) continue;
        this.#trigger(source, TRIGGER.DEALS_DAMAGE_TO_CREATURE, source.controllerId, (ability) => (
          matchesFilter(target, { controller: 'any', ...ability.filter }, this.#filterContext(source.controllerId, source.id))
        ), { id: target.id, controllerId: target.controllerId });
      }
    }
    // "Whenever one or more creatures deal combat damage to you".
    for (const playerId of damagedPlayers) {
      for (const permanent of [...this.#battlefield].filter((p) => p.controllerId === playerId)) this.#trigger(permanent, TRIGGER.COMBAT_DAMAGE_TO_YOU, playerId);
    }
  }

  /** One of the Ring's triggered abilities (701.54c), with the Ring-bearer as its source. */
  #ringTrigger(playerId, bearer, text, effects, subject = null) {
    this.#queueTrigger({ id: 'ring', text, effects }, {
      sourceId: bearer.id, sourceName: 'The Ring', controllerId: playerId, subject,
    });
  }

  // ---------------------------------------------------------------------------
  // State-based actions (Comprehensive Rules 704)

  /** Performs state-based actions until there are none. Returns true if the game ended. */
  #checkStateBasedActions() {
    for (;;) {
      const losers = this.#players.filter(({ id }) => {
        const zone = this.#zones.get(id);
        // 704.5a: 0 or less life; 704.5b: attempted to draw from an empty library.
        return !zone.hasLost && (zone.life <= 0 || zone.attemptedDrawFromEmptyLibrary);
      });
      // 704.5f: toughness 0 or less; 704.5g: lethal damage; 704.5h: damage from a deathtouch source
      // (702.12b: an indestructible creature isn't destroyed by those two).
      const dying = this.#battlefield.filter((p) => isCreature(p) && (
        p.toughness <= 0 || (!hasKeyword(p, KEYWORD.INDESTRUCTIBLE) && (p.damage >= p.toughness || (p.damage > 0 && p.damagedByDeathtouch)))
      ));
      // 714.4: a Saga whose lore counters reached its final chapter, with no chapter ability waiting, is sacrificed.
      const finishedSagas = this.#battlefield.filter((p) => isSaga(p) && !dying.includes(p)
        && (p.counters[COUNTER.LORE] ?? 0) >= this.#finalChapter(p) && this.#finalChapter(p) > 0
        && !this.#pendingTriggers.some((t) => t.sourceId === p.id)
        && !this.#stack.some((o) => o.sourceId === p.id && o.kind === 'triggeredAbility')
        && this.#resolving?.stackObject.sourceId !== p.id);
      // 704.5m: an Aura attached to an illegal object, or to nothing, goes to its owner's graveyard.
      const fallenAuras = this.#battlefield.filter((p) => isAura(p) && !dying.includes(p) && !this.#isLegallyAttached(p));
      // 704.5n: Equipment attached to an illegal permanent becomes unattached.
      const looseEquipment = this.#battlefield.filter((p) => (
        isEquipment(p) && p.attachedTo && !dying.includes(p) && !this.#isLegallyAttached(p)
      ));
      if (losers.length === 0 && dying.length === 0 && fallenAuras.length === 0 && looseEquipment.length === 0 && finishedSagas.length === 0) {
        return false;
      }
      for (const saga of finishedSagas) this.#sacrifice(saga, saga.controllerId);

      for (const equipment of looseEquipment) this.#unattach(equipment);
      for (const aura of fallenAuras) {
        this.#putIntoGraveyard(aura);
        this.#emitEvent('permanentToGraveyard', {
          cardId: aura.id, cardName: aura.name, controllerId: aura.controllerId, reason: 'auraNotLegallyAttached',
        });
      }

      // 704.3: all applicable state-based actions happen simultaneously.
      this.#leaving = dying;
      for (const permanent of dying) {
        this.#putIntoGraveyard(permanent);
        this.#emitEvent('creatureDied', {
          cardId: permanent.id,
          cardName: permanent.name,
          controllerId: permanent.controllerId,
          reason: permanent.toughness <= 0 ? 'zeroToughness'
            : permanent.damage >= permanent.toughness ? 'lethalDamage' : 'deathtouch',
        });
      }
      this.#leaving = [];
      for (const { id } of losers) {
        const zone = this.#zones.get(id);
        zone.hasLost = true;
        const reason = zone.life <= 0 ? 'Life total reached 0.' : 'Attempted to draw from an empty library.';
        this.#emitEvent('playerLost', { playerId: id, reason });
      }
      if (losers.length > 0) {
        this.#endGame();
        return true;
      }
    }
  }

  #endGame() {
    // Multiplayer elimination isn't modelled: the game ends as soon as anyone loses.
    const remaining = this.#players.filter((p) => !this.#zones.get(p.id).hasLost);
    this.#status = GAME_STATUS.GAME_OVER;
    this.#winnerId = remaining.length === 1 ? remaining[0].id : null;
    this.#priorityPlayerId = null;
    this.#pendingDecision = null;
    this.#emitEvent('gameEnded', { winnerId: this.#winnerId });
  }

  // ---------------------------------------------------------------------------
  // Turn structure (Comprehensive Rules 500–514)

  get #segment() {
    return TURN_STRUCTURE[this.#segmentIndex] ?? null;
  }

  #requireDecision(decision) {
    this.#pendingDecision = decision;
    this.#emitEvent('decisionRequired', this.#forEvent(decision));
  }

  /**
   * Leave the current segment and move forward until a player receives priority
   * or must make a decision.
   */
  #advance() {
    for (;;) {
      const current = this.#segment;
      const { nextIndex, skipped } = this.#findNextSegment(this.#segmentIndex);
      const next = TURN_STRUCTURE[nextIndex] ?? null;

      if (current) this.#leaveSegment(current, next);
      for (const segment of skipped) this.#emitEvent('stepSkipped', this.#describe(segment));

      if (!next) {
        this.#emitEvent('turnEnded', { turn: this.#turn, activePlayerId: this.#activePlayerId });
        this.#beginTurn(this.#nextPlayerId(this.#activePlayerId));
        continue;
      }

      this.#enterSegment(nextIndex);
      if (this.#pendingDecision) return;
      if (next.priority) {
        // 117.3a: the active player receives priority at the start of each step and phase.
        this.#givePriority(this.#activePlayerId);
        return;
      }
    }
  }

  #findNextSegment(fromIndex) {
    const skipped = [];
    for (let i = fromIndex + 1; i < TURN_STRUCTURE.length; i++) {
      const segment = TURN_STRUCTURE[i];
      if (!segment.skip?.(this)) return { nextIndex: i, skipped };
      skipped.push(segment);
    }
    return { nextIndex: -1, skipped };
  }

  /** The notes on a player's hand, kept to the cards still in it. */
  #notesOf(playerId) {
    const zone = this.#zones.get(playerId);
    const inHand = new Set(zone.hand.map((c) => c.id));
    zone.handNotes = Object.fromEntries(Object.entries(zone.handNotes ?? {}).filter(([id]) => inHand.has(id)));
    return zone.handNotes;
  }

  /**
   * At the end of a player's turn, what everyone could see about each card they
   * kept in hand: `noLand` once they've ended a turn without playing a land while
   * holding it, and `heldWithMana`, the most untapped lands they've ended a turn
   * with while holding it. The AI may weigh its guesses by them (see determinize).
   */
  #noteHand(playerId) {
    const zone = this.#zones.get(playerId);
    const notes = this.#notesOf(playerId);
    const untapped = this.#battlefield.filter((p) => p.controllerId === playerId && isLand(p) && !p.tapped).length;
    for (const card of zone.hand) {
      const note = (notes[card.id] ??= {});
      if (zone.landsPlayedThisTurn === 0) note.noLand = true;
      note.heldWithMana = Math.max(note.heldWithMana ?? 0, untapped);
    }
  }

  #beginTurn(activePlayerId) {
    if (this.#activePlayerId && this.#zones.has(this.#activePlayerId)) this.#noteHand(this.#activePlayerId);
    this.#turn += 1;
    this.#activePlayerId = activePlayerId;
    this.#segmentIndex = -1;
    this.#combat = emptyCombat();
    for (const zone of this.#zones.values()) {
      zone.landsPlayedThisTurn = 0;
      zone.turnTally = emptyTally();
      for (const emblem of zone.emblems) emblem.activationsThisTurn = 0;
    }
    // 302.6: the active player has now controlled their permanents since the turn began.
    for (const permanent of this.#battlefield) {
      if (permanent.controllerId === activePlayerId) permanent.summoningSick = false;
      permanent.enteredThisTurn = false;
      permanent.dealtDamageThisTurn = false;
      permanent.blockedByOrBlockedLegendaryThisTurn = false;
      delete permanent.combatDamagedPlayers;
    }
    // "until your next turn" effects end as that player's turn begins (611.2b).
    if (this.#temporaryEffects.some((e) => e.duration === 'untilYourNextTurn' && e.controllerId === activePlayerId)) {
      this.#temporaryEffects = this.#temporaryEffects.filter((e) => !(e.duration === 'untilYourNextTurn' && e.controllerId === activePlayerId));
      this.#applyContinuousEffects();
    }
    this.#emitEvent('turnStarted', { turn: this.#turn, activePlayerId });
  }

  #enterSegment(index) {
    const previous = this.#segment;
    const segment = TURN_STRUCTURE[index];
    this.#segmentIndex = index;
    this.#resetPasses();
    this.#priorityPlayerId = null;

    if (!previous || previous.phase !== segment.phase) {
      this.#emitEvent('phaseStarted', this.#describe({ phase: segment.phase, step: null }));
    }
    if (segment.step) this.#emitEvent('stepStarted', this.#describe(segment));
    this.#performTurnBasedActions(segment);
  }

  /** "At the beginning of your upkeep / combat / end step" (503.1, 507.1, 513.1): the active player's abilities trigger. */
  #triggerAtBeginningOf(type) {
    for (const permanent of [...this.#battlefield]) {
      // Sting: "At the beginning of each combat" (`eachTurn`) triggers on every player's turn.
      const yours = permanent.controllerId === this.#activePlayerId;
      this.#trigger(permanent, type, permanent.controllerId, (ability) => yours || ability.eachTurn);
    }
  }

  #performTurnBasedActions({ phase, step }) {
    const active = this.#activePlayerId;
    // 714.3b: as the precombat main phase begins, the active player puts a lore counter on each Saga they control.
    if (phase === PHASE.PRECOMBAT_MAIN && step === null) {
      for (const saga of this.#battlefield.filter((p) => p.controllerId === active && isSaga(p))) this.#addCounters(saga, COUNTER.LORE, 1);
    }
    switch (step) {
      case STEP.UPKEEP:
        this.#triggerAtBeginningOf(TRIGGER.UPKEEP);
        break;
      case STEP.BEGINNING_OF_COMBAT:
        this.#triggerAtBeginningOf(TRIGGER.BEGINNING_OF_COMBAT);
        break;
      case STEP.END:
        this.#triggerAtBeginningOf(TRIGGER.END_STEP);
        break;
      case STEP.END_OF_COMBAT: {
        // 603.7: delayed triggered abilities "at end of combat".
        const due = this.#delayedTriggers.filter((d) => d.at === 'endOfCombat');
        this.#delayedTriggers = this.#delayedTriggers.filter((d) => d.at !== 'endOfCombat');
        for (const delayed of due) {
          this.#queueTrigger({ id: 'delayed', text: delayed.text, effects: delayed.effects }, delayed);
        }
        break;
      }
      case STEP.UNTAP: {
        // 502.3: the active player untaps their permanents. Bewitching Leechcraft's creature only
        // untaps by removing a +1/+1 counter (614.1a).
        const untapped = this.#battlefield.filter((p) => p.controllerId === active && p.tapped).filter((p) => {
          if (!hasKeyword(p, KEYWORD.UNTAPS_BY_REMOVING_COUNTER)) return true;
          if (!(p.counters[COUNTER.PLUS_ONE] > 0)) return false;
          p.counters[COUNTER.PLUS_ONE] -= 1;
          return true;
        });
        untapped.forEach((p) => { p.tapped = false; });
        this.#applyContinuousEffects();
        if (untapped.length) {
          this.#emitEvent('permanentsUntapped', { playerId: active, cardIds: untapped.map((p) => p.id) });
        }
        break;
      }
      case STEP.DRAW:
        // 504.1: the active player draws a card.
        this.#drawCards(active, 1);
        break;
      case STEP.DECLARE_ATTACKERS:
        this.#beginDeclareAttackers();
        break;
      case STEP.DECLARE_BLOCKERS:
        this.#beginDeclareBlockers();
        break;
      case STEP.FIRST_STRIKE_DAMAGE:
      case STEP.COMBAT_DAMAGE:
        this.#beginCombatDamageStep();
        break;
      case STEP.CLEANUP: {
        // 514.1: the active player discards down to their maximum hand size.
        const excess = this.#zones.get(active).hand.length - MAX_HAND_SIZE;
        if (excess > 0) {
          this.#requireDecision({ type: DECISION.DISCARD_TO_HAND_SIZE, playerId: active, count: excess });
        }
        // 514.2: damage wears off, and "until end of turn" effects end, simultaneously.
        for (const permanent of this.#battlefield) {
          permanent.damage = 0;
          permanent.damagedByDeathtouch = false;
        }
        // Control "until end of turn" ends (Grishnákh).
        for (const effect of this.#temporaryEffects.filter((e) => e.revertControlTo && e.duration === 'endOfTurn')) {
          const permanent = this.#permanent(effect.targetId);
          if (permanent && permanent.controllerId !== effect.revertControlTo) {
            this.#setController(permanent, effect.revertControlTo);
            this.#emitEvent('controlChanged', { cardId: permanent.id, cardName: permanent.name, to: effect.revertControlTo, reverted: true });
          }
        }
        if (this.#temporaryEffects.some((e) => e.duration === 'endOfTurn')) {
          const ended = this.#temporaryEffects.filter((e) => e.duration === 'endOfTurn').map((e) => e.id);
          this.#temporaryEffects = this.#temporaryEffects.filter((e) => e.duration !== 'endOfTurn');
          this.#applyContinuousEffects();
          this.#emitEvent('temporaryEffectsEnded', { effectIds: ended });
        }
        break;
      }
    }
  }

  #leaveSegment(current, next) {
    this.#priorityPlayerId = null;
    // 500.4: mana empties from each player's mana pool as each step and phase ends.
    const emptied = [];
    for (const [playerId, zone] of this.#zones) {
      if (manaPoolTotal(zone.manaPool) === 0 && zone.specialMana.length === 0) continue;
      emptied.push({ playerId, lost: zone.manaPool });
      zone.manaPool = emptyManaPool();
      zone.specialMana = [];
    }
    if (emptied.length) this.#emitEvent('manaPoolsEmptied', { pools: emptied });
    // 511.3: creatures are removed from combat as the end of combat step ends.
    if (current.step === STEP.END_OF_COMBAT) this.#combat = emptyCombat();

    if (current.step) this.#emitEvent('stepEnded', this.#describe(current));
    if (!next || next.phase !== current.phase) {
      this.#emitEvent('phaseEnded', this.#describe({ phase: current.phase, step: null }));
    }
  }

  #describe({ phase, step }) {
    return {
      turn: this.#turn,
      activePlayerId: this.#activePlayerId,
      phase,
      phaseName: PHASE_NAMES[phase],
      step,
      stepName: step ? STEP_NAMES[step] : null,
    };
  }

  #nextPlayerId(playerId) {
    const index = this.#players.findIndex((p) => p.id === playerId);
    return this.#players[(index + 1) % this.#players.length].id;
  }

  // ---------------------------------------------------------------------------
  // Emission

  /** A copy of `value` for an event payload (nothing is emitted in silent mode, so no copy). */
  #forEvent(value) {
    return this.#silent ? value : structuredClone(value);
  }

  #emitEvent(name, data) {
    if (this.#silent) return;
    this.emit(name, { seq: ++this.#eventSeq, ...data });
  }

  #emitState() {
    this.#version += 1;
    if (!this.#silent) this.#emitEvent('state', this.getState());
  }
}
