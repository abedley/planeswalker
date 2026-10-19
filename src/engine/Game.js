import { EventEmitter } from './EventEmitter.js';
import { ACTION } from './actions.js';
import { TURN_STRUCTURE, PHASE, STEP, PHASE_NAMES, STEP_NAMES } from './turnStructure.js';
import { seededRandom, shuffle } from './random.js';
import {
  CARDS, DEFAULT_DECK, EFFECT, KEYWORD, ACTIVATION_TIMING, TARGET, AFFECTED, COUNTER, CARD_TYPE, SPELL_TARGETS, TRIGGER,
  isLand, isCreature, isAura, isEquipment, isInstant, isPermanentCard, isManaAbility, hasKeyword,
  abilityEffects, effectAffects, matchesPermanentKind, TOKENS, COLORS_OF_MANA, needsManaColor,
} from '../cards/cards.js';
import { EMBLEMS, DEFAULT_EMBLEMS } from '../cards/emblems.js';
import { emptyManaPool, addMana, planManaPayment, manaPoolTotal, MANA_TYPES } from './mana.js';

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
  /** A triggered ability with more than one legal target is being put on the stack (603.3d). */
  CHOOSE_TARGETS: 'chooseTargets',
});

export const STARTING_LIFE = 20; // 103.4
export const OPENING_HAND_SIZE = 7; // 103.5
export const MAX_HAND_SIZE = 7; // 402.2
export const LAND_PLAYS_PER_TURN = 1; // 305.2

const MAIN_PHASES = new Set([PHASE.PRECOMBAT_MAIN, PHASE.POSTCOMBAT_MAIN]);

/** Recursive structural equality for plain JSON-like values. */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => deepEqual(a[key], b[key]));
}

