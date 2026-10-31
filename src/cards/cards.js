/**
 * Card definitions, keyed by card id. A card in a game is an instance that points
 * back to its definition through `cardId`.
 *
 * - `manaCost`: `{ G: 1, generic: 2, ... }` (lands have none)
 * - `power` / `toughness`: creatures only
 * - `keywords`: keyword abilities from KEYWORD, e.g. `['flying', 'lifelink']`
 * - `abilities`: activated abilities (602), written as `{ id, text, cost, effects }`
 *   (or `effect` for a single effect)
 *   - `cost`: any of
 *     - `tap: true` ({T})
 *     - `mana: { G: 1, generic: 2, ... }`
 *     - `life: n` (paying life, 119.4)
 *     - `sacrificeSelf: true` ("Sacrifice this creature")
 *     - `sacrifice: kind`, where kind is a TARGET permanent kind ("Sacrifice a creature")
 *     - `discard: n` ("Discard a card")
 *   - `effects`: see EFFECT, applied in order on resolution (608.2c)
 *   - `timing`: `'sorcery'` to allow activation only at sorcery speed (default: any time with priority)
 *   - `target`: a TARGET kind, for abilities that target (e.g. equip)
 * - `triggeredAbilities` (603): `{ id, text, trigger, effects, target? }`, where
 *   `trigger` is a TRIGGER value. Effects and targets work as for activated abilities.
 * - `enchant`: for Auras, the TARGET kind the Aura can enchant (303.4a)
 * - Instants and sorceries: `effects` (applied in order on resolution) and an
 *   optional `target` (a TARGET kind) that effects such as damage use
 * - `additionalCost`: a cost (same format as an ability's) paid on top of the mana
 *   cost to cast the spell (601.2f), e.g. `{ sacrifice: 'creature' }`
 *
 * Each effect applies to whatever its `affected` field (an AFFECTED value) says;
 * when it's missing, effects in TARGETED_EFFECTS apply to the target and the rest
 * to the controller ("you").
 * - `staticAbilities`: continuous effects, e.g. an Aura's or Equipment's
 *   `{ affected: 'attachedPermanent', power: 2, toughness: 0, keywords: ['flying'] }`
 * - `text`: rules text, for display
 */
import { IMPORTED_CARDS } from './importedCards.js';

export const CARD_TYPE = Object.freeze({
  LAND: 'Land',
  CREATURE: 'Creature',
  ARTIFACT: 'Artifact',
  ENCHANTMENT: 'Enchantment',
  INSTANT: 'Instant',
  SORCERY: 'Sorcery',
});

export const SUBTYPE = Object.freeze({
  AURA: 'Aura', // 303.4
  EQUIPMENT: 'Equipment', // 301.5
});

/**
 * What a spell or ability can target (115). The permanent kinds also say what a
 * "Sacrifice a ..." cost accepts.
 */
export const TARGET = Object.freeze({
  // Permanents
  CREATURE: 'creature',
  CREATURE_YOU_CONTROL: 'creatureYouControl',
  CREATURE_OPPONENT_CONTROLS: 'creatureOpponentControls',
  /** A creature in combat: "target attacking creature", "target attacking or blocking creature". */
  ATTACKING_CREATURE: 'attackingCreature',
  ATTACKING_OR_BLOCKING_CREATURE: 'attackingOrBlockingCreature',
  ARTIFACT: 'artifact',
  ENCHANTMENT: 'enchantment',
  ARTIFACT_OR_ENCHANTMENT: 'artifactOrEnchantment',
  LAND: 'land',
  NONLAND_PERMANENT: 'nonlandPermanent',
  PERMANENT: 'permanent',
  // Players
  PLAYER: 'player',
  OPPONENT: 'opponent',
  /** A creature or a player (115.4; there are no planeswalkers or battles here). */
  ANY: 'any',
  // Spells on the stack (115.1a)
  SPELL: 'spell',
  CREATURE_SPELL: 'creatureSpell',
  NONCREATURE_SPELL: 'noncreatureSpell',
  /** "target Elf you control". */
  ELF_YOU_CONTROL: 'elfYouControl',
  /** A card in a graveyard (115.1): "target permanent card from your graveyard". */
  PERMANENT_CARD_IN_YOUR_GRAVEYARD: 'permanentCardInYourGraveyard',
  /** Any card in your graveyard, usually narrowed by a filter: "target creature card from your graveyard". */
  CARD_IN_YOUR_GRAVEYARD: 'cardInYourGraveyard',
  /** A card in an opponent's graveyard (Lobelia Sackville-Baggins). */
  CARD_IN_OPPONENT_GRAVEYARD: 'cardInOpponentGraveyard',
  /** "target spell or nonland permanent" (Press the Enemy), usually with a controller filter. */
  SPELL_OR_NONLAND_PERMANENT: 'spellOrNonlandPermanent',
});

/**
 * A target can be a TARGET kind, or a spec narrowing one:
 * `{ kind, filter?, optional?, other? }`, where `filter` is a matchesFilter filter
 * ("target nonlegendary creature", "target creature with power X"), `optional` makes it
 * "up to one" (a spell or ability may be given `null` in its place), and `other` keeps
 * the source out ("another target creature").
 */
export const targetKindOf = (spec) => (spec && typeof spec === 'object' ? spec.kind : spec);
export const targetFilterOf = (spec) => (spec && typeof spec === 'object' ? spec.filter ?? null : null);
export const isOptionalTarget = (spec) => Boolean(spec && typeof spec === 'object' && spec.optional);
/** The target kinds of a card or ability's `target` or `targets`, as a list ([] when it doesn't target). */
export const targetList = (holder) => (holder?.targets ?? (holder?.target ? [holder.target] : []));
/** Graveyard target kinds pick cards in a graveyard, not permanents or players. */
export const GRAVEYARD_TARGETS = Object.freeze(new Set([TARGET.PERMANENT_CARD_IN_YOUR_GRAVEYARD, TARGET.CARD_IN_YOUR_GRAVEYARD, TARGET.CARD_IN_OPPONENT_GRAVEYARD]));

/** Who or what a static ability or an effect applies to. */
export const AFFECTED = Object.freeze({
  /** The permanent this one is attached to: "enchanted creature", "equipped creature". */
  ATTACHED_PERMANENT: 'attachedPermanent',
  /** The spell's or ability's target. */
  TARGET: 'target',
  /** The spell's or ability's controller. */
  YOU: 'you',
  EACH_OPPONENT: 'eachOpponent',
  EACH_PLAYER: 'eachPlayer',
  EACH_CREATURE: 'eachCreature',
  /**
   * For spells and abilities, each creature you control. As a static ability (an
   * anthem: "Creatures you control get +1/+1.", 613.1), it can be narrowed with
   * `other: true` ("Other creatures"), `colors: ['W']` ("White creatures") and
   * `subtypes: ['Soldier']` ("Soldier creatures").
   */
  EACH_CREATURE_YOU_CONTROL: 'eachCreatureYouControl',
  EACH_CREATURE_OPPONENTS_CONTROL: 'eachCreatureOpponentsControl',
  /** The ability's source, the permanent itself ("this creature"). */
  SOURCE: 'source',
  /** The controller of the target (`targetIndex`, default 0) as it last was: "Its controller loses 2 life." */
  TARGET_CONTROLLER: 'targetController',
  /** What the trigger was about: "destroy that creature", "sacrifice it" (its `subject`). */
  SUBJECT: 'subject',
  /** The controller of the trigger's subject: "deals 1 damage to that creature's controller". */
  SUBJECT_CONTROLLER: 'subjectController',
  /** The Army amass put counters on (701.47): "where X is the amassed Army's power". */
  AMASSED_ARMY: 'amassedArmy',
  /** Each creature blocking the source: "deals 1 damage to each creature blocking it". */
  CREATURES_BLOCKING_SOURCE: 'creaturesBlockingSource',
  /** You and the target player: "You and target opponent each create a Food token." */
  YOU_AND_TARGET: 'youAndTarget',
  /** The permanents sacrificed earlier in the same resolution. */
  SACRIFICED: 'sacrificed',
  /** The spell a "whenever a player casts" trigger is about: "counter that spell". */
  SUBJECT_SPELL: 'subjectSpell',
});

/** Kinds of counters (122). */
export const COUNTER = Object.freeze({
  PLUS_ONE: '+1/+1',
  /** On Sagas (714.2): one is added as it enters and in each precombat main phase. */
  LORE: 'lore',
  // Counters that only matter to the card that uses them (122.1).
  HOPE: 'hope',
  VERSE: 'verse',
  BURDEN: 'burden',
  INFLUENCE: 'influence',
  /** 122.1d: if a permanent with a stun counter would become untapped, one is removed from it instead. */
  STUN: 'stun',
  // 122.1b: keyword counters give the permanent that keyword.
  FIRST_STRIKE: 'first strike',
  VIGILANCE: 'vigilance',
  DEATHTOUCH: 'deathtouch',
  LIFELINK: 'lifelink',
  INDESTRUCTIBLE: 'indestructible',
});

/** 122.1b: counters that give their permanent the keyword of the same name. */
export const KEYWORD_COUNTERS = Object.freeze(new Set([COUNTER.FIRST_STRIKE, COUNTER.VIGILANCE, COUNTER.DEATHTOUCH, COUNTER.LIFELINK, COUNTER.INDESTRUCTIBLE]));

/** Keyword abilities (702). */
export const KEYWORD = Object.freeze({
  DEATHTOUCH: 'deathtouch', // 702.2
  DEFENDER: 'defender', // 702.3
  DOUBLE_STRIKE: 'double strike', // 702.4
  FIRST_STRIKE: 'first strike', // 702.7
  FLYING: 'flying', // 702.9
  HASTE: 'haste', // 702.10
  LIFELINK: 'lifelink', // 702.15
  REACH: 'reach', // 702.17
  TRAMPLE: 'trample', // 702.19
  VIGILANCE: 'vigilance', // 702.20
  MENACE: 'menace', // 702.111
  // Not keywords in the rules, but blocking restrictions (509.1b) written like them:
  // printed ("This creature can't block.") or for a turn ("Target creature can't block
  // this turn.", a PUMP that grants it).
  CANT_BLOCK: "can't block",
  CANT_BE_BLOCKED: "can't be blocked",
  /** 508.1c: "Enchanted creature can't attack or block." (Pacifism) grants this and CANT_BLOCK. */
  CANT_ATTACK: "can't attack",
  /** "This creature can't be blocked except by creatures with flying." (509.1b) */
  BLOCKED_ONLY_BY_FLYERS: "can't be blocked except by flyers",
  /** "This creature can't be blocked by creatures with power 2 or less." (509.1b) */
  CANT_BE_BLOCKED_BY_POWER_2_OR_LESS: "can't be blocked by power 2 or less",
  /** "This creature can't be blocked by more than one creature." (509.1b) */
  MAX_ONE_BLOCKER: "can't be blocked by more than one creature",
  /** Blocking requirements (509.1c): "This creature must be blocked if able." */
  MUST_BE_BLOCKED: 'must be blocked',
  /** "All creatures able to block this creature do so." (509.1c) */
  LURE: 'all creatures able to block it do so',
  /** 702.8: the spell can be cast any time its controller could cast an instant. */
  FLASH: 'flash',
  /** 702.12: not destroyed by lethal damage, deathtouch or "destroy" effects. */
  INDESTRUCTIBLE: 'indestructible',
  /** 702.11: can't be the target of spells or abilities its opponents control. */
  HEXPROOF: 'hexproof',
  /**
   * 702.21: whenever it becomes the target of a spell or ability an opponent controls,
   * counter that unless its controller pays the card's `ward` cost.
   */
  WARD: 'ward',
  /** "This creature can't be blocked except by three or more creatures." (509.1b) */
  MIN_THREE_BLOCKERS: "can't be blocked except by three or more creatures",
  /** The Ring, level 1 (701.54c): "can't be blocked by creatures with greater power". */
  CANT_BE_BLOCKED_BY_GREATER_POWER: "can't be blocked by creatures with greater power",
  /** "Assigns combat damage equal to its toughness rather than its power" (510.1a). */
  DAMAGE_BY_TOUGHNESS: 'assigns combat damage equal to its toughness',
  /**
   * Bewitching Leechcraft's "If this creature would untap during your untap step, remove a
   * +1/+1 counter from it instead. If you do, untap it."
   */
  UNTAPS_BY_REMOVING_COUNTER: 'untaps only by removing a +1/+1 counter',
  /** The Balrog: "can't be blocked except by legendary creatures" (509.1b). */
  BLOCKED_ONLY_BY_LEGENDARY: "can't be blocked except by legendary creatures",
  /** Goad (701.15b; two players): it attacks each combat if able. */
  MUST_ATTACK: 'attacks each combat if able',
});

/**
 * Keywords this game uses internally that a card's rules text never names on its own
 * (the importer must not accept them as keyword lines).
 */
export const INTERNAL_KEYWORDS = Object.freeze(new Set([
  KEYWORD.CANT_BE_BLOCKED_BY_GREATER_POWER, KEYWORD.DAMAGE_BY_TOUGHNESS, KEYWORD.UNTAPS_BY_REMOVING_COUNTER, KEYWORD.WARD,
  KEYWORD.MUST_ATTACK,
]));