const emptyCombat = () => ({ declaredAttackers: [], attackers: [] });

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
  #version = 0;
  #eventSeq = 0;
  #queue = [];
  #processing = false;

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
   */
  constructor({
    players, startingPlayerId, decks = {}, seed, cards = {}, shuffleLibraries = true,
    emblems = {}, emblemDefinitions = {},
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
        life: STARTING_LIFE,
        landsPlayedThisTurn: 0,
        attemptedDrawFromEmptyLibrary: false,
        hasLost: false,
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
      this.#beginTurn(this.#startingPlayerId);
      this.#advance();
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

  getState() {
    const segment = this.#segment;
    return structuredClone({
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
      validActions: this.getValidActions(),
    });
  }

  // ---------------------------------------------------------------------------
  // Valid actions

  #priorityActions(holder) {
    const actions = [{ type: ACTION.PASS_PRIORITY, playerId: holder }];
    const hand = this.#zones.get(holder).hand;
    if (this.#canPlayLand(holder)) {
      for (const card of hand.filter(isLand)) {
        actions.push({ type: ACTION.PLAY_LAND, playerId: holder, cardId: card.id });
      }
    }
    const sorceryTiming = this.#hasSorceryTiming(holder);
    const pool = this.#zones.get(holder).manaPool;
    for (const card of hand.filter((c) => !isLand(c))) {
      // 304.1: instants can be cast whenever the player has priority. 307.1 / 301.1 /
      // 302.1 / 303.1: sorceries and permanent spells only at sorcery speed.
      if (!isInstant(card) && !sorceryTiming) continue;
      if (!planManaPayment(pool, card.manaCost)) continue;
      const definition = this.#cardDefinitions[card.cardId];
      const additionalCost = definition.additionalCost ?? {};
      if (!this.#canPayCost(holder, null, additionalCost)) continue;
      // 601.2c: a spell that targets needs a legal target; one action per legal target.
      // (303.4a: an Aura spell targets what it will enchant.)
      actions.push(...this.#withTargetsAndChoices(
        { type: ACTION.CAST_SPELL, playerId: holder, cardId: card.id },
        definition.enchant ?? definition.target,
        additionalCost,
        { excludeCardId: card.id, effects: definition.effects ?? [] },
      ));
    }
    // 602.2 / 605.3a: a player with priority may activate abilities of permanents
    // they control, and of their emblems, as long as they can pay the cost.
    const sources = [
      ...this.#battlefield.filter((p) => p.controllerId === holder),
      ...this.#zones.get(holder).emblems,
    ];
    for (const source of sources) {
      for (const ability of this.#abilitiesOf(source)) {
        if (!this.#canActivate(holder, source, ability)) continue;
        const attaches = abilityEffects(ability).some((e) => e.type === EFFECT.ATTACH);
        actions.push(...this.#withTargetsAndChoices(
          { type: ACTION.ACTIVATE_ABILITY, playerId: holder, cardId: source.id, abilityId: ability.id },
          ability.target,
          ability.cost,
          {
            // Something can't be attached to itself, and attaching to what it's
            // already attached to would do nothing (701.3b).
            excludeTargetId: attaches ? source.id : null,
            skipTarget: attaches ? (target) => source.attachedTo === target.id : null,
            effects: abilityEffects(ability),
          },
        ));
      }
    }
    return actions;
  }

  /**
   * One action per legal target (if the spell or ability targets), per way to
   * make the choices its cost needs, such as which creature to sacrifice
   * (601.2b-c), and per mana color for "add one mana of any color".
   */
  #withTargetsAndChoices(base, targetKind, cost, {
    excludeTargetId = null, skipTarget = null, excludeCardId = null, effects = [],
  } = {}) {
    const targetOptions = targetKind
      ? this.#legalTargets(targetKind, base.playerId, excludeTargetId)
        .filter((target) => !skipTarget?.(target))
        .map((target) => ({ targets: [target.id] }))
      : [{}];
    const choiceOptions = this.#costChoiceOptions(base.playerId, cost, excludeCardId)
      .map((costChoices) => (costChoices ? { costChoices } : {}));
    // The color is a choice made on resolution, but a mana ability resolves at once (605.3b), so
    // it's made with the action. Spells that add any color are rare enough to work the same way.
    const colorOptions = needsManaColor(effects) ? COLORS_OF_MANA.map((manaColor) => ({ manaColor })) : [{}];
    return targetOptions.flatMap((target) => choiceOptions.flatMap((choices) => (
      colorOptions.map((color) => ({ ...base, ...target, ...choices, ...color }))
    )));
  }

  /**
   * Every way to make the choices a cost needs, as `{ sacrifice?: [id], discard?: [id] }`
   * objects, or `[null]` when it needs none. `excludeCardId` is a spell being cast,
   * which is no longer in its owner's hand when costs are paid (601.2a).
   */
  #costChoiceOptions(playerId, cost = {}, excludeCardId = null) {
    let options = [{}];
    if (cost.sacrifice) {
      const candidates = this.#battlefield
        .filter((p) => p.controllerId === playerId && matchesPermanentKind(p, cost.sacrifice, playerId));
      options = options.flatMap((o) => candidates.map((p) => ({ ...o, sacrifice: [p.id] })));
    }
    if (cost.discard) {
      const cards = this.#zones.get(playerId).hand.filter((c) => c.id !== excludeCardId).map((c) => c.id);
      options = options.flatMap((o) => combinations(cards, cost.discard).map((ids) => ({ ...o, discard: ids })));
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
          ...this.#eligibleAttackers(playerId)
            .map((creature) => ({ type: ACTION.TOGGLE_ATTACKER, playerId, cardId: creature.id })),
          { type: ACTION.CONFIRM_ATTACKERS, playerId },
        ];
      case DECISION.DECLARE_BLOCKERS: {
        const actions = [];
        for (const blocker of this.#eligibleBlockers(playerId)) {
          const current = decision.blocks[blocker.id] ?? null;
          for (const { cardId: attackerId } of this.#combat.attackers) {
            if (attackerId !== current && this.#canBlock(blocker, this.#permanent(attackerId))) {
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
        return this.#legalTargets(decision.targetKind, playerId, null)
          .map((target) => ({ type: ACTION.CHOOSE_TARGETS, playerId, targets: [target.id] }));
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

  #process(action) {
    const reason = this.#validate(action);
    if (reason) {
      this.#emitEvent('actionRejected', { action, reason });
      return { ok: false, reason };
    }
    this.#emitEvent('actionAccepted', { action });
    const { playerId, cardId } = action;
    switch (action.type) {
      case ACTION.PASS_PRIORITY: this.#passPriority(playerId); break;
      case ACTION.PLAY_LAND: this.#playLand(playerId, cardId); break;
      case ACTION.CAST_SPELL:
        this.#castSpell(playerId, cardId, action.targets, action.costChoices, action.manaColor);
        break;
      case ACTION.ACTIVATE_ABILITY:
        this.#activateAbility(playerId, cardId, action.abilityId, action.targets, action.costChoices, action.manaColor);
        break;
      case ACTION.TOGGLE_ATTACKER: this.#toggleAttacker(cardId); break;
      case ACTION.CONFIRM_ATTACKERS: this.#confirmAttackers(); break;
      case ACTION.SET_BLOCKER: this.#setBlocker(cardId, action.attackerId); break;
      case ACTION.CONFIRM_BLOCKERS: this.#confirmBlockers(); break;
      case ACTION.ASSIGN_COMBAT_DAMAGE: this.#assignCombatDamage(action.assignment); break;
      case ACTION.DISCARD: this.#discardToHandSize(playerId, cardId); break;
      case ACTION.CHOOSE_TARGETS: this.#chooseTriggerTargets(action.targets); break;
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
        })),
      } : {}),
      abilities: (definition.abilities ?? []).map(({ id, text, ...ability }) => ({
        id,
        text,
        isManaAbility: isManaAbility(ability),
        cost: structuredClone(ability.cost),
        effects: structuredClone(abilityEffects(ability)),
        timing: ability.timing ?? ACTIVATION_TIMING.INSTANT,
        target: ability.target ?? null,
      })),
      keywords: [...(definition.keywords ?? [])],
      text: definition.text ?? definition.oracleText ?? '',
      ownerId,
    };
    if (!isPermanentCard(definition)) {
      card.spell = { target: definition.target ?? null, effects: structuredClone(definition.effects ?? []) };
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
  #createToken(token, controllerId) {
    const cardId = typeof token === 'string' ? this.#predefinedTokenId(token) : this.#creatureTokenId(token);
    // 111.2: the player who creates a token is its owner.
    const card = this.#createCard(cardId, controllerId, `${controllerId}-token-${this.#nextTokenNumber++}`);
    return this.#putOntoBattlefield(card, controllerId);
  }

  #predefinedTokenId(name) {
    const definition = TOKENS[name];
    if (!definition) throw new Error(`Unknown token: ${name}`);
    const cardId = `token:${name}`;
    this.#cardDefinitions[cardId] ??= { ...structuredClone(definition), id: cardId, colors: [], token: true };
    return cardId;
  }

  #creatureTokenId(token) {
    const name = token.name ?? `${(token.subtypes ?? []).join(' ')} Token`.trim();
    const keywords = token.keywords ?? [];
    const colors = token.colors ?? [];
    const cardId = `token:${name}:${token.power}/${token.toughness}:${colors.join(',')}:${keywords.join(',')}`;
    const keywordText = keywords.length ? ` with ${keywords.join(', ')}` : '';
    this.#cardDefinitions[cardId] ??= {
      id: cardId,
      name,
      types: [CARD_TYPE.CREATURE],
      subtypes: [...(token.subtypes ?? [])],
      power: token.power,
      toughness: token.toughness,
      keywords: [...keywords],
      colors: [...colors],
      token: true,
      text: `${token.power}/${token.toughness} ${[...colors, ...(token.subtypes ?? [])].join(' ')} creature token${keywordText}`,
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

  /** Activated ability definitions of a permanent or an emblem. */
  #abilitiesOf(source) {
    if (source.emblemId) return this.#emblemDefinitions[source.emblemId].abilities;
    return this.#cardDefinitions[source.cardId].abilities ?? [];
  }

  /** A permanent or an emblem, by id. */
  #findSource(id) {
    return this.#permanent(id)
      ?? [...this.#zones.values()].flatMap((zone) => zone.emblems).find((e) => e.id === id)
      ?? null;
  }

  #permanent(id) {
    return this.#battlefield.find((p) => p.id === id) ?? null;
  }

  #putOntoBattlefield(card, controllerId) {
    const permanent = {
      ...card,
      controllerId,
      tapped: false,
      summoningSick: true,
      damage: 0,
      damagedByDeathtouch: false,
      attachedTo: null,
      counters: {},
      // Printed values; power, toughness and keywords are recalculated from these (613).
      base: { power: card.power, toughness: card.toughness, keywords: [...card.keywords] },
    };
    this.#battlefield.push(permanent);
    this.#applyContinuousEffects();
    // 603.6a: "When this enters" triggers.
    this.#trigger(permanent, TRIGGER.ENTERS_BATTLEFIELD, controllerId);
    return permanent;
  }

  /** Moves a permanent to its owner's graveyard. */
  #putIntoGraveyard(permanent) {
    this.#moveFromBattlefield(permanent, 'graveyard');
  }

  /**
   * Moves a permanent to one of its owner's zones ('graveyard', 'hand' or 'exile'),
   * stripping battlefield-only state.
   */
  #moveFromBattlefield(permanent, zoneName) {
    this.#battlefield.splice(this.#battlefield.indexOf(permanent), 1);
    // 700.4: a creature dies when it's put into a graveyard from the battlefield. Leaves-the-
    // battlefield abilities "look back in time" (603.10a), so this uses the permanent as it was.
    if (zoneName === 'graveyard' && isCreature(permanent)) this.#trigger(permanent, TRIGGER.DIES, permanent.controllerId);
    const {
      controllerId, tapped, summoningSick, damage, damagedByDeathtouch, attachedTo, counters, base, ...card
    } = permanent;
    // 400.7: it becomes a new object with its printed characteristics.
    Object.assign(card, base.power === undefined ? { keywords: base.keywords } : base);
    // 111.7 / 704.5d: a token that leaves the battlefield ceases to exist, so it isn't kept anywhere.
    if (!card.token) this.#zones.get(card.ownerId)[zoneName].push(card);
    // 400.7: effects that applied to it don't follow it.
    this.#temporaryEffects = this.#temporaryEffects.filter((e) => e.targetId !== permanent.id);
    this.#applyContinuousEffects();
    // 506.4: a permanent that leaves the battlefield is removed from combat.
    this.#combat.attackers = this.#combat.attackers.filter((a) => a.cardId !== permanent.id);
    for (const attacker of this.#combat.attackers) {
      attacker.blockerIds = attacker.blockerIds.filter((id) => id !== permanent.id);
    }
  }

  #drawCards(playerId, count) {
    const zone = this.#zones.get(playerId);
    const drawn = [];
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
    }
    if (drawn.length) {
      this.#emitEvent('cardsDrawn', { playerId, cardIds: drawn, librarySize: zone.library.length });
    }
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
    this.#emitEvent('landPlayed', { playerId, card: structuredClone(permanent) });

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
  // Spells, activated abilities and the stack (Comprehensive Rules 601, 602, 605, 608)

  #payMana(playerId, cost) {
    const pool = this.#zones.get(playerId).manaPool;
    const payment = planManaPayment(pool, cost);
    for (const type of MANA_TYPES) pool[type] -= payment[type];
    return payment;
  }

  #castSpell(playerId, cardId, targets, costChoices, manaColor) {
    // 601.2a: the card moves from hand to the stack; 601.2h: its cost is paid.
    // (Mana must already be in the pool; activating mana abilities mid-cast isn't modelled.)
    const zone = this.#zones.get(playerId);
    const [card] = zone.hand.splice(zone.hand.findIndex((c) => c.id === cardId), 1);
    const additionalCost = this.#cardDefinitions[card.cardId].additionalCost;
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
    };
    this.#stack.push(stackObject);
    const manaPaid = this.#payMana(playerId, card.manaCost);
    // 601.2f: additional costs, such as sacrificing a creature, are part of the total cost.
    const additionalCostPaid = additionalCost ? this.#payCost(playerId, null, additionalCost, costChoices) : null;
    this.#emitEvent('spellCast', {
      playerId,
      cardId,
      cardName: card.name,
      manaPaid,
      ...(additionalCostPaid ? { additionalCostPaid } : {}),
      stackObjectId: stackObject.id,
      targets: targets ?? [],
    });
    // 117.3c: the caster receives priority.
    this.#resetPasses();
    this.#givePriority(playerId);
  }

  #canActivate(playerId, source, ability) {
    if (ability.timing === ACTIVATION_TIMING.SORCERY && !this.#hasSorceryTiming(playerId)) return false;
    // Like 606.3 for loyalty abilities: a limited number of activations per emblem each turn.
    if (source.emblemId && source.activationsThisTurn >= source.activationsPerTurn) return false;
    return this.#canPayCost(playerId, source, ability.cost);
  }

  /** `permanent` is the ability's source: a permanent, an emblem, or null for a spell's cost. */
  #canPayCost(playerId, permanent, cost) {
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
    if (cost.mana && !planManaPayment(this.#zones.get(playerId).manaPool, cost.mana)) return false;
    // Choices such as which creature to sacrifice are checked by #costChoiceOptions.
    return true;
  }

  /** 601.2h / 602.2b: pay the cost, with the choices it needs. Returns what was paid. */
  #payCost(playerId, permanent, cost, choices = {}) {
    const paid = {};
    if (cost.tap) {
      permanent.tapped = true;
      paid.tap = true;
    }
    if (cost.mana) paid.mana = this.#payMana(playerId, cost.mana);
    if (cost.life) {
      this.#zones.get(playerId).life -= cost.life;
      paid.life = cost.life;
    }
    const sacrificed = [
      ...(cost.sacrificeSelf ? [permanent] : []),
      ...(choices.sacrifice ?? []).map((id) => this.#permanent(id)),
    ];
    for (const sacrifice of sacrificed) {
      // 701.17a: move it from the battlefield to its owner's graveyard.
      this.#putIntoGraveyard(sacrifice);
      this.#emitEvent('permanentSacrificed', {
        cardId: sacrifice.id, cardName: sacrifice.name, controllerId: playerId,
      });
    }
    if (sacrificed.length) paid.sacrificed = sacrificed.map((p) => p.id);
    if (choices.discard?.length) {
      const zone = this.#zones.get(playerId);
      for (const id of choices.discard) {
        zone.graveyard.push(...zone.hand.splice(zone.hand.findIndex((c) => c.id === id), 1));
        this.#emitEvent('cardDiscarded', { playerId, cardId: id });
      }
      paid.discarded = [...choices.discard];
    }
    return paid;
  }

  #activateAbility(playerId, cardId, abilityId, targets, costChoices, manaColor) {
    const permanent = this.#findSource(cardId);
    const ability = this.#abilitiesOf(permanent).find((a) => a.id === abilityId);
    const costPaid = this.#payCost(playerId, permanent, ability.cost, costChoices);
    if (permanent.emblemId) permanent.activationsThisTurn += 1;
    const activation = {
      playerId, cardId, cardName: permanent.name, abilityId, text: ability.text, costPaid,
    };
    this.#resetPasses();

    if (isManaAbility(ability)) {
      // 605.3b: a mana ability doesn't use the stack; it resolves immediately and
      // the player keeps priority.
      this.#emitEvent('abilityActivated', { ...activation, usesStack: false });
      for (const effect of abilityEffects(ability)) this.#applyEffect(effect, playerId, { sourceId: cardId, manaColor });
      return;
    }

    // 602.2a: the ability goes on the stack, then (602.2b) its costs are paid.
    const stackObject = {
      id: `s${this.#nextStackObjectId++}`,
      kind: 'activatedAbility',
      controllerId: playerId,
      sourceId: cardId,
      sourceName: permanent.name,
      abilityId,
      text: ability.text,
      effects: structuredClone(abilityEffects(ability)),
      ...(targets ? { targets: [...targets], targetKind: ability.target } : {}),
      ...(manaColor ? { manaColor } : {}),
    };
    this.#stack.push(stackObject);
    this.#emitEvent('abilityActivated', {
      ...activation, usesStack: true, stackObjectId: stackObject.id, targets: targets ?? [],
    });
    // 117.3c: the player who activated the ability receives priority.
    this.#givePriority(playerId);
  }

  #resolveTopOfStack() {
    // 608.2: the top object resolves.
    const stackObject = this.#stack.pop();
    this.#emitEvent('stackObjectResolving', { stackObject: structuredClone(stackObject) });
    const { controllerId, targets = [] } = stackObject;
    const definition = stackObject.kind === 'spell' ? this.#cardDefinitions[stackObject.card.cardId] : null;
    const targetKind = stackObject.targetKind ?? definition?.enchant ?? definition?.target ?? null;
    const effects = definition ? definition.effects ?? [] : stackObject.effects;
    const excludeId = effects.some((e) => e.type === EFFECT.ATTACH) ? stackObject.sourceId : null;
    const legalTargets = targets.filter((id) => this.#isLegalTarget(targetKind, id, controllerId, excludeId));
    const context = { sourceId: stackObject.sourceId, targets: legalTargets, manaColor: stackObject.manaColor };

    if (targets.length > 0 && legalTargets.length === 0) {
      // 608.2b: with every target illegal, it doesn't resolve. A spell goes to its owner's graveyard.
      if (stackObject.kind === 'spell') this.#zones.get(stackObject.card.ownerId).graveyard.push(stackObject.card);
      this.#emitEvent('stackObjectFizzled', { stackObjectId: stackObject.id, reason: 'All targets are illegal.' });
    } else if (stackObject.kind === 'spell' && !isPermanentCard(stackObject.card)) {
      // 608.2c: an instant or sorcery's effects happen in order...
      for (const effect of effects) this.#applyEffect(effect, controllerId, context);
      // 608.2n: ...then it goes to its owner's graveyard.
      this.#zones.get(stackObject.card.ownerId).graveyard.push(stackObject.card);
    } else if (stackObject.kind === 'spell') {
      // 608.3: a permanent spell enters the battlefield under its controller's control.
      const permanent = this.#putOntoBattlefield(stackObject.card, controllerId);
      // 303.4f: an Aura spell enters attached to the object it targeted.
      if (isAura(permanent)) this.#attach(permanent, legalTargets[0]);
      this.#emitEvent('permanentEntered', { playerId: controllerId, card: structuredClone(permanent) });
    } else {
      for (const effect of effects) this.#applyEffect(effect, controllerId, context);
    }
    this.#emitEvent('stackObjectResolved', { stackObjectId: stackObject.id });
    // 117.3b: after resolution, the active player receives priority.
    this.#resetPasses();
    this.#givePriority(this.#activePlayerId);
  }

  /**
   * The ids of whatever an effect applies to: players, permanents or (for
   * countering) stack objects. Only legal targets reach here (608.2b).
   */
  #affectedBy(effect, controllerId, sourceId, targets) {
    const livePlayers = this.#players.map((p) => p.id).filter((id) => !this.#zones.get(id).hasLost);
    const creatures = this.#battlefield.filter(isCreature);
    switch (effectAffects(effect)) {
      case AFFECTED.TARGET: return targets;
      case AFFECTED.YOU: return [controllerId];
      case AFFECTED.EACH_OPPONENT: return livePlayers.filter((id) => id !== controllerId);
      case AFFECTED.EACH_PLAYER: return livePlayers;
      case AFFECTED.EACH_CREATURE: return creatures.map((p) => p.id);
      case AFFECTED.EACH_CREATURE_YOU_CONTROL:
        return creatures.filter((p) => p.controllerId === controllerId).map((p) => p.id);
      // 113.7a: if the source has left the battlefield, an effect on "this permanent" does nothing.
      case AFFECTED.SOURCE: return this.#permanent(sourceId) ? [sourceId] : [];
      default: throw new Error(`Unknown affected: ${effect.affected}`);
    }
  }

  #applyEffect(effect, controllerId, { sourceId, targets = [], manaColor } = {}) {
    const ids = this.#affectedBy(effect, controllerId, sourceId, targets);
    // Permanents still on the battlefield, and players, among what the effect applies to.
    const permanents = () => ids.map((id) => this.#permanent(id)).filter(Boolean);
    const players = ids.filter((id) => this.#zones.has(id));
    switch (effect.type) {
      case EFFECT.DEAL_DAMAGE:
        for (const id of ids) this.#dealDamage(sourceId, id, effect.amount);
        break;
      case EFFECT.DESTROY:
        for (const permanent of permanents()) {
          // 701.7a: move it from the battlefield to its owner's graveyard.
          this.#putIntoGraveyard(permanent);
          this.#emitEvent('permanentDestroyed', {
            cardId: permanent.id, cardName: permanent.name, controllerId: permanent.controllerId, sourceId,
          });
        }
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
          this.#emitEvent('permanentReturnedToHand', {
            cardId: permanent.id, cardName: permanent.name, ownerId: permanent.ownerId, sourceId,
          });
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
      case EFFECT.PUMP:
        for (const creature of permanents().filter(isCreature)) {
          // 611.2a: a continuous effect from a resolving spell or ability, here until end of turn.
          const temporary = {
            id: `e${this.#nextEffectId++}`,
            sourceId,
            targetId: creature.id,
            power: effect.power ?? 0,
            toughness: effect.toughness ?? 0,
            keywords: [...(effect.keywords ?? [])],
            duration: 'endOfTurn',
          };
          this.#temporaryEffects.push(temporary);
          this.#applyContinuousEffects();
          this.#emitEvent('temporaryEffectCreated', structuredClone(temporary));
        }
        break;
      case EFFECT.ADD_COUNTERS:
        for (const permanent of permanents()) {
          // 122.1: counters are markers placed on an object.
          const counter = effect.counter ?? COUNTER.PLUS_ONE;
          permanent.counters[counter] = (permanent.counters[counter] ?? 0) + (effect.count ?? 1);
          this.#applyContinuousEffects();
          this.#emitEvent('countersAdded', {
            cardId: permanent.id, counter, count: effect.count ?? 1, counters: { ...permanent.counters },
          });
        }
        break;
      case EFFECT.COUNTER_SPELL:
        for (const id of ids) {
          // 701.6a: a countered spell is removed from the stack and put into its owner's graveyard.
          const index = this.#stack.findIndex((s) => s.id === id);
          if (index === -1) continue;
          const [countered] = this.#stack.splice(index, 1);
          this.#zones.get(countered.card.ownerId).graveyard.push(countered.card);
          this.#emitEvent('spellCountered', {
            stackObjectId: id, cardId: countered.card.id, cardName: countered.card.name, sourceId,
          });
        }
        break;
      case EFFECT.ATTACH: {
        // 701.3a: attach the source to the target; nothing happens if the source has left.
        const source = this.#permanent(sourceId);
        if (source && source.controllerId === controllerId) this.#attach(source, targets[0]);
        break;
      }
      case EFFECT.ADD_MANA: {
        const mana = effect.mana ?? { [manaColor]: effect.anyColor };
        for (const playerId of players) {
          const pool = this.#zones.get(playerId).manaPool;
          addMana(pool, mana);
          this.#emitEvent('manaAdded', { playerId, mana: { ...mana }, manaPool: { ...pool } });
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
          zone.life -= effect.amount;
          this.#emitEvent('lifeLost', { playerId, amount: effect.amount, life: zone.life });
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
        for (const playerId of players) {
          for (let i = 0; i < (effect.count ?? 1); i++) {
            const token = this.#createToken(effect.token, playerId);
            this.#emitEvent('tokenCreated', { playerId, card: structuredClone(token), sourceId });
          }
        }
        break;
      default:
        throw new Error(`Unknown effect type: ${effect.type}`);
    }
  }

  #gainLife(playerId, amount) {
    const zone = this.#zones.get(playerId);
    zone.life += amount;
    this.#emitEvent('lifeGained', { playerId, amount, life: zone.life });
  }

  /** Noncombat damage from a spell or ability (120.3). */
  #dealDamage(sourceId, targetId, amount) {
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
      // 120.3e: damage to a creature is marked on it; state-based actions do the rest.
      target.damage += amount;
      if (source && hasKeyword(source, KEYWORD.DEATHTOUCH)) target.damagedByDeathtouch = true;
      this.#emitEvent('damageDealt', { sourceId, targetCardId: targetId, amount });
    }
    // 702.15b: damage dealt by a source with lifelink causes its controller to gain that much life.
    if (source && hasKeyword(source, KEYWORD.LIFELINK)) this.#gainLife(source.controllerId, amount);
  }

  // ---------------------------------------------------------------------------
  // Triggered abilities (Comprehensive Rules 603)

  /** 603.2: an event happened; any of the permanent's abilities that trigger on it trigger. */
  #trigger(permanent, type, controllerId) {
    for (const ability of this.#cardDefinitions[permanent.cardId].triggeredAbilities ?? []) {
      if (ability.trigger !== type) continue;
      const trigger = {
        id: `t${this.#nextTriggerId++}`,
        sourceId: permanent.id,
        sourceName: permanent.name,
        // 603.3a: the ability's controller is its source's controller when it triggered.
        controllerId,
        abilityId: ability.id,
        text: ability.text,
        trigger: type,
        effects: structuredClone(abilityEffects(ability)),
        targetKind: ability.target ?? null,
      };
      this.#pendingTriggers.push(trigger);
      this.#emitEvent('abilityTriggered', structuredClone(trigger));
    }
  }

  /** Players in APNAP order (101.4): the active player, then the others in turn order. */
  #apnapOrder() {
    const index = this.#players.findIndex((p) => p.id === this.#activePlayerId);
    return [...this.#players.slice(index), ...this.#players.slice(0, index)].map((p) => p.id);
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
      if (!trigger.targetKind) {
        this.#putTriggerOnStack(this.#pendingTriggers.shift(), null);
        continue;
      }
      const legal = this.#legalTargets(trigger.targetKind, trigger.controllerId, null);
      if (legal.length === 0) {
        // 603.3d: with no legal target, the ability is removed from the stack.
        this.#pendingTriggers.shift();
        this.#emitEvent('triggeredAbilityRemoved', { triggerId: trigger.id, sourceId: trigger.sourceId, reason: 'No legal targets.' });
        continue;
      }
      if (legal.length === 1) {
        this.#putTriggerOnStack(this.#pendingTriggers.shift(), [legal[0].id]);
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
        effects: structuredClone(trigger.effects),
        priorityPlayerId,
      });
      return true;
    }
    return false;
  }

  #putTriggerOnStack(trigger, targets) {
    const stackObject = {
      id: `s${this.#nextStackObjectId++}`,
      kind: 'triggeredAbility',
      controllerId: trigger.controllerId,
      sourceId: trigger.sourceId,
      sourceName: trigger.sourceName,
      abilityId: trigger.abilityId,
      text: trigger.text,
      effects: trigger.effects,
      ...(targets ? { targets: [...targets], targetKind: trigger.targetKind } : {}),
    };
    this.#stack.push(stackObject);
    this.#emitEvent('triggeredAbilityPutOnStack', {
      triggerId: trigger.id, stackObjectId: stackObject.id, sourceId: trigger.sourceId, targets: targets ?? [],
    });
  }

  #chooseTriggerTargets(targets) {
    const { priorityPlayerId } = this.#pendingDecision;
    this.#pendingDecision = null;
    this.#putTriggerOnStack(this.#pendingTriggers.shift(), targets);
    // Put any other triggered abilities on the stack, then give priority as was about to happen.
    this.#givePriority(priorityPlayerId);
  }

  // ---------------------------------------------------------------------------
  // Targets, attachments and continuous effects (Comprehensive Rules 115, 301.5, 303.4, 613)

  /** Whether `id` (a player, permanent or stack object) is a legal target of `kind`; `excludeId` never is. */
  #isLegalTarget(kind, id, controllerId, excludeId = null) {
    if (!Object.values(TARGET).includes(kind)) throw new Error(`Unknown target kind: ${kind}`);
    if (this.#zones.has(id)) {
      // 115.4: "any target" includes players. Players who have lost have left the game.
      if (this.#zones.get(id).hasLost) return false;
      return kind === TARGET.ANY || kind === TARGET.PLAYER || (kind === TARGET.OPPONENT && id !== controllerId);
    }
    const stackObject = this.#stack.find((s) => s.id === id);
    if (stackObject) {
      // 115.1a: "target spell" means a spell on the stack, not an ability.
      if (!SPELL_TARGETS.has(kind) || stackObject.kind !== 'spell') return false;
      if (kind === TARGET.CREATURE_SPELL) return isCreature(stackObject.card);
      if (kind === TARGET.NONCREATURE_SPELL) return !isCreature(stackObject.card);
      return true;
    }
    const permanent = this.#permanent(id);
    if (!permanent || id === excludeId) return false;
    return matchesPermanentKind(permanent, kind, controllerId);
  }

  /** Legal targets as `{ id }` objects: permanents, then players, then spells (top of the stack first). */
  #legalTargets(kind, controllerId, excludeId) {
    return [...this.#battlefield, ...this.#players, ...[...this.#stack].reverse()]
      .filter((p) => this.#isLegalTarget(kind, p.id, controllerId, excludeId));
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
   * 613: recalculates every permanent's power, toughness and keywords from its
   * printed values plus continuous effects. Only ability-adding (layer 6) and
   * power/toughness changes (layer 7c) exist so far, and those don't depend on
   * the order they're applied in.
   */
  #applyContinuousEffects() {
    for (const permanent of this.#battlefield) {
      permanent.keywords = [...permanent.base.keywords];
      if (permanent.base.power !== undefined) {
        permanent.power = permanent.base.power;
        permanent.toughness = permanent.base.toughness;
      }
    }
    for (const source of this.#battlefield) {
      for (const effect of this.#cardDefinitions[source.cardId].staticAbilities ?? []) {
        if (effect.affected !== AFFECTED.ATTACHED_PERMANENT || !source.attachedTo) continue;
        const host = this.#permanent(source.attachedTo);
        if (!host) continue;
        if (isCreature(host)) {
          host.power += effect.power ?? 0;
          host.toughness += effect.toughness ?? 0;
        }
        for (const keyword of effect.keywords ?? []) {
          if (!host.keywords.includes(keyword)) host.keywords.push(keyword);
        }
      }
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
    }
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
    // 508.1a: untapped creatures without summoning sickness. 702.3b: defender can't attack.
    return this.#battlefield.filter((p) => (
      p.controllerId === playerId && isCreature(p) && !p.tapped
      && !this.#hasSummoningSickness(p) && !hasKeyword(p, KEYWORD.DEFENDER)
    ));
  }

  #eligibleBlockers(playerId) {
    // 509.1a: untapped creatures the defending player controls.
    return this.#battlefield.filter((p) => p.controllerId === playerId && isCreature(p) && !p.tapped);
  }

  #canBlock(blocker, attacker) {
    // 702.9b: a creature with flying can't be blocked except by creatures with flying or reach (702.17b).
    if (hasKeyword(attacker, KEYWORD.FLYING)) {
      return hasKeyword(blocker, KEYWORD.FLYING) || hasKeyword(blocker, KEYWORD.REACH);
    }
    return true;
  }

  #blocksAreLegal(blocks) {
    // 702.111b: a creature with menace can't be blocked except by two or more creatures.
    return this.#combat.attackers.every(({ cardId }) => {
      if (!hasKeyword(this.#permanent(cardId), KEYWORD.MENACE)) return true;
      const blockers = Object.values(blocks).filter((attackerId) => attackerId === cardId).length;
      return blockers !== 1;
    });
  }

  #beginDeclareAttackers() {
    // 508.1: the active player declares attackers (a turn-based action).
    const playerId = this.#activePlayerId;
    if (this.#eligibleAttackers(playerId).length === 0) {
      this.#emitEvent('attackersDeclared', { playerId, attackers: [], defendingPlayerId: this.#defendingPlayerId() });
      return;
    }
    this.#requireDecision({ type: DECISION.DECLARE_ATTACKERS, playerId, attackers: [] });
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
  #damageAssignmentOptions(attacker) {
    const creature = this.#permanent(attacker.cardId);
    const power = creature.power;
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
        power: creature.power,
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
        if (blocker.power > 0 && this.#dealsDamageThisStep(blocker)) {
          damage.push({ sourceId: blocker.id, targetCardId: creature.id, amount: blocker.power });
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
        if (hasKeyword(source, KEYWORD.DEATHTOUCH)) target.damagedByDeathtouch = true;
      }
      // 702.15b: damage dealt by a source with lifelink causes its controller to gain that much life.
      if (hasKeyword(source, KEYWORD.LIFELINK)) {
        lifeGained[source.controllerId] = (lifeGained[source.controllerId] ?? 0) + amount;
      }
    }
    for (const [playerId, amount] of Object.entries(lifeGained)) this.#zones.get(playerId).life += amount;

    this.#emitEvent('combatDamageDealt', {
      step: this.#segment.step,
      damage,
      lifeGained,
      life: Object.fromEntries([...this.#zones].map(([id, zone]) => [id, zone.life])),
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
      // 704.5f: toughness 0 or less; 704.5g: lethal damage; 704.5h: damage from a deathtouch source.
      const dying = this.#battlefield.filter((p) => isCreature(p) && (
        p.toughness <= 0 || p.damage >= p.toughness || (p.damage > 0 && p.damagedByDeathtouch)
      ));
      // 704.5m: an Aura attached to an illegal object, or to nothing, goes to its owner's graveyard.
      const fallenAuras = this.#battlefield.filter((p) => isAura(p) && !dying.includes(p) && !this.#isLegallyAttached(p));
      // 704.5n: Equipment attached to an illegal permanent becomes unattached.
      const looseEquipment = this.#battlefield.filter((p) => (
        isEquipment(p) && p.attachedTo && !dying.includes(p) && !this.#isLegallyAttached(p)
      ));
      if (losers.length === 0 && dying.length === 0 && fallenAuras.length === 0 && looseEquipment.length === 0) {
        return false;
      }

      for (const equipment of looseEquipment) this.#unattach(equipment);
      for (const aura of fallenAuras) {
        this.#putIntoGraveyard(aura);
        this.#emitEvent('permanentToGraveyard', {
          cardId: aura.id, cardName: aura.name, controllerId: aura.controllerId, reason: 'auraNotLegallyAttached',
        });
      }

      // 704.3: all applicable state-based actions happen simultaneously.
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
    this.#emitEvent('decisionRequired', structuredClone(decision));
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

  #beginTurn(activePlayerId) {
    this.#turn += 1;
    this.#activePlayerId = activePlayerId;
    this.#segmentIndex = -1;
    this.#combat = emptyCombat();
    for (const zone of this.#zones.values()) {
      zone.landsPlayedThisTurn = 0;
      for (const emblem of zone.emblems) emblem.activationsThisTurn = 0;
    }
    // 302.6: the active player has now controlled their permanents since the turn began.
    for (const permanent of this.#battlefield) {
      if (permanent.controllerId === activePlayerId) permanent.summoningSick = false;
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

  #performTurnBasedActions({ step }) {
    const active = this.#activePlayerId;
    switch (step) {
      case STEP.UNTAP: {
        // 502.3: the active player untaps their permanents.
        const untapped = this.#battlefield.filter((p) => p.controllerId === active && p.tapped);
        untapped.forEach((p) => { p.tapped = false; });
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
        if (this.#temporaryEffects.length) {
          const ended = this.#temporaryEffects.map((e) => e.id);
          this.#temporaryEffects = [];
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
      if (manaPoolTotal(zone.manaPool) === 0) continue;
      emptied.push({ playerId, lost: zone.manaPool });
      zone.manaPool = emptyManaPool();
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

  #emitEvent(name, data) {
    this.emit(name, { seq: ++this.#eventSeq, ...data });
  }

  #emitState() {
    this.#version += 1;
    this.#emitEvent('state', this.getState());
  }
}