export const EFFECT = Object.freeze({
  // Players
  /**
   * `{ mana }` (106.4), or `{ anyColor: n }` for "Add n mana of any one color". The
   * color is chosen when the spell or ability is cast or activated: its action
   * carries `manaColor`.
   */
  ADD_MANA: 'addMana',
  /** `{ count }` (121). */
  DRAW_CARDS: 'drawCards',
  /** `{ amount }` (119.3). */
  GAIN_LIFE: 'gainLife',
  /** `{ amount }` (119.3). */
  LOSE_LIFE: 'loseLife',
  /** `{ count }`: the top cards of the library go to the graveyard (701.13). */
  MILL: 'mill',
  /**
   * `{ count, token }`: tokens (111). `token` is a TOKEN name such as `'treasure'`,
   * or a creature token: `{ name?, colors?, subtypes?, power, toughness, keywords? }`.
   */
  CREATE_TOKEN: 'createToken',
  // Players or creatures
  /** `{ amount }` damage (120). */
  DEAL_DAMAGE: 'dealDamage',
  // Permanents
  /** Attach the ability's source to its target (701.3), e.g. equip. */
  ATTACH: 'attach',
  /** Destroy (701.7). */
  DESTROY: 'destroy',
  /** Exile (701.5). */
  EXILE: 'exile',
  /** Return to its owner's hand. */
  RETURN_TO_HAND: 'returnToHand',
  /** Tap (701.21). */
  TAP: 'tap',
  /** Untap (701.21). */
  UNTAP: 'untap',
  /** `{ power, toughness, keywords? }` for a creature until end of turn (611.2). */
  PUMP: 'pump',
  /** `{ counter, count }`: put counters on a permanent (122). */
  ADD_COUNTERS: 'addCounters',
  /**
   * 701.14: the first target fights the second: each deals damage equal to its power to
   * the other. Uses the spell's two `targets`.
   */
  FIGHT: 'fight',
  // Cards in graveyards
  /** Return the target card from a graveyard to its owner's hand. */
  RETURN_FROM_GRAVEYARD: 'returnFromGraveyard',
  // Spells
  /** Counter a spell (701.6). */
  COUNTER_SPELL: 'counterSpell',
  /** Return the target spell to its owner's hand (Reprieve). */
  RETURN_SPELL_TO_HAND: 'returnSpellToHand',

  // The Lord of the Rings: Tales of Middle-earth, and the rules it brings in
  /** 701.22: `{ count }`: look at the top cards of your library, put any on the bottom and the rest back in any order. */
  SCRY: 'scry',
  /** 701.54: the Ring tempts you: your Ring gains its next ability and you choose a Ring-bearer. */
  RING_TEMPTS: 'ringTempts',
  /** 701.47: `{ count, subtype }`: put +1/+1 counters on an Army you control (creating a 0/0 Orc Army first if you have none). */
  AMASS: 'amass',
  /** 701.8: `{ count }`: each affected player discards cards of their choice. */
  DISCARD: 'discard',
  /** "Target opponent reveals their hand. You choose a nonland card from it. That player discards that card." `{ filter }` */
  REVEAL_HAND_DISCARD: 'revealHandDiscard',
  /**
   * 701.19: `{ filter, count, destination: 'hand' | 'battlefield', tapped? }`: search your library for up to
   * `count` cards matching `filter`, put them there, then shuffle.
   */
  SEARCH_LIBRARY: 'searchLibrary',
  /** "Put a card from your hand on the bottom of your library." `{ count }` */
  PUT_FROM_HAND_ON_BOTTOM: 'putFromHandOnBottom',
  /**
   * `{ position }`: put the target (a permanent, or a card in a graveyard) into its owner's library,
   * `position` from the top (1 is the top).
   */
  PUT_INTO_LIBRARY: 'putIntoLibrary',
  /** `{ untilEndOfTurn? }`: gain control of the target (or, with `toTarget: n`, give it to that target player). */
  GAIN_CONTROL: 'gainControl',
  /** Exile the target, then return it to the battlefield under your control (a new object, 400.7). */
  FLICKER: 'flicker',
  /** "Exile target creature an opponent controls until this creature leaves the battlefield." (610.3c) */
  EXILE_UNTIL_SOURCE_LEAVES: 'exileUntilSourceLeaves',
  /**
   * 701.17: `{ count, filter }`: each affected player sacrifices permanents of their choice
   * matching `filter` (by default a creature).
   */
  SACRIFICE: 'sacrifice',
  /**
   * "You may <cost>. If you do, …": `{ options: [cost, ...] }`, costs as for activated
   * abilities. The player may pay one, or decline; later effects can check `{ paid: true }`.
   */
  OPTIONAL_COST: 'optionalCost',
  /** `{ cost }`: counter the target spell unless its controller pays `cost` (ward, 702.21a). */
  COUNTER_UNLESS_PAID: 'counterUnlessPaid',
  /**
   * `{ cost, otherwise: [effects] }`: the affected player may pay `cost`; if they don't, `otherwise`
   * happens ("exile this creature unless you pay 2 life").
   */
  UNLESS_PAID: 'unlessPaid',
  /** 603.12: "When you do, …": `{ ability: { effects, target? | targets? | modes? } }` triggers now. */
  REFLEXIVE_TRIGGER: 'reflexiveTrigger',
  /** `{ condition, then: [effects], else?: [effects] }`: "If …, …. Otherwise, …" (608.2c). */
  IF: 'if',
  /** `{ effects }`: "You may …": the controller chooses on resolution whether to do it. */
  MAY: 'may',
  /** Exile each card from the affected players' graveyards. */
  EXILE_GRAVEYARD: 'exileGraveyard',
  /** `{ zone: 'graveyard', filter }`: shuffle any number of cards from your graveyard into your library. */
  SHUFFLE_INTO_LIBRARY: 'shuffleIntoLibrary',
  /** 506.4: remove the affected creatures from combat. */
  REMOVE_FROM_COMBAT: 'removeFromCombat',
  /** Long List of the Ents: note a creature type; your next creature spell of it this turn enters with a +1/+1 counter. */
  NOTE_CREATURE_TYPE: 'noteCreatureType',
  /**
   * `{ filter, tapped?, attacking? }`: you may put a card matching `filter` from your hand onto the
   * battlefield (Shadowfax: "a creature card with lesser power … tapped and attacking").
   */
  PUT_FROM_HAND_ONTO_BATTLEFIELD: 'putFromHandOntoBattlefield',
  /** `{ to: 'hand' | 'battlefield', tapped? }`: the source card goes from your graveyard there (Gollum, Haunt of the Dead Marshes). */
  RETURN_SOURCE_FROM_GRAVEYARD: 'returnSourceFromGraveyard',
  /** The source, a card in a graveyard, is exiled (Council's Deliberation). */
  EXILE_SOURCE_FROM_GRAVEYARD: 'exileSourceFromGraveyard',
  /** Lembas: "its owner shuffles it into their library" (the source card, from the graveyard). */
  SHUFFLE_SOURCE_INTO_LIBRARY: 'shuffleSourceIntoLibrary',
  /** Crew (702.122): the source becomes an artifact creature until end of turn. */
  BECOME_CREATURE: 'becomeCreature',
  /** `{ at: 'endOfCombat', effects }`: a delayed triggered ability (603.7), with this resolution's targets and subject. */
  DELAYED_TRIGGER: 'delayedTrigger',
  /** "Damage can't be prevented this turn.": no damage is ever prevented in this game, so it does nothing. */
  NOTHING: 'nothing',
  /** "Reveal the top card of your library." Later effects can check `{ revealedMatches }`. */
  REVEAL_TOP: 'revealTop',
  /** `{ tapped?, attacking? }`: the card REVEAL_TOP revealed goes from the library onto the battlefield. */
  PUT_REVEALED_ONTO_BATTLEFIELD: 'putRevealedOntoBattlefield',
  /** `{ counter, count }`: remove counters from the affected permanents; later effects can check `{ paid: true }` ("If you do"). */
  REMOVE_COUNTERS: 'removeCounters',
  /**
   * `{ count, filter, max }`: look at the top `count` cards of your library; you may reveal up to `max`
   * matching `filter` and put them into your hand; the rest go on the bottom in a random order.
   */
  LOOK_AT_TOP: 'lookAtTop',
  /**
   * `{ filter, count, tapped?, rest: 'graveyard' | 'bottom' }`: the affected player reveals cards from the top of their
   * library until `count` cards matching `filter` are revealed; those go onto the battlefield (under your control),
   * the rest to `rest` (the bottom in a random order).
   */
  REVEAL_UNTIL: 'revealUntil',
  /** `{ keep }`: the affected player exiles cards of their choice from their hand until they have `keep` (Isildur's Fateful Strike). */
  EXILE_HAND_EXCESS: 'exileHandExcess',
  /** `{ keep }`: choose up to `keep` creatures, then destroy the rest (Mount Doom). */
  KEEP_AND_DESTROY_REST: 'keepAndDestroyRest',
  /** 701.15: goad the target: until your next turn, it attacks each combat if able. */
  GOAD: 'goad',
  /** `{ mode: 'eachKindNotOnSource' | 'chosen' }`: move counters between the target and the source (Goldberry). */
  MOVE_COUNTERS: 'moveCounters',
  /** Exile the target card from a graveyard. */
  EXILE_FROM_GRAVEYARD: 'exileFromGraveyard',
  /** The affected players lose the game (104.3e). */
  LOSE_GAME: 'loseGame',
  /** `{ flag }`: something that lasts the rest of the turn for you ('flashSpells': cast spells as though they had flash). */
  TURN_PERMISSION: 'turnPermission',
  /** Take an extra turn after this one (500.7). */
  EXTRA_TURN: 'extraTurn',
  /** After this combat phase, there is an additional combat phase (500.8). */
  EXTRA_COMBAT: 'extraCombat',
  /** `{ until: 'yourNextTurn' }`: you gain protection from everything (702.16j): damage to you is prevented and you can't be targeted. */
  PLAYER_PROTECTION: 'playerProtection',
  /**
   * `{ filter, maxManaValue? }`: you may cast a matching card from your hand without paying its mana cost, as
   * this resolves (Glamdring, Press the Enemy). `maxManaValue` is a count spec (see `per`).
   */
  CAST_FREE: 'castFree',
  /** "You may play that card this turn" / "for as long as it remains exiled": the affected cards in exile get a permission (`{ turn: 'this' | 'whileExiled', anyMana? }`). */
  MAY_PLAY_FROM_EXILE: 'mayPlayFromExile',
  /** "Exile the top card of your library." The exiled card is the context's `exiled`. */
  EXILE_TOP: 'exileTop',
  /** "Exile all creature cards from target player's graveyard": `{ filter }`; the exiled cards are the context's `exiled`. */
  EXILE_GRAVEYARD_CARDS: 'exileGraveyardCards',
  /**
   * `{ of: 'target' | 'subject', except, tapped?, attacking? }`: create a token that's a copy of that card or creature (707.2),
   * except for `except`'s characteristics (`types`, `subtypes`, `colors`, `power`, `toughness`, `addKeywords`, `addAbilities`).
   */
  CREATE_COPY_TOKEN: 'createCopyToken',
});

/** Effects that apply to the spell's or ability's target (unless `affected` says otherwise). */
export const TARGETED_EFFECTS = Object.freeze(new Set([
  EFFECT.ATTACH, EFFECT.DEAL_DAMAGE, EFFECT.DESTROY, EFFECT.EXILE, EFFECT.RETURN_TO_HAND, EFFECT.TAP,
  EFFECT.UNTAP, EFFECT.PUMP, EFFECT.ADD_COUNTERS, EFFECT.COUNTER_SPELL, EFFECT.FIGHT, EFFECT.RETURN_FROM_GRAVEYARD,
  EFFECT.RETURN_SPELL_TO_HAND, EFFECT.PUT_INTO_LIBRARY, EFFECT.GAIN_CONTROL, EFFECT.FLICKER, EFFECT.EXILE_UNTIL_SOURCE_LEAVES,
  EFFECT.COUNTER_UNLESS_PAID, EFFECT.REVEAL_HAND_DISCARD, EFFECT.GOAD, EFFECT.MOVE_COUNTERS, EFFECT.EXILE_FROM_GRAVEYARD,
  EFFECT.EXILE_GRAVEYARD_CARDS,
]));
/** Effects that hurt whatever they affect, for AI decisions. */
export const HARMFUL_EFFECTS = Object.freeze(new Set([
  EFFECT.DEAL_DAMAGE, EFFECT.DESTROY, EFFECT.EXILE, EFFECT.RETURN_TO_HAND, EFFECT.TAP, EFFECT.LOSE_LIFE,
  EFFECT.MILL, EFFECT.COUNTER_SPELL, EFFECT.FIGHT, EFFECT.RETURN_SPELL_TO_HAND, EFFECT.PUT_INTO_LIBRARY, EFFECT.GAIN_CONTROL,
  EFFECT.EXILE_UNTIL_SOURCE_LEAVES, EFFECT.COUNTER_UNLESS_PAID, EFFECT.REVEAL_HAND_DISCARD, EFFECT.SACRIFICE, EFFECT.DISCARD,
]));

/** What an effect applies to: its `affected` field, or the default for its type. */
export const effectAffects = (effect) => effect.affected
  ?? (TARGETED_EFFECTS.has(effect.type) ? AFFECTED.TARGET : AFFECTED.YOU);

/** Whether an effect hurts what it affects, e.g. damage or -2/-2 (for AI decisions). */
export const isHarmfulEffect = (effect) => HARMFUL_EFFECTS.has(effect.type)
  || (effect.type === EFFECT.PUMP && ((effect.power ?? 0) + (effect.toughness ?? 0) < 0
    || (effect.keywords ?? []).some((k) => k === KEYWORD.CANT_BLOCK || k === KEYWORD.CANT_ATTACK)));

/**
 * Whether an Aura is a curse, for AI decisions: it shrinks the creature, or stops it
 * attacking (Weakness, Pacifism). "+2/+2 and can't block" (Maniacal Rage) is a bonus.
 */
export const isCurse = (card) => isAura(card) && (card.staticAbilities ?? []).some((e) => {
  const size = (e.power ?? 0) + (e.toughness ?? 0);
  const keywords = e.keywords ?? [];
  return size < 0 || keywords.includes(KEYWORD.CANT_ATTACK) || (size <= 0 && keywords.includes(KEYWORD.CANT_BLOCK));
});

/**
 * Effects with the branches of "if" and "you may" effects spread out, for questions
 * such as "does this pump a creature?" (AI decisions).
 */
export const flattenEffects = (effects) => effects.flatMap((e) => (e.type === EFFECT.IF ? flattenEffects([...e.then, ...(e.else ?? [])])
  : e.type === EFFECT.MAY ? flattenEffects(e.effects) : [e]));

/** An ability's effects, whether written as `effects` or a single `effect`. */
export const abilityEffects = (ability) => ability.effects ?? (ability.effect ? [ability.effect] : []);

/**
 * What a triggered ability triggers on (603.1). Some are about the permanent itself;
 * WATCHER_TRIGGERS watch other objects, narrowed by the ability's `filter` (see
 * matchesFilter; `controller` defaults to 'you'). An ability can also have:
 * - `condition`: an intervening "if" clause (603.4), checked as it triggers and as it resolves
 * - `oncePerTurn`: "This ability triggers only once each turn."
 * - `zone: 'graveyard'`: it triggers while its card is in a graveyard (Council's Deliberation)
 * - `targets`: several targets, like a spell's
 */
export const TRIGGER = Object.freeze({
  /** "When this permanent enters" (603.6a). */
  ENTERS_BATTLEFIELD: 'entersBattlefield',
  /** "When this creature dies": put into a graveyard from the battlefield (700.4, 603.10a). */
  DIES: 'dies',
  /** "When this Aura is put into a graveyard from the battlefield" (any permanent, 603.10a). */
  PUT_INTO_GRAVEYARD: 'putIntoGraveyard',
  /** "Whenever this creature attacks" (508.3a). */
  ATTACKS: 'attacks',
  /** "Whenever this creature attacks or blocks" (508.3a, 509.3c). */
  ATTACKS_OR_BLOCKS: 'attacksOrBlocks',
  /** "Whenever another creature you control enters", "Whenever another Elf enters". */
  CREATURE_ENTERS: 'creatureEnters',
  /** Landfall: "Whenever a land you control enters". */
  LAND_ENTERS: 'landEnters',
  /**
   * "Whenever a player casts a green spell" (603.2, 601.2i). The filter can also say
   * `types`, `supertypes` and `nthThisTurn` ("your second spell each turn").
   */
  SPELL_CAST: 'spellCast',
  // These are about the permanent itself.
  /** "When this permanent leaves the battlefield" (603.6c, 603.10a). */
  LEAVES_BATTLEFIELD: 'leavesBattlefield',
  /** "Whenever this creature becomes blocked" (509.3c). */
  BECOMES_BLOCKED: 'becomesBlocked',
  /** "Whenever this creature deals combat damage to a player" (510.3a). */
  DEALS_COMBAT_DAMAGE_TO_PLAYER: 'dealsCombatDamageToPlayer',
  /** "Whenever this creature deals damage to a Goblin or Orc": `filter` is for the creature dealt damage. */
  DEALS_DAMAGE_TO_CREATURE: 'dealsDamageToCreature',
  /** On Equipment: "Whenever equipped creature blocks or becomes blocked by a creature" (the subject is that creature). */
  EQUIPPED_BLOCKS_OR_BLOCKED: 'equippedBlocksOrBlocked',
  /** On Equipment: "Whenever equipped creature attacks" (the subject is that creature). */
  EQUIPPED_ATTACKS: 'equippedAttacks',
  /** On Equipment: "Whenever equipped creature deals combat damage to a player" (the subject's `count` is the damage). */
  EQUIPPED_DEALS_COMBAT_DAMAGE_TO_PLAYER: 'equippedDealsCombatDamageToPlayer',
  /** "Whenever one or more creatures deal combat damage to you" (once per combat damage step). */
  COMBAT_DAMAGE_TO_YOU: 'combatDamageToYou',
  /** "Whenever you put one or more counters on Aragorn": the subject's `counters` are the kinds put on. */
  COUNTERS_PUT_ON: 'countersPutOn',
  /** "Whenever you draw a card during an opponent's turn" (once per card). */
  DRAW_ON_OPPONENTS_TURN: 'drawOnOpponentsTurn',
  /** "Whenever an opponent draws a card except the first one they draw in each of their draw steps". */
  OPPONENT_DRAWS: 'opponentDraws',
  /** A Saga's chapter ability (714.2b): `chapters` lists the chapter numbers it has. */
  CHAPTER: 'chapter',
  // These watch other objects, through `filter`.
  /** "Whenever a creature an opponent controls dies", "Whenever another creature you control dies". */
  CREATURE_DIES: 'creatureDies',
  /** "Whenever an Army you control attacks": once per attacking creature matching the filter. */
  CREATURE_ATTACKS: 'creatureAttacks',
  /** "Whenever you attack with one or more Elves": once per attack, if at least `minCount` (default 1) attackers match. */
  ATTACKS_WITH: 'attacksWith',
  /** "Whenever a Goblin or Orc you control deals combat damage to a player". */
  CREATURE_DEALS_COMBAT_DAMAGE_TO_PLAYER: 'creatureDealsCombatDamageToPlayer',
  /** "Whenever you draw your second card each turn" (504, 121.2). */
  DRAW_SECOND_CARD: 'drawSecondCard',
  /** "Whenever you scry" (701.22b): the subject's `count` is how many cards were looked at. */
  SCRY: 'scry',
  /** "Whenever the Ring tempts you" (701.54b): the subject's `chosenId` is the chosen Ring-bearer. */
  RING_TEMPTS: 'ringTempts',
  /** "Whenever you create a token". */
  TOKEN_CREATED: 'tokenCreated',
  /** "Whenever you sacrifice a token". */
  TOKEN_SACRIFICED: 'tokenSacrificed',
  /** "Whenever a creature you control … becomes the target of a spell or ability": the subject's `targetedBy` is that spell's controller. */
  BECOMES_TARGET: 'becomesTarget',
  /** "Whenever a creature an opponent controls is dealt excess noncombat damage": the subject's `count` is the excess (120.4a). */
  EXCESS_DAMAGE: 'excessDamage',
  /** "Whenever the final chapter ability of a Saga you control resolves" (the subject is the Saga). */
  FINAL_CHAPTER_RESOLVED: 'finalChapterResolved',
  // These trigger at the beginning of a step of the controller's turn (603.2, 503.1, 507.1, 513.1), or of
  // every turn with `eachTurn: true` ("At the beginning of each combat").
  UPKEEP: 'upkeep',
  BEGINNING_OF_COMBAT: 'beginningOfCombat',
  END_STEP: 'endStep',
});

/** Triggers about other objects (or the game), matched against an ability's `filter` rather than the permanent itself. */
export const WATCHER_TRIGGERS = Object.freeze(new Set([
  TRIGGER.CREATURE_ENTERS, TRIGGER.LAND_ENTERS, TRIGGER.SPELL_CAST, TRIGGER.CREATURE_DIES, TRIGGER.CREATURE_ATTACKS,
  TRIGGER.CREATURE_DEALS_COMBAT_DAMAGE_TO_PLAYER, TRIGGER.TOKEN_CREATED, TRIGGER.TOKEN_SACRIFICED, TRIGGER.BECOMES_TARGET,
  TRIGGER.EXCESS_DAMAGE, TRIGGER.FINAL_CHAPTER_RESOLVED,
]));

/** Whether an ability triggers on `type`: its `trigger` may be one TRIGGER or a list ("enters or leaves"). */
export const triggersOn = (ability, type) => (Array.isArray(ability.trigger) ? ability.trigger.includes(type) : ability.trigger === type);

export const ACTIVATION_TIMING = Object.freeze({
  /** Any time the player has priority (602.2). */
  INSTANT: 'instant',
  /** Only in the player's main phase with an empty stack, like loyalty abilities (606.3). */
  SORCERY: 'sorcery',
});

const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const TAP_FOR_G = { id: 'tapForG', text: '{T}: Add {G}.', cost: { tap: true }, effect: { type: EFFECT.ADD_MANA, mana: { G: 1 } } };

/** Cards defined in this file. Imported cards can't replace these. */
export const HAND_WRITTEN_CARDS = deepFreeze({
  forest: {
    id: 'forest',
    name: 'Forest',
    supertypes: ['Basic'],
    types: [CARD_TYPE.LAND],
    subtypes: ['Forest'],
    // 305.6: a basic Forest has the intrinsic ability "{T}: Add {G}."
    abilities: [TAP_FOR_G],
  },
  llanowarElves: {
    id: 'llanowarElves',
    name: 'Llanowar Elves',
    manaCost: { G: 1 },
    types: [CARD_TYPE.CREATURE],
    subtypes: ['Elf', 'Druid'],
    power: 1,
    toughness: 1,
    abilities: [TAP_FOR_G],
  },
  // Auriok Glaivemaster, made a hobbit. The art (app/art/) was generated with Gemini.
  shireBounder: {
    id: 'shireBounder',
    name: 'Shire Bounder',
    manaCost: { W: 1 },
    types: [CARD_TYPE.CREATURE],
    subtypes: ['Halfling', 'Soldier'],
    power: 1,
    toughness: 1,
    staticAbilities: [{
      affected: AFFECTED.SOURCE, condition: { sourceEquipped: true }, power: 1, toughness: 1, keywords: [KEYWORD.FIRST_STRIKE],
    }],
    text: 'As long as Shire Bounder is equipped, it gets +1/+1 and has first strike.',
    image: { art: 'app/art/shire-bounder.jpg' },
    colors: ['W'],
    rarity: 'common',
  },
});

/** Predefined tokens (111.10), for `{ type: 'createToken', token: TOKEN.TREASURE }`. */
export const TOKEN = Object.freeze({
  TREASURE: 'treasure', // 111.10a
  FOOD: 'food', // 111.10b
  CLUE: 'clue', // 111.10f
});

/** Definitions of the predefined tokens, keyed by TOKEN name. They're colorless artifacts. */
export const TOKENS = deepFreeze({
  [TOKEN.TREASURE]: {
    name: 'Treasure',
    types: [CARD_TYPE.ARTIFACT],
    subtypes: ['Treasure'],
    abilities: [{
      id: 'treasureMana',
      text: '{T}, Sacrifice this artifact: Add one mana of any color.',
      cost: { tap: true, sacrificeSelf: true },
      effects: [{ type: EFFECT.ADD_MANA, anyColor: 1 }],
    }],
    text: '{T}, Sacrifice this artifact: Add one mana of any color.',
  },
  [TOKEN.FOOD]: {
    name: 'Food',
    types: [CARD_TYPE.ARTIFACT],
    subtypes: ['Food'],
    abilities: [{
      id: 'eat',
      text: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
      cost: { mana: { generic: 2 }, tap: true, sacrificeSelf: true },
      effects: [{ type: EFFECT.GAIN_LIFE, amount: 3 }],
    }],
    text: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
  },
  [TOKEN.CLUE]: {
    name: 'Clue',
    types: [CARD_TYPE.ARTIFACT],
    subtypes: ['Clue'],
    abilities: [{
      id: 'investigate',
      text: '{2}, Sacrifice this artifact: Draw a card.',
      cost: { mana: { generic: 2 }, sacrificeSelf: true },
      effects: [{ type: EFFECT.DRAW_CARDS, count: 1 }],
    }],
    text: '{2}, Sacrifice this artifact: Draw a card.',
  },
});

/** 701.47a: the 0/0 black Army token amass creates ("Orc Army"). */
export const amassArmyToken = (subtype = 'Orc') => ({
  name: `${subtype} Army`, colors: ['black'], subtypes: [subtype, 'Army'], power: 0, toughness: 0,
});

/** A creature token's name: its own, or its subtypes ("Elf Warrior Token"). */
export function creatureTokenName(token) {
  return token.name ?? `${(token.subtypes ?? []).join(' ')} Token`.trim();
}

/**
 * The card id the game gives a token, from a `createToken` effect's `token`: a TOKEN
 * name (`'token:treasure'`) or a creature token's description. Tokens alike share it.
 */
export function tokenCardId(token) {
  if (typeof token === 'string') return `token:${token}`;
  const colors = token.colors ?? [];
  const keywords = token.keywords ?? [];
  return `token:${creatureTokenName(token)}:${token.power}/${token.toughness}:${colors.join(',')}:${keywords.join(',')}`;
}

const COLOR_LETTERS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/**
 * A card's colors as W/U/B/R/G (105.1): its `colors` (letters, or words for creature
 * tokens), else those of the mana symbols in its cost (202.2).
 */
export const colorsOf = (card) => (card.colors
  ? card.colors.map((c) => COLOR_LETTERS[c] ?? c)
  : COLORS_OF_MANA.filter((c) => card.manaCost?.[c]));

/** Whether an anthem (a static ability affecting creatures you control) applies to `creature`. */
export function anthemApplies(effect, source, creature) {
  return effect.affected === AFFECTED.EACH_CREATURE_YOU_CONTROL && isCreature(creature)
    && creature.controllerId === source.controllerId
    && !(effect.other && creature.id === source.id)
    && (!effect.colors || effect.colors.some((c) => colorsOf(creature).includes(c)))
    && (!effect.subtypes || effect.subtypes.some((t) => (creature.subtypes ?? []).includes(t)))
    // "Creature tokens you control", "Legendary creatures you control" (see matchesFilter).
    && (!effect.filter || matchesFilter(creature, { controller: 'any', ...effect.filter }, { controllerId: source.controllerId, sourceId: source.id }));
}

/** The colors "one mana of any color" can be (105.1). */
export const COLORS_OF_MANA = Object.freeze(['W', 'U', 'B', 'R', 'G']);

/** Whether a spell's or ability's effects need a mana color chosen (`anyColor`). */
export const needsManaColor = (effects) => effects.some((e) => e.type === EFFECT.ADD_MANA && e.anyColor);

/** Every card: imported from Scryfall (src/cards/importedCards.js) plus the hand-written ones. */
export const CARDS = deepFreeze({ ...structuredClone(IMPORTED_CARDS), ...HAND_WRITTEN_CARDS });

/** 40 cards: 20 Forests and 20 Llanowar Elves. */
export const DEFAULT_DECK = Object.freeze([...Array(20).fill('forest'), ...Array(20).fill('llanowarElves')]);

export const isLand = (card) => card.types.includes(CARD_TYPE.LAND);
export const isCreature = (card) => card.types.includes(CARD_TYPE.CREATURE);
export const isInstant = (card) => card.types.includes(CARD_TYPE.INSTANT);
export const isSorcery = (card) => card.types.includes(CARD_TYPE.SORCERY);
/** 110.4: instants and sorceries can't be permanents; everything else here is. */
export const isPermanentCard = (card) => !isInstant(card) && !isSorcery(card);
export const isArtifact = (card) => card.types.includes(CARD_TYPE.ARTIFACT);
export const isEnchantment = (card) => card.types.includes(CARD_TYPE.ENCHANTMENT);
export const isAura = (card) => isEnchantment(card) && (card.subtypes ?? []).includes(SUBTYPE.AURA);
export const isEquipment = (card) => isArtifact(card) && (card.subtypes ?? []).includes(SUBTYPE.EQUIPMENT);
export const hasKeyword = (card, keyword) => (card.keywords ?? []).includes(keyword);
export const hasSubtype = (card, subtype) => (card.subtypes ?? []).includes(subtype);
export const isLegendary = (card) => (card.supertypes ?? []).includes('Legendary');
/** 304.1, 702.8a: instants, and spells with flash, can be cast any time their controller has priority. */
export const castsAtInstantSpeed = (card) => isInstant(card) || hasKeyword(card, KEYWORD.FLASH);
/** 702.3b, 508.1c: a creature with defender or "can't attack" never attacks. */
export const cantAttack = (card) => hasKeyword(card, KEYWORD.DEFENDER) || hasKeyword(card, KEYWORD.CANT_ATTACK);

/** Mana value (202.3): the total amount of mana in a mana cost. */
export const manaValue = (manaCost) => Object.entries(manaCost ?? {})
  .reduce((sum, [type, n]) => (type === 'X' ? sum : type === 'hybrid' ? sum + n.length : sum + n), 0);

/** "Equip {N}" (702.6): attach to target creature you control, sorcery speed only. */
export const equipAbility = (mana, text = `Equip ${'{'}${mana.generic ?? 0}${'}'}`) => ({
  id: 'equip',
  text,
  cost: { mana },
  timing: ACTIVATION_TIMING.SORCERY,
  target: TARGET.CREATURE_YOU_CONTROL,
  effect: { type: EFFECT.ATTACH },
});

/**
 * 605.1a: an activated ability is a mana ability if it could add mana, has no
 * target, and isn't a loyalty ability. Mana abilities don't use the stack (605.3b).
 */
export const isManaAbility = (ability) => !ability.target
  && abilityEffects(ability).some((effect) => effect.type === EFFECT.ADD_MANA);

/** Target kinds that pick spells on the stack rather than permanents or players. */
export const SPELL_TARGETS = Object.freeze(new Set([TARGET.SPELL, TARGET.CREATURE_SPELL, TARGET.NONCREATURE_SPELL, TARGET.SPELL_OR_NONLAND_PERMANENT]));
/** Target kinds that pick players (TARGET.ANY picks players or creatures). */
export const PLAYER_TARGETS = Object.freeze(new Set([TARGET.PLAYER, TARGET.OPPONENT]));

/**
 * Whether a permanent is of a TARGET permanent kind, from the point of view of
 * `controllerId` (for "you control" and "an opponent controls"). `combat` (the
 * game's) says which creatures are attacking or blocking.
 */
export function matchesPermanentKind(permanent, kind, controllerId, combat = null) {
  const attacking = () => combat?.attackers.some((a) => a.cardId === permanent.id) ?? false;
  switch (kind) {
    case TARGET.ATTACKING_CREATURE: return isCreature(permanent) && attacking();
    case TARGET.ATTACKING_OR_BLOCKING_CREATURE:
      return isCreature(permanent) && (attacking() || (combat?.attackers.some((a) => a.blockerIds.includes(permanent.id)) ?? false));
    case TARGET.CREATURE:
    case TARGET.ANY:
      return isCreature(permanent);
    case TARGET.CREATURE_YOU_CONTROL: return isCreature(permanent) && permanent.controllerId === controllerId;
    case TARGET.CREATURE_OPPONENT_CONTROLS: return isCreature(permanent) && permanent.controllerId !== controllerId;
    case TARGET.ELF_YOU_CONTROL: return permanent.controllerId === controllerId && hasSubtype(permanent, 'Elf');
    case TARGET.ARTIFACT: return isArtifact(permanent);
    case TARGET.ENCHANTMENT: return isEnchantment(permanent);
    case TARGET.ARTIFACT_OR_ENCHANTMENT: return isArtifact(permanent) || isEnchantment(permanent);
    case TARGET.LAND: return isLand(permanent);
    case TARGET.NONLAND_PERMANENT:
    case TARGET.SPELL_OR_NONLAND_PERMANENT:
      return !isLand(permanent);
    case TARGET.PERMANENT: return true;
    default: return false;
  }
}

/** 700.6: an object is historic if it's legendary, an artifact or a Saga. */
export const isHistoric = (card) => isLegendary(card) || isArtifact(card) || hasSubtype(card, 'Saga');
export const isSaga = (card) => isEnchantment(card) && hasSubtype(card, 'Saga');
export const isToken = (card) => Boolean(card.token);

/**
 * Whether an object (a permanent, a card, or a spell's card) matches a filter, from the
 * point of view of `controllerId` and the source `sourceId` ("another", "you control").
 * Every field given must match:
 * - `other`: not the source; `controller`: 'you' (the default), 'opponent' or 'any'; `owner`: 'you'
 * - `types`, `subtypes`, `supertypes`, `colors`: has at least one of them; `notTypes`: none
 * - `nonlegendary`, `historic`, `token` (true or false), `tapped` (true or false)
 * - `keywords` / `withoutKeywords`: has one of them / none of them ("creature with flying")
 * - `power` / `toughness`: `{ min?, max? }`, or `{ equalsX: true }` (`x` from the context);
 *   `powerOrToughnessAtMost`: n
 * - `enteredThisTurn`, `dealtDamageThisTurn`, `blockedByOrBlockedLegendaryThisTurn`, `hasCounter` (a COUNTER kind)
 * - `diedThisTurn`: a card put into a graveyard from the battlefield this turn (`turn` from the context)
 * - `attacking`, `blocking` (`combat` from the context)
 * - `anyOf`: a list of filters, one of which must match
 */
export function matchesFilter(object, filter = {}, {
  controllerId, sourceId, combat = null, x = null, turn = null,
} = {}) {
  if (filter.anyOf && !filter.anyOf.some((f) => matchesFilter(object, f, { controllerId, sourceId, combat, x, turn }))) return false;
  if (filter.other && object.id === sourceId) return false;
  // "target creature you own"
  if (filter.owner === 'you' && object.ownerId !== controllerId) return false;
  const controller = filter.controller ?? 'you';
  if (controller === 'you' && object.controllerId !== controllerId) return false;
  if (controller === 'opponent' && object.controllerId === controllerId) return false;
  if (filter.types && !filter.types.some((t) => object.types?.includes(t))) return false;
  if (filter.notTypes && filter.notTypes.some((t) => object.types?.includes(t))) return false;
  if (filter.subtypes && !filter.subtypes.some((t) => hasSubtype(object, t))) return false;
  if (filter.supertypes && !filter.supertypes.some((t) => (object.supertypes ?? []).includes(t))) return false;
  if (filter.nonlegendary && isLegendary(object)) return false;
  if (filter.historic && !isHistoric(object)) return false;
  if (filter.token !== undefined && isToken(object) !== filter.token) return false;
  if (filter.tapped !== undefined && Boolean(object.tapped) !== filter.tapped) return false;
  if (filter.colors && !filter.colors.some((c) => colorsOf(object).includes(c))) return false;
  if (filter.keywords && !filter.keywords.some((k) => hasKeyword(object, k))) return false;
  if (filter.withoutKeywords && filter.withoutKeywords.some((k) => hasKeyword(object, k))) return false;
  const inRange = (value, range) => {
    if (range.equalsX) return value === x;
    return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
  };
  if (filter.power && !inRange(object.power ?? 0, filter.power)) return false;
  if (filter.toughness && !inRange(object.toughness ?? 0, filter.toughness)) return false;
  if (filter.powerOrToughnessAtMost !== undefined
    && !((object.power ?? Infinity) <= filter.powerOrToughnessAtMost || (object.toughness ?? Infinity) <= filter.powerOrToughnessAtMost)) return false;
  // Shelob: "dealt damage this turn by a Spider you controlled".
  if (filter.damagedBySpiderOfYou && !object.damagedBySpiderOf?.includes(controllerId)) return false;
  // "a creature you control with a +1/+1 counter on it".
  if (filter.hasCounter && !(object.counters?.[filter.hasCounter] > 0)) return false;
  if (filter.enteredThisTurn && !object.enteredThisTurn) return false;
  if (filter.dealtDamageThisTurn && !object.dealtDamageThisTurn) return false;
  if (filter.blockedByOrBlockedLegendaryThisTurn && !object.blockedByOrBlockedLegendaryThisTurn) return false;
  if (filter.diedThisTurn && object.leftBattlefieldTurn !== turn) return false;
  if (filter.attacking && !combat?.attackers.some((a) => a.cardId === object.id)) return false;
  if (filter.blocking && !combat?.attackers.some((a) => a.blockerIds.includes(object.id))) return false;
  return true;
}

/** Whether two creatures share a creature type (205.3m): any subtype in common. */
const sharesCreatureType = (a, b) => (a.subtypes ?? []).some((t) => hasSubtype(b, t));

/**
 * A number on the battlefield, for effects that say "for each" or "where X is"
 * (`per` on an effect, a static ability or a cost reduction):
 * `{ of: 'creatures' | 'power', controller?: 'you' | 'any', subtypes?, other?, attacking?, sharesTypeWith? }`
 * counts creatures (or adds up their power) that `controllerId` controls (or any
 * player, with 'any'). `other` leaves out `sourceId`; `attacking` keeps attacking
 * creatures (`combat` is the game's); `sharesTypeWith: true` keeps those that share a
 * creature type with `subject` (and leaves it out), for "each other creature that
 * shares a creature type with it".
 */
export function countOf(spec, {
  battlefield, controllerId, sourceId = null, subject = null, combat = null, players = null,
}) {
  // "the number of creatures you control plus the number of Foods you control" (Hobbit's Sting).
  if (spec.sum) return spec.sum.reduce((total, part) => total + countOf(part, { battlefield, controllerId, sourceId, subject, combat, players }), 0);
  // "the number of instant and sorcery cards in your graveyard": `whose` is 'you' (the default) or 'all'.
  if (spec.of === 'cards') {
    const graveyards = (players ?? []).filter((p) => (spec.whose ?? 'you') === 'all' || p.id === (spec.playerId ?? controllerId));
    return graveyards.flatMap((p) => p.graveyard).filter((c) => matchesFilter(c, { controller: 'any', ...spec.filter }, { controllerId })).length;
  }
  // "the number of Foods you control", "the number of lands you control": any permanents.
  if (spec.of === 'permanents') {
    return battlefield.filter((p) => matchesFilter(p, { controller: spec.controller, ...spec.filter }, { controllerId, sourceId, combat })).length;
  }
  // "the greatest toughness among creatures you control" (Last March of the Ents).
  if (spec.of === 'greatestToughness') {
    const toughness = battlefield.filter((p) => isCreature(p) && matchesFilter(p, { controller: spec.controller }, { controllerId })).map((p) => p.toughness ?? 0);
    return Math.max(0, ...toughness);
  }
  // Amounts that only exist while a spell or ability resolves (X, the amassed Army's power) count 0 here.
  if (spec.of !== 'creatures' && spec.of !== 'power') return 0;
  let creatures = battlefield.filter((p) => isCreature(p)
    && matchesFilter(p, { other: spec.other, controller: spec.controller, subtypes: spec.subtypes, ...spec.filter }, { controllerId, sourceId, combat }));
  if (spec.attacking) creatures = creatures.filter((p) => combat?.attackers.some((a) => a.cardId === p.id));
  if (spec.sharesTypeWith) creatures = creatures.filter((p) => p.id !== subject?.id && subject && sharesCreatureType(p, subject));
  return spec.of === 'power' ? creatures.reduce((sum, p) => sum + Math.max(0, p.power ?? 0), 0) : creatures.length;
}

/** An effect's amounts multiplied by `n` ("for each", 608.2h), without its `per`. */
export function scaleEffect(effect, n) {
  const { per, ...scaled } = effect;
  for (const field of ['amount', 'count', 'power', 'toughness', 'anyCombination']) {
    if (typeof scaled[field] === 'number') scaled[field] *= n;
  }
  if (scaled.mana) scaled.mana = Object.fromEntries(Object.entries(scaled.mana).map(([type, k]) => [type, k * n]));
  return scaled;
}

/**
 * A mana cost with {X} worked out (107.3): `{ X: 1, R: 1 }` with X = 3 costs `{ generic: 3, R: 1 }`.
 * Without `x`, {X} counts as 0 (202.3e).
 */
export function withX(manaCost, x = 0) {
  if (!manaCost?.X) return manaCost;
  const { X, ...rest } = manaCost;
  const generic = (rest.generic ?? 0) + X * x;
  delete rest.generic;
  return generic ? { ...rest, generic } : rest;
}

/** A mana cost reduced by `amount` generic mana (601.2f: reductions only reduce the generic part here). */
export function reduceGeneric(manaCost, amount) {
  if (!manaCost || amount <= 0) return manaCost;
  const generic = Math.max(0, (manaCost.generic ?? 0) - amount);
  const { generic: _, ...colored } = manaCost;
  return generic ? { ...colored, generic } : colored;
}

/**
 * What a spell costs to cast now (601.2f): its mana cost, with X, less any cost reduction:
 * `costReduction: { per }` ("This spell costs {X} less to cast, where X is ...") or
 * `{ amount, condition }` ("costs {2} less to cast if ..."). A condition needs the game, so
 * `conditionMet(condition)` is asked; without it, conditional reductions don't apply.
 */
export function spellCost(card, {
  battlefield, controllerId, combat = null, x = 0, conditionMet = null, countFor = null,
}) {
  const cost = withX(card.manaCost, x);
  const reduction = card.costReduction;
  if (!reduction || !cost) return cost;
  // `countFor` (the game's) knows numbers only a game knows, such as permanents sacrificed this turn.
  if (reduction.per) return reduceGeneric(cost, countFor ? countFor(reduction.per) : countOf(reduction.per, { battlefield, controllerId, combat }));
  return conditionMet?.(reduction.condition) ? reduceGeneric(cost, reduction.amount) : cost;
}

/**
 * Whether `blocker` may block `attacker` as far as each creature's own restrictions go
 * (509.1b): "can't block", "can't be blocked", flying (702.9b, reach 702.17b),
 * "except by creatures with flying" and "by creatures with power 2 or less". Restrictions
 * on the whole block (menace, "more than one creature") are checked separately.
 */
export function canBlockCreature(blocker, attacker) {
  if (hasKeyword(blocker, KEYWORD.CANT_BLOCK) || hasKeyword(attacker, KEYWORD.CANT_BE_BLOCKED)) return false;
  if (hasKeyword(attacker, KEYWORD.FLYING) && !hasKeyword(blocker, KEYWORD.FLYING) && !hasKeyword(blocker, KEYWORD.REACH)) return false;
  if (hasKeyword(attacker, KEYWORD.BLOCKED_ONLY_BY_FLYERS) && !hasKeyword(blocker, KEYWORD.FLYING)) return false;
  if (hasKeyword(attacker, KEYWORD.CANT_BE_BLOCKED_BY_POWER_2_OR_LESS) && (blocker.power ?? 0) <= 2) return false;
  // The Ring, level 1 (701.54c): a Ring-bearer can't be blocked by creatures with greater power.
  if (hasKeyword(attacker, KEYWORD.CANT_BE_BLOCKED_BY_GREATER_POWER) && (blocker.power ?? 0) > (attacker.power ?? 0)) return false;
  if (hasKeyword(attacker, KEYWORD.BLOCKED_ONLY_BY_LEGENDARY) && !isLegendary(blocker)) return false;
  return true;
}
