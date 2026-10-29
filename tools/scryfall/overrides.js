/**
 * Cards whose rules are written by hand rather than parsed from their Oracle text:
 * one-of-a-kind abilities the grammar in rulesText.js doesn't read. The importer still
 * takes everything else (name, types, mana cost, art, rarity) from Scryfall, and skips
 * parsing the card's text when it has an entry here.
 *
 * Each entry has the rules fields of a card definition (see src/cards/cards.js):
 * `keywords`, `abilities`, `triggeredAbilities`, `staticAbilities`, `effects`,
 * `target(s)`, `modes`, `handAbilities`, `graveyardAbilities`, `additionalCost`,
 * `costReduction`, `enchant`, `entersTapped`, `ward`, and `power`/`toughness` for
 * one whose printed values aren't numbers. Abilities get ids if they have none. Any other
 * field (`entersTappedUnless`, `entersWithCounters`, `cantBeCountered`, `chooseTwo`) is
 * copied into the definition as it is.
 *
 * So far: The Lord of the Rings: Tales of Middle-earth (LTR), except the cards listed as
 * left out in cards/ltr-cards.txt.
 */
import {
  EFFECT, TARGET, AFFECTED, TRIGGER, KEYWORD, COUNTER, TOKEN, CARD_TYPE, ACTIVATION_TIMING, equipAbility,
} from '../../src/cards/cards.js';

const { CREATURE, ARTIFACT, LAND, INSTANT, SORCERY } = CARD_TYPE;
const SORCERY_SPEED = ACTIVATION_TIMING.SORCERY;

// Effects
const ringTempts = { type: EFFECT.RING_TEMPTS };
const scry = (count) => ({ type: EFFECT.SCRY, count });
const amass = (count, extra = {}) => ({ type: EFFECT.AMASS, count, subtype: 'Orc', ...extra });
const draw = (count = 1, extra = {}) => ({ type: EFFECT.DRAW_CARDS, count, ...extra });
const discard = (count = 1) => ({ type: EFFECT.DISCARD, count });
const tokens = (token, count = 1, extra = {}) => ({ type: EFFECT.CREATE_TOKEN, count, token, ...extra });
const food = (count = 1, extra = {}) => tokens(TOKEN.FOOD, count, extra);
const treasure = (count = 1) => tokens(TOKEN.TREASURE, count);
const soldier = { colors: ['white'], subtypes: ['Human', 'Soldier'], power: 1, toughness: 1 };
const spirit = { colors: ['white'], subtypes: ['Spirit'], power: 1, toughness: 1, keywords: [KEYWORD.FLYING] };
const pump = (power, toughness, extra = {}) => ({ type: EFFECT.PUMP, power, toughness, ...extra });
const grant = (keywords, extra = {}) => ({ type: EFFECT.PUMP, keywords, ...extra });
const counters = (count = 1, extra = {}) => ({ type: EFFECT.ADD_COUNTERS, counter: COUNTER.PLUS_ONE, count, ...extra });
const damage = (amount, extra = {}) => ({ type: EFFECT.DEAL_DAMAGE, amount, ...extra });
const loseLife = (amount, extra = {}) => ({ type: EFFECT.LOSE_LIFE, amount, ...extra });
const gainLife = (amount, extra = {}) => ({ type: EFFECT.GAIN_LIFE, amount, ...extra });
const ifThen = (condition, then, otherwise = []) => ({ type: EFFECT.IF, if: condition, then, else: otherwise });
const reflexive = (ability, extra = {}) => ({ type: EFFECT.REFLEXIVE_TRIGGER, ability: { text: 'When you do, …', ...ability }, ...extra });

// Who and what
const source = { affected: AFFECTED.SOURCE };
const subject = { affected: AFFECTED.SUBJECT };
const eachOpponent = { affected: AFFECTED.EACH_OPPONENT };
const yourCreatures = { affected: AFFECTED.EACH_CREATURE_YOU_CONTROL };
const legendary = { supertypes: ['Legendary'] };
const legendaryCreature = { types: [CREATURE], supertypes: ['Legendary'] };
const goblinOrOrc = { subtypes: ['Goblin', 'Orc'] };
const foodSpec = { kind: TARGET.PERMANENT, filter: { subtypes: ['Food'] } };
const target = (kind, filter, extra = {}) => ({ kind, ...(filter ? { filter } : {}), ...extra });
const upTo = (kind, filter) => target(kind, filter, { optional: true });

// Conditions
const youControl = (filter, atLeast) => ({ youControl: filter, ...(atLeast ? { atLeast } : {}) });
const controlsLegendaryCreature = youControl(legendaryCreature);

// Abilities
const when = (trigger, text, effects, extra = {}) => ({ trigger, text, effects, ...extra });
const ability = (text, cost, effects, extra = {}) => ({ text, cost, effects, ...extra });
const anthem = (fields) => ({ affected: AFFECTED.EACH_CREATURE_YOU_CONTROL, ...fields });
const attached = (fields) => ({ affected: AFFECTED.ATTACHED_PERMANENT, ...fields });
const self = (fields) => ({ affected: AFFECTED.SOURCE, ...fields });
const chapter = (chapters, text, effects, extra = {}) => ({ trigger: TRIGGER.CHAPTER, chapters, text, effects, ...extra });
const equip = (generic, text = `Equip {${generic}}`) => equipAbility({ generic }, text);
const tapForC = { id: 'tapForC', text: '{T}: Add {C}.', cost: { tap: true }, effects: [{ type: EFFECT.ADD_MANA, mana: { C: 1 } }] };
const tapForAny = { id: 'tapForAnyColor', text: '{T}: Add one mana of any color.', cost: { tap: true }, effects: [{ type: EFFECT.ADD_MANA, anyColor: 1 }] };
const tapFor = (color) => ({ id: `tapFor${color}`, text: `{T}: Add {${color}}.`, cost: { tap: true }, effects: [{ type: EFFECT.ADD_MANA, mana: { [color]: 1 } }] });
const smaug = {
  name: 'Smaug', supertypes: ['Legendary'], colors: ['red'], subtypes: ['Dragon'], power: 6, toughness: 6, keywords: [KEYWORD.FLYING, KEYWORD.HASTE],
  triggeredAbilities: [{ id: 'smaugDies', trigger: TRIGGER.DIES, text: 'When Smaug dies, create fourteen Treasure tokens.', effects: [treasure(14)] }],
};

export const OVERRIDES = {
  "Arwen's Gift": {
    costReduction: { amount: 1, condition: youControl(legendaryCreature, 2) },
    effects: [scry(2), draw(2)],
  },
  'Arwen Undómiel': {
    triggeredAbilities: [when(TRIGGER.SCRY, 'Whenever you scry, put a +1/+1 counter on target creature.', [counters(1)], { target: TARGET.CREATURE })],
    abilities: [ability('{4}{G}{U}: Scry 2.', { mana: { generic: 4, G: 1, U: 1 } }, [scry(2)])],
  },
  'Bag End Porter': {
    triggeredAbilities: [when(TRIGGER.ATTACKS, 'Whenever this creature attacks, it gets +X/+X until end of turn, where X is the number of legendary creatures you control.', [
      pump(1, 1, { ...source, per: { of: 'creatures', filter: legendary } }),
    ])],
  },
  'Banish from Edoras': {
    costReduction: { amount: 2, condition: { targetMatches: { tapped: true } } },
    target: TARGET.CREATURE,
    effects: [{ type: EFFECT.EXILE }],
  },
  'Barrow-Blade': {
    staticAbilities: [attached({ power: 1, toughness: 1 })],
    triggeredAbilities: [when(TRIGGER.EQUIPPED_BLOCKS_OR_BLOCKED, 'Whenever equipped creature blocks or becomes blocked by a creature, that creature loses all abilities until end of turn.', [
      { type: EFFECT.PUMP, loseAbilities: true, ...subject },
    ])],
    abilities: [equip(1)],
  },
  'Battle-Scarred Goblin': {
    triggeredAbilities: [when(TRIGGER.BECOMES_BLOCKED, 'Whenever this creature becomes blocked, it deals 1 damage to each creature blocking it.', [
      damage(1, { affected: AFFECTED.CREATURES_BLOCKING_SOURCE }),
    ])],
  },
  'Bewitching Leechcraft': {
    enchant: TARGET.CREATURE,
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When this Aura enters, tap enchanted creature.', [{ type: EFFECT.TAP, affected: AFFECTED.ATTACHED_PERMANENT }])],
    staticAbilities: [attached({ keywords: [KEYWORD.UNTAPS_BY_REMOVING_COUNTER] })],
  },
  'Bilbo, Retired Burglar': {
    triggeredAbilities: [
      when([TRIGGER.ENTERS_BATTLEFIELD, TRIGGER.LEAVES_BATTLEFIELD], 'When Bilbo enters or leaves the battlefield, the Ring tempts you.', [ringTempts]),
      when(TRIGGER.DEALS_COMBAT_DAMAGE_TO_PLAYER, 'Whenever Bilbo deals combat damage to a player, create a Treasure token.', [treasure()]),
    ],
  },
  'Bill Ferny, Bree Swindler': {
    triggeredAbilities: [when(TRIGGER.BECOMES_BLOCKED, 'Whenever Bill Ferny becomes blocked, choose one —', [], {
      modes: [
        { text: 'Create a Treasure token.', effects: [treasure()] },
        {
          text: 'Target opponent gains control of target Horse you control. If they do, remove Bill Ferny from combat and create three Treasure tokens.',
          targets: [TARGET.OPPONENT, target(TARGET.CREATURE_YOU_CONTROL, { subtypes: ['Horse'] })],
          effects: [
            { type: EFFECT.GAIN_CONTROL, targetIndex: 1, toTarget: 0 },
            ifThen({ targetMatches: { controller: 'opponent' }, targetIndex: 1 }, [{ type: EFFECT.REMOVE_FROM_COMBAT, ...source }, treasure(3)]),
          ],
        },
      ],
    })],
  },
  'Bill the Pony': {
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When Bill the Pony enters, create two Food tokens.', [food(2)])],
    abilities: [ability('Sacrifice a Food: Until end of turn, target creature you control assigns combat damage equal to its toughness rather than its power.',
      { sacrifice: foodSpec }, [grant([KEYWORD.DAMAGE_BY_TOUGHNESS])], { target: TARGET.CREATURE_YOU_CONTROL })],
  },
  'Bitter Downfall': {
    costReduction: { amount: 3, condition: { targetMatches: { dealtDamageThisTurn: true } } },
    target: TARGET.CREATURE,
    effects: [{ type: EFFECT.DESTROY }, loseLife(2, { affected: AFFECTED.TARGET_CONTROLLER })],
  },
  "Bombadil's Song": {
    target: TARGET.CREATURE_YOU_CONTROL,
    effects: [pump(1, 1, { keywords: [KEYWORD.HEXPROOF] }), ringTempts],
  },
  'Book of Mazarbul': {
    triggeredAbilities: [
      chapter([1], 'I — Amass Orcs 1.', [amass(1)]),
      chapter([2], 'II — Amass Orcs 2.', [amass(2)]),
      chapter([3], 'III — Creatures you control get +1/+0 and gain menace until end of turn.', [pump(1, 0, { keywords: [KEYWORD.MENACE], ...yourCreatures })]),
    ],
  },
  'Breaking of the Fellowship': {
    targets: [TARGET.CREATURE_OPPONENT_CONTROLS, target(TARGET.CREATURE_OPPONENT_CONTROLS, null, { sameControllerAsTarget: 0 })],
    effects: [damage(1, { from: { target: 0 }, per: { of: 'powerOf', index: 0 }, targetIndex: 1 }), ringTempts],
  },
  'Butterbur, Bree Innkeeper': {
    triggeredAbilities: [when(TRIGGER.END_STEP, "At the beginning of your end step, if you don't control a Food, create a Food token.", [food()], {
      condition: { not: youControl({ subtypes: ['Food'] }) },
    })],
  },
  'Cast into the Fire': {
    modes: [
      {
        text: 'Cast into the Fire deals 1 damage to each of up to two target creatures.',
        targets: [upTo(TARGET.CREATURE), upTo(TARGET.CREATURE)],
        effects: [damage(1)],
      },
      { text: 'Exile target artifact.', target: TARGET.ARTIFACT, effects: [{ type: EFFECT.EXILE }] },
    ],
  },
  'Celeborn the Wise': {
    triggeredAbilities: [
      when(TRIGGER.ATTACKS_WITH, 'Whenever you attack with one or more Elves, scry 1.', [scry(1)], { filter: { subtypes: ['Elf'] } }),
      when(TRIGGER.SCRY, 'Whenever you scry, Celeborn gets +1/+1 until end of turn for each card looked at while scrying this way.', [
        pump(1, 1, { ...source, per: { of: 'eventCount' } }),
      ]),
    ],
  },
  'Cirith Ungol Patrol': {
    abilities: [ability('{1}, {T}, Sacrifice another creature: Draw a card, then create a Food token.',
      { mana: { generic: 1 }, tap: true, sacrifice: { kind: TARGET.CREATURE, other: true } }, [draw(1), food()])],
  },
  "Council's Deliberation": {
    effects: [draw(1)],
    triggeredAbilities: [when(TRIGGER.SCRY, 'Whenever you scry, if you control an Island, you may exile this card from your graveyard. If you do, draw a card.', [
      { type: EFFECT.EXILE_SOURCE_FROM_GRAVEYARD }, draw(1, { condition: { paid: true } }),
    ], { zone: 'graveyard', optional: true, condition: youControl({ subtypes: ['Island'] }) })],
  },
  'Denethor, Ruling Steward': {
    triggeredAbilities: [when(TRIGGER.END_STEP, 'At the beginning of your end step, if a creature died under your control this turn, create a 1/1 white Human Soldier creature token.', [
      tokens(soldier),
    ], { condition: { creatureDiedThisTurn: true } })],
    abilities: [ability('{2}, Sacrifice another creature: Each opponent loses 1 life and you gain 1 life.',
      { mana: { generic: 2 }, sacrifice: { kind: TARGET.CREATURE, other: true } }, [loseLife(1, eachOpponent), gainLife(1)])],
  },
  'Dreadful as the Storm': {
    target: TARGET.CREATURE,
    effects: [{ type: EFFECT.PUMP, setBase: { power: 5, toughness: 5 } }, ringTempts],
  },
  'Dúnedain Blade': {
    staticAbilities: [attached({ power: 2, toughness: 1 })],
    abilities: [
      { ...equip(1, 'Equip Human {1}'), id: 'equipHuman', target: target(TARGET.CREATURE_YOU_CONTROL, { subtypes: ['Human'] }) },
      equip(3),
    ],
  },
  'Dúnedain Rangers': {
    triggeredAbilities: [when(TRIGGER.LAND_ENTERS, "Landfall — Whenever a land you control enters, if you don't control a Ring-bearer, the Ring tempts you.", [ringTempts], {
      condition: { ringBearer: false },
    })],
  },
  'Eastfarthing Farmer': {
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When this creature enters, create a Food token. When you do, target creature you control gets +1/+1 until end of turn for each Food you control.', [
      food(),
      reflexive({ target: TARGET.CREATURE_YOU_CONTROL, effects: [pump(1, 1, { per: { of: 'permanents', filter: { subtypes: ['Food'] } } })] }),
    ])],
  },
  'East-Mark Cavalier': {
    keywords: [KEYWORD.VIGILANCE],
    triggeredAbilities: [when(TRIGGER.DEALS_DAMAGE_TO_CREATURE, 'Whenever this creature deals damage to a Goblin or Orc, destroy that creature.', [
      { type: EFFECT.DESTROY, ...subject },
    ], { filter: goblinOrOrc })],
  },
  'Elrond, Lord of Rivendell': {
    triggeredAbilities: [when(TRIGGER.CREATURE_ENTERS, 'Whenever Elrond or another creature you control enters, scry 1. If this is the second time this ability has resolved this turn, the Ring tempts you.', [
      scry(1), { ...ringTempts, condition: { resolvedThisTurn: 2 } },
    ], { filter: {} })],
  },
  'Elven Farsight': {
    effects: [
      scry(3),
      { type: EFFECT.MAY, text: 'Reveal the top card of your library?', effects: [{ type: EFFECT.REVEAL_TOP }, draw(1, { condition: { revealedMatches: { types: [CREATURE] } } })] },
    ],
  },
  'Ent-Draught Basin': {
    abilities: [ability('{X}, {T}: Put a +1/+1 counter on target creature with power X. Activate only as a sorcery.', { mana: { X: 1 }, tap: true }, [counters(1)], {
      timing: SORCERY_SPEED, target: target(TARGET.CREATURE, { power: { equalsX: true } }),
    })],
  },
  'Entish Restoration': {
    effects: [
      { type: EFFECT.SACRIFICE, affected: AFFECTED.YOU, filter: { types: [LAND] } },
      ifThen(youControl({ types: [CREATURE], power: { min: 4 } }),
        [{ type: EFFECT.SEARCH_LIBRARY, filter: { types: [LAND], supertypes: ['Basic'] }, count: 3, destination: 'battlefield', tapped: true }],
        [{ type: EFFECT.SEARCH_LIBRARY, filter: { types: [LAND], supertypes: ['Basic'] }, count: 2, destination: 'battlefield', tapped: true }]),
    ],
  },
  "Ent's Fury": {
    targets: [TARGET.CREATURE_YOU_CONTROL, TARGET.CREATURE_OPPONENT_CONTROLS],
    effects: [
      counters(1, { targetIndex: 0, condition: { targetMatches: { power: { min: 4 } }, targetIndex: 0 } }),
      pump(1, 1, { targetIndex: 0 }),
      { type: EFFECT.FIGHT },
    ],
  },
  'Éomer of the Riddermark': {
    keywords: [KEYWORD.HASTE],
    triggeredAbilities: [when(TRIGGER.ATTACKS, 'Whenever Éomer attacks, if you control a creature with the greatest power among creatures on the battlefield, create a 1/1 white Human Soldier creature token.', [
      tokens(soldier),
    ], { condition: { controlsGreatestPower: true } })],
  },
  'Éowyn, Lady of Rohan': {
    triggeredAbilities: [when(TRIGGER.BEGINNING_OF_COMBAT, 'At the beginning of combat on your turn, target creature gains your choice of first strike or vigilance until end of turn. If that creature is equipped, it gains first strike and vigilance until end of turn instead.', [
      ifThen({ targetEquipped: true },
        [grant([KEYWORD.FIRST_STRIKE, KEYWORD.VIGILANCE])],
        [{ type: EFFECT.PUMP, keywordChoice: [KEYWORD.FIRST_STRIKE, KEYWORD.VIGILANCE] }]),
    ], { target: TARGET.CREATURE })],
    staticAbilities: [{ rule: 'equipCostsLess' }],
  },
  'Erebor Flamesmith': {
    triggeredAbilities: [when(TRIGGER.SPELL_CAST, 'Whenever you cast an instant or sorcery spell, this creature deals 1 damage to each opponent.', [
      damage(1, eachOpponent),
    ], { filter: { types: [INSTANT, SORCERY] } })],
  },
  'Errand-Rider of Gondor': {
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, "When this creature enters, draw a card. Then if you don't control a legendary creature, put a card from your hand on the bottom of your library.", [
      draw(1), { type: EFFECT.PUT_FROM_HAND_ON_BOTTOM, count: 1, condition: { not: controlsLegendaryCreature } },
    ])],
  },
  'Esquire of the King': {
    abilities: [ability('{4}{W}, {T}: Creatures you control get +1/+1 until end of turn. This ability costs {2} less to activate if you control a legendary creature.',
      { mana: { generic: 4, W: 1 }, tap: true }, [pump(1, 1, yourCreatures)], { costReduction: { amount: 2, condition: controlsLegendaryCreature } })],
  },
  'Faramir, Field Commander': {
    triggeredAbilities: [
      when(TRIGGER.END_STEP, 'At the beginning of your end step, if a creature died under your control this turn, draw a card.', [draw(1)], {
        condition: { creatureDiedThisTurn: true },
      }),
      when(TRIGGER.RING_TEMPTS, 'Whenever the Ring tempts you, if you chose a creature other than Faramir as your Ring-bearer, create a 1/1 white Human Soldier creature token.', [
        tokens(soldier),
      ], { condition: { chosenOtherThanSource: true } }),
    ],
  },
  'Fear, Fire, Foes!': {
    target: TARGET.CREATURE,
    effects: [
      { type: EFFECT.NOTHING },
      damage(1, { per: { of: 'x' } }),
      damage(1, { affected: AFFECTED.EACH_CREATURE, controlledByTarget: 0, otherThanTarget: 0 }),
    ],
  },
  'Fiery Inscription': {
    triggeredAbilities: [
      when(TRIGGER.ENTERS_BATTLEFIELD, 'When this enchantment enters, the Ring tempts you.', [ringTempts]),
      when(TRIGGER.SPELL_CAST, 'Whenever you cast an instant or sorcery spell, this enchantment deals 2 damage to each opponent.', [damage(2, eachOpponent)], {
        filter: { types: [INSTANT, SORCERY] },
      }),
    ],
  },
  'Fire of Orthanc': {
    target: target(TARGET.PERMANENT, { types: [ARTIFACT, LAND] }),
    effects: [
      { type: EFFECT.DESTROY },
      grant([KEYWORD.CANT_BLOCK], { affected: AFFECTED.EACH_CREATURE, filter: { withoutKeywords: [KEYWORD.FLYING] } }),
    ],
  },
  'Fog on the Barrow-Downs': {
    enchant: TARGET.CREATURE,
    staticAbilities: [attached({ setSubtypes: ['Spirit'] }), attached({ keywords: [KEYWORD.CANT_ATTACK, KEYWORD.CANT_BLOCK] })],
  },
  'Foray of Orcs': {
    effects: [
      amass(2),
      reflexive({
        text: "When you do, Foray of Orcs deals X damage to target creature an opponent controls, where X is the amassed Army's power.",
        target: TARGET.CREATURE_OPPONENT_CONTROLS,
        effects: [damage(1, { per: { of: 'amassedArmyPower' } })],
      }),
    ],
  },
  'Friendly Rivalry': {
    targets: [TARGET.CREATURE_YOU_CONTROL, upTo(TARGET.CREATURE_YOU_CONTROL, legendary), TARGET.CREATURE_OPPONENT_CONTROLS],
    effects: [
      damage(1, { from: { target: 0 }, per: { of: 'powerOf', index: 0 }, targetIndex: 2 }),
      damage(1, { from: { target: 1 }, per: { of: 'powerOf', index: 1 }, targetIndex: 2 }),
    ],
  },
  'Frodo Baggins': {
    triggeredAbilities: [when(TRIGGER.CREATURE_ENTERS, 'Whenever Frodo Baggins or another legendary creature you control enters, the Ring tempts you.', [ringTempts], {
      filter: legendary,
    })],
    staticAbilities: [self({ keywords: [KEYWORD.MUST_BE_BLOCKED], condition: { sourceIsRingBearer: true } })],
  },
  'Galadhrim Bow': {
    keywords: [KEYWORD.FLASH],
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When this Equipment enters, attach it to target creature you control. Untap that creature.', [
      { type: EFFECT.ATTACH }, { type: EFFECT.UNTAP },
    ], { target: TARGET.CREATURE_YOU_CONTROL })],
    staticAbilities: [attached({ power: 1, toughness: 2, keywords: [KEYWORD.REACH] })],
    abilities: [equip(2)],
  },
  'Gandalf, Friend of the Shire': {
    keywords: [KEYWORD.FLASH],
    staticAbilities: [{ rule: 'flashForSorceries' }],
    triggeredAbilities: [when(TRIGGER.RING_TEMPTS, 'Whenever the Ring tempts you, if you chose a creature other than Gandalf as your Ring-bearer, draw a card.', [draw(1)], {
      condition: { chosenOtherThanSource: true },
    })],
  },
  "Gandalf's Sanction": {
    target: TARGET.CREATURE,
    effects: [damage(1, { per: { of: 'cards', filter: { types: [INSTANT, SORCERY] } }, excessToController: true })],
  },
  "Gimli's Axe": {
    staticAbilities: [attached({ power: 3 }), attached({ keywords: [KEYWORD.MENACE], condition: { hostMatches: legendary } })],
    abilities: [equip(2)],
  },
  "Gimli's Fury": {
    target: TARGET.CREATURE,
    effects: [pump(3, 2), grant([KEYWORD.TRAMPLE], { condition: { targetMatches: legendary } })],
  },
  'Gimli, Counter of Kills': {
    keywords: [KEYWORD.TRAMPLE],
    triggeredAbilities: [when(TRIGGER.CREATURE_DIES, "Whenever a creature an opponent controls dies, Gimli deals 1 damage to that creature's controller.", [
      damage(1, { affected: AFFECTED.SUBJECT_CONTROLLER }),
    ], { filter: { controller: 'opponent' } })],
  },
  'Glorfindel, Dauntless Rescuer': {
    triggeredAbilities: [when(TRIGGER.SCRY, 'Whenever you scry, choose one and Glorfindel gets +1/+1 until end of turn.', [], {
      modes: [
        { text: 'Glorfindel must be blocked this turn if able.', effects: [grant([KEYWORD.MUST_BE_BLOCKED], source), pump(1, 1, source)] },
        {
          text: "Glorfindel can't be blocked by more than one creature each combat this turn.",
          effects: [grant([KEYWORD.MAX_ONE_BLOCKER], source), pump(1, 1, source)],
        },
      ],
    })],
  },
  'Glorious Gale': {
    target: TARGET.CREATURE_SPELL,
    effects: [{ type: EFFECT.COUNTER_SPELL }, { ...ringTempts, condition: { targetMatches: legendary } }],
  },
  'Goblin Fireleaper': {
    abilities: [ability('{1}{R}: This creature gets +1/+0 until end of turn.', { mana: { generic: 1, R: 1 } }, [pump(1, 0, source)])],
    triggeredAbilities: [when(TRIGGER.DIES, 'When this creature dies, it deals damage equal to its power to target creature an opponent controls.', [
      damage(1, { per: { of: 'powerOf', who: 'subject' } }),
    ], { target: TARGET.CREATURE_OPPONENT_CONTROLS })],
  },
  'Gollum, Patient Plotter': {
    triggeredAbilities: [when(TRIGGER.LEAVES_BATTLEFIELD, 'When Gollum leaves the battlefield, the Ring tempts you.', [ringTempts])],
    graveyardAbilities: [ability('{B}, Sacrifice a creature: Return this card from your graveyard to your hand. Activate only as a sorcery.',
      { mana: { B: 1 }, sacrifice: TARGET.CREATURE }, [{ type: EFFECT.RETURN_SOURCE_FROM_GRAVEYARD, to: 'hand' }], { timing: SORCERY_SPEED })],
  },
  "Gollum's Bite": {
    target: TARGET.CREATURE,
    effects: [pump(-2, -2)],
    graveyardAbilities: [ability('{3}{B}, Exile this card from your graveyard: The Ring tempts you. Activate only as a sorcery.',
      { mana: { generic: 3, B: 1 }, exileSelfFromGraveyard: true }, [ringTempts], { timing: SORCERY_SPEED })],
  },
  'Gorbag of Minas Morgul': {
    triggeredAbilities: [when(TRIGGER.CREATURE_DEALS_COMBAT_DAMAGE_TO_PLAYER, 'Whenever a Goblin or Orc you control deals combat damage to a player, you may sacrifice it. When you do, choose one —', [
      {
        type: EFFECT.MAY,
        text: 'Sacrifice it?',
        effects: [
          { type: EFFECT.SACRIFICE, affected: AFFECTED.YOU, subjectOnly: true, filter: {} },
          reflexive({
            text: 'Choose one — Draw a card; or Create a Treasure token.',
            modes: [{ text: 'Draw a card.', effects: [draw(1)] }, { text: 'Create a Treasure token.', effects: [treasure()] }],
          }, { condition: { youSacrificed: true } }),
        ],
      },
    ], { filter: goblinOrOrc })],
  },
  'Gothmog, Morgul Lieutenant': {
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When Gothmog enters, amass Orcs 1.', [amass(1)])],
    staticAbilities: [anthem({ keywords: [KEYWORD.DEATHTOUCH], filter: { token: true } })],
  },
  'Great Hall of the Citadel': {
    abilities: [
      tapForC,
      ability('{1}, {T}: Add two mana in any combination of colors. Spend this mana only to cast legendary spells.',
        { mana: { generic: 1 }, tap: true }, [{ type: EFFECT.ADD_MANA, anyCombination: 2, restriction: 'legendary' }]),
    ],
  },
  'Gríma Wormtongue': {
    staticAbilities: [{ rule: 'opponentsCantGainLife' }],
    abilities: [ability('{T}, Sacrifice another creature: Target player loses 1 life. If the sacrificed creature was legendary, amass Orcs 2.',
      { tap: true, sacrifice: { kind: TARGET.CREATURE, other: true } }, [loseLife(1, { affected: AFFECTED.TARGET }), amass(2, { condition: { sacrificedMatches: legendary } })], {
        target: TARGET.PLAYER,
      })],
  },
  'Grishnákh, Brash Instigator': {
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, "When Grishnákh enters, amass Orcs 2. When you do, until end of turn, gain control of target nonlegendary creature an opponent controls with power less than or equal to the amassed Army's power. Untap that creature. It gains haste until end of turn.", [
      amass(2),
      reflexive({
        target: target(TARGET.CREATURE_OPPONENT_CONTROLS, { nonlegendary: true }, { powerAtMostAmassedArmy: true }),
        effects: [{ type: EFFECT.GAIN_CONTROL, untilEndOfTurn: true }, { type: EFFECT.UNTAP }, grant([KEYWORD.HASTE])],
      }),
    ])],
  },
  'Grond, the Gatebreaker': {
    keywords: [KEYWORD.TRAMPLE],
    staticAbilities: [self({ addTypes: [CREATURE], condition: { all: [{ yourTurn: true }, youControl({ subtypes: ['Army'] })] } })],
    abilities: [ability('Crew 3', { tapCreatures: { power: 3 } }, [{ type: EFFECT.BECOME_CREATURE, ...source }], { id: 'crew' })],
  },
  'Gwaihir the Windlord': {
    costReduction: { amount: 2, condition: { drawnAtLeast: 2 } },
    keywords: [KEYWORD.FLYING, KEYWORD.VIGILANCE],
    staticAbilities: [anthem({ keywords: [KEYWORD.VIGILANCE], other: true, subtypes: ['Bird'] })],
  },
  'Haradrim Spearmaster': {
    keywords: [KEYWORD.REACH],
    triggeredAbilities: [when(TRIGGER.BEGINNING_OF_COMBAT, 'At the beginning of combat on your turn, another target creature you control gets +1/+0 until end of turn.', [pump(1, 0)], {
      target: TARGET.CREATURE_YOU_CONTROL, targetOther: true,
    })],
  },
  'Haunt of the Dead Marshes': {
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When this creature enters, scry 1.', [scry(1)])],
    graveyardAbilities: [ability('{2}{B}: Return this card from your graveyard to the battlefield tapped. Activate only if you control a legendary creature.',
      { mana: { generic: 2, B: 1 } }, [{ type: EFFECT.RETURN_SOURCE_FROM_GRAVEYARD, to: 'battlefield', tapped: true }], { activationCondition: controlsLegendaryCreature })],
  },
  "Hobbit's Sting": {
    target: TARGET.CREATURE,
    effects: [damage(1, { per: { sum: [{ of: 'creatures' }, { of: 'permanents', filter: { subtypes: ['Food'] } }] } })],
  },
  'Horses of the Bruinen': {
    targets: [upTo(TARGET.CREATURE), upTo(TARGET.CREATURE)],
    effects: [{ type: EFFECT.RETURN_TO_HAND }, scry(1), ringTempts],
  },
  'Improvised Club': {
    additionalCost: { sacrifice: { kind: TARGET.PERMANENT, filter: { types: [ARTIFACT, CREATURE] } } },
    target: TARGET.ANY,
    effects: [damage(4)],
  },
  'Ioreth of the Healing House': {
    abilities: [
      ability('{T}: Untap another target permanent.', { tap: true }, [{ type: EFFECT.UNTAP }], { target: target(TARGET.PERMANENT, null, { other: true }) }),
      ability('{T}: Untap two other target legendary creatures.', { tap: true }, [{ type: EFFECT.UNTAP }], {
        targets: [target(TARGET.CREATURE, legendary, { other: true }), target(TARGET.CREATURE, legendary, { other: true })],
      }),
    ],
  },
  'Landroval, Horizon Witness': {
    keywords: [KEYWORD.FLYING],
    triggeredAbilities: [when(TRIGGER.ATTACKS_WITH, 'Whenever two or more creatures you control attack a player, target attacking creature without flying gains flying until end of turn.', [
      grant([KEYWORD.FLYING]),
    ], { filter: {}, minCount: 2, target: target(TARGET.ATTACKING_CREATURE, { withoutKeywords: [KEYWORD.FLYING] }) })],
  },
  'Lash of the Balrog': {
    additionalCost: { anyOf: [{ sacrifice: TARGET.CREATURE }, { mana: { generic: 4 } }] },
    target: TARGET.CREATURE,
    effects: [{ type: EFFECT.DESTROY }],
  },
  'Legolas, Counter of Kills': {
    keywords: [KEYWORD.REACH],
    triggeredAbilities: [
      when(TRIGGER.SCRY, 'Whenever you scry, if Legolas is tapped, you may untap it. Do this only once each turn.', [
        { type: EFFECT.UNTAP, ...source, mark: 'untapOnce' },
      ], { optional: true, condition: { all: [{ sourceTapped: true }, { unmarked: 'untapOnce' }] } }),
      when(TRIGGER.CREATURE_DIES, 'Whenever a creature an opponent controls dies, put a +1/+1 counter on Legolas.', [counters(1, source)], {
        filter: { controller: 'opponent' },
      }),
    ],
  },
  Lembas: {
    triggeredAbilities: [
      when(TRIGGER.ENTERS_BATTLEFIELD, 'When this artifact enters, scry 1, then draw a card.', [scry(1), draw(1)]),
      when(TRIGGER.PUT_INTO_GRAVEYARD, 'When this artifact is put into a graveyard from the battlefield, its owner shuffles it into their library.', [
        { type: EFFECT.SHUFFLE_SOURCE_INTO_LIBRARY },
      ]),
    ],
    abilities: [ability('{2}, {T}, Sacrifice this artifact: You gain 3 life.', { mana: { generic: 2 }, tap: true, sacrificeSelf: true }, [gainLife(3)])],
  },
  'Long List of the Ents': {
    triggeredAbilities: [chapter([1, 2, 3, 4, 5, 6], "I, II, III, IV, V, VI — Note a creature type that hasn't been noted for this Saga. When you next cast a creature spell of that type this turn, that creature enters with an additional +1/+1 counter on it.", [
      { type: EFFECT.NOTE_CREATURE_TYPE },
    ])],
  },
  'March from the Black Gate': {
    triggeredAbilities: [
      when(TRIGGER.ENTERS_BATTLEFIELD, 'When this enchantment enters, amass Orcs 1.', [amass(1)]),
      when(TRIGGER.CREATURE_ATTACKS, 'Whenever an Army you control attacks, amass Orcs 1.', [amass(1)], { filter: { subtypes: ['Army'] } }),
    ],
  },
  'Mauhúr, Uruk-hai Captain': {
    keywords: [KEYWORD.MENACE],
    staticAbilities: [{ rule: 'morePlusOneCounters' }],
  },
  'Meneldor, Swift Savior': {
    keywords: [KEYWORD.FLYING],
    triggeredAbilities: [when(TRIGGER.DEALS_COMBAT_DAMAGE_TO_PLAYER, 'Whenever Meneldor deals combat damage to a player, exile up to one target creature you own, then return it to the battlefield under your control.', [
      { type: EFFECT.FLICKER },
    ], { target: upTo(TARGET.CREATURE, { owner: 'you' }) })],
  },
  'Meriadoc Brandybuck': {
    triggeredAbilities: [when(TRIGGER.ATTACKS_WITH, 'Whenever one or more Halflings you control attack a player, create a Food token.', [food()], {
      filter: { subtypes: ['Halfling'] },
    })],
  },
  'Mirkwood Bats': {
    keywords: [KEYWORD.FLYING],
    triggeredAbilities: [when([TRIGGER.TOKEN_CREATED, TRIGGER.TOKEN_SACRIFICED], 'Whenever you create or sacrifice a token, each opponent loses 1 life.', [loseLife(1, eachOpponent)])],
  },
  'Mirkwood Spider': {
    keywords: [KEYWORD.DEATHTOUCH],
    triggeredAbilities: [when(TRIGGER.ATTACKS, 'Whenever this creature attacks, target legendary creature you control gains deathtouch until end of turn.', [
      grant([KEYWORD.DEATHTOUCH]),
    ], { target: target(TARGET.CREATURE_YOU_CONTROL, legendary) })],
  },
  'Mirror of Galadriel': {
    abilities: [ability('{5}, {T}: Scry 1, then draw a card. This ability costs {1} less to activate for each legendary creature you control.',
      { mana: { generic: 5 }, tap: true }, [scry(1), draw(1)], { costReduction: { per: { of: 'creatures', filter: legendary } } })],
  },
  'Mordor Trebuchet': {
    keywords: [KEYWORD.DEFENDER],
    triggeredAbilities: [when(TRIGGER.ATTACKS_WITH, "Whenever you attack with one or more Goblins and/or Orcs, create a 2/1 colorless Construct artifact creature token with flying named Ballistic Boulder that's tapped and attacking. Sacrifice that token at end of combat.", [
      tokens({ name: 'Ballistic Boulder', types: [ARTIFACT, CREATURE], subtypes: ['Construct'], colors: [], power: 2, toughness: 1, keywords: [KEYWORD.FLYING] }, 1, {
        tapped: true, attacking: true, sacrificeAtEndOfCombat: true,
      }),
    ], { filter: goblinOrOrc })],
  },
  'Morgul-Knife Wound': {
    enchant: TARGET.CREATURE,
    staticAbilities: [attached({
      power: -3,
      grantTriggers: [{
        id: 'morgulKnife',
        trigger: TRIGGER.UPKEEP,
        text: 'At the beginning of your upkeep, exile this creature unless you pay 2 life.',
        effects: [{ type: EFFECT.UNLESS_PAID, cost: { life: 2 }, otherwise: [{ type: EFFECT.EXILE, ...source }] }],
      }],
    })],
  },
  'Mushroom Watchdogs': {
    abilities: [ability('Sacrifice a Food: Put a +1/+1 counter on this creature. It gains vigilance until end of turn. Activate only as a sorcery.',
      { sacrifice: foodSpec }, [counters(1, source), grant([KEYWORD.VIGILANCE], source)], { timing: SORCERY_SPEED })],
  },
  'Nasty End': {
    additionalCost: { sacrifice: TARGET.CREATURE },
    effects: [ifThen({ sacrificedMatches: legendary }, [draw(3)], [draw(2)])],
  },
  'Nazgûl': {
    keywords: [KEYWORD.DEATHTOUCH],
    triggeredAbilities: [
      when(TRIGGER.ENTERS_BATTLEFIELD, 'When this creature enters, the Ring tempts you.', [ringTempts]),
      when(TRIGGER.RING_TEMPTS, 'Whenever the Ring tempts you, put a +1/+1 counter on each Wraith you control.', [
        counters(1, { ...yourCreatures, filter: { subtypes: ['Wraith'] } }),
      ]),
    ],
  },
  'Nimble Hobbit': {
    triggeredAbilities: [when(TRIGGER.ATTACKS, 'Whenever this creature attacks, you may sacrifice a Food or pay {2}{W}. When you do, tap target creature an opponent controls.', [
      { type: EFFECT.OPTIONAL_COST, options: [{ sacrifice: foodSpec }, { mana: { generic: 2, W: 1 } }] },
      reflexive({ target: TARGET.CREATURE_OPPONENT_CONTROLS, effects: [{ type: EFFECT.TAP }] }, { condition: { paid: true } }),
    ])],
  },
  'Now for Wrath, Now for Ruin!': {
    effects: [counters(1, yourCreatures), grant([KEYWORD.VIGILANCE], yourCreatures), ringTempts],
  },
  'Oath of the Grey Host': {
    triggeredAbilities: [
      chapter([1], 'I — You and target opponent each create a Food token.', [food(1, { affected: AFFECTED.YOU_AND_TARGET })], { target: TARGET.OPPONENT }),
      chapter([2], 'II — Each opponent loses 3 life. Create a Treasure token.', [loseLife(3, eachOpponent), treasure()]),
      chapter([3], 'III — Create three tapped 1/1 white Spirit creature tokens with flying.', [tokens(spirit, 3, { tapped: true })]),
    ],
  },
  'Old Man Willow': {
    power: 0,
    toughness: 0,
    staticAbilities: [{ affected: AFFECTED.SOURCE, setPowerToughness: { of: 'permanents', filter: { types: [LAND] } } }],
    triggeredAbilities: [when(TRIGGER.ATTACKS, 'Whenever Old Man Willow attacks, you may sacrifice another creature or a token. When you do, target creature an opponent controls gets -2/-2 until end of turn.', [
      { type: EFFECT.OPTIONAL_COST, options: [{ sacrifice: { kind: TARGET.PERMANENT, filter: { anyOf: [{ types: [CREATURE] }, { token: true }] }, other: true } }] },
      reflexive({ target: TARGET.CREATURE_OPPONENT_CONTROLS, effects: [pump(-2, -2)] }, { condition: { paid: true } }),
    ])],
  },
  Oliphaunt: {
    keywords: [KEYWORD.TRAMPLE],
    triggeredAbilities: [when(TRIGGER.ATTACKS, 'Whenever this creature attacks, another target creature you control gets +2/+0 and gains trample until end of turn.', [
      pump(2, 0, { keywords: [KEYWORD.TRAMPLE] }),
    ], { target: TARGET.CREATURE_YOU_CONTROL, targetOther: true })],
    handAbilities: [{
      id: 'cycling', text: 'Mountaincycling {1}', cost: { mana: { generic: 1 }, discardSelf: true },
      effects: [{ type: EFFECT.SEARCH_LIBRARY, filter: { subtypes: ['Mountain'] }, count: 1, destination: 'hand' }],
    }],
  },
  'Olog-hai Crusher': {
    keywords: [KEYWORD.TRAMPLE],
    staticAbilities: [self({ keywords: [KEYWORD.CANT_BLOCK], condition: { not: youControl(goblinOrOrc) } })],
  },
  'Orcish Medicine': {
    target: TARGET.CREATURE,
    effects: [{ type: EFFECT.PUMP, keywordChoice: [KEYWORD.LIFELINK, KEYWORD.INDESTRUCTIBLE] }, amass(1)],
  },
  'Pelargir Survivor': {
    abilities: [
      ability('{T}: Add one mana of any color. Spend this mana only to cast an instant or sorcery spell.', { tap: true }, [
        { type: EFFECT.ADD_MANA, anyCombination: 1, restriction: 'instantOrSorcery' },
      ]),
      ability('{5}{U}, {T}: Target player mills three cards.', { mana: { generic: 5, U: 1 }, tap: true }, [{ type: EFFECT.MILL, count: 3, affected: AFFECTED.TARGET }], {
        target: TARGET.PLAYER,
      }),
    ],
  },
  'Peregrin Took': {
    staticAbilities: [{ rule: 'extraFoodToken' }],
    abilities: [ability('Sacrifice three Foods: Draw a card.', { sacrifice: { ...foodSpec, count: 3 } }, [draw(1)])],
  },
  "Pippin's Bravery": {
    target: TARGET.CREATURE,
    effects: [
      { type: EFFECT.OPTIONAL_COST, options: [{ sacrifice: foodSpec }] },
      ifThen({ paid: true }, [pump(4, 4)], [pump(2, 2)]),
    ],
  },
  'Quickbeam, Upstart Ent': {
    triggeredAbilities: [when(TRIGGER.CREATURE_ENTERS, 'Whenever Quickbeam or another Treefolk you control enters, up to two target creatures each get +2/+2 and gain trample until end of turn.', [
      pump(2, 2, { keywords: [KEYWORD.TRAMPLE] }),
    ], { filter: { subtypes: ['Treefolk'] }, targets: [upTo(TARGET.CREATURE), upTo(TARGET.CREATURE)] })],
  },
  'Rally at the Hornburg': {
    effects: [tokens(soldier, 2), grant([KEYWORD.HASTE], { ...yourCreatures, filter: { subtypes: ['Human'] } })],
  },
  Reprieve: {
    target: TARGET.SPELL,
    effects: [{ type: EFFECT.RETURN_SPELL_TO_HAND }, draw(1)],
  },
  Ringsight: {
    effects: [ringTempts, { type: EFFECT.SEARCH_LIBRARY, filter: {}, sharesColorWithLegendary: true, count: 1, destination: 'hand' }],
  },
  'Rise of the Witch-king': {
    effects: [
      { type: EFFECT.SACRIFICE, affected: AFFECTED.EACH_PLAYER },
      { type: EFFECT.RETURN_FROM_GRAVEYARD, choose: { notTypes: [INSTANT, SORCERY] }, to: 'battlefield', condition: { youSacrificed: true } },
    ],
  },
  'Rosie Cotton of South Lane': {
    triggeredAbilities: [
      when(TRIGGER.ENTERS_BATTLEFIELD, 'When Rosie Cotton enters, create a Food token.', [food()]),
      when(TRIGGER.TOKEN_CREATED, 'Whenever you create a token, put a +1/+1 counter on target creature you control other than Rosie Cotton.', [counters(1)], {
        target: TARGET.CREATURE_YOU_CONTROL, targetOther: true,
      }),
    ],
  },
  'Rush the Room': {
    target: TARGET.CREATURE,
    effects: [pump(1, 0, { keywords: [KEYWORD.FIRST_STRIKE] }), grant([KEYWORD.HASTE], { condition: { targetMatches: goblinOrOrc } })],
  },
  'Samwise the Stouthearted': {
    keywords: [KEYWORD.FLASH],
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When Samwise enters, choose up to one target permanent card in your graveyard that was put there from the battlefield this turn. Return it to your hand. Then the Ring tempts you.', [
      { type: EFFECT.RETURN_FROM_GRAVEYARD }, ringTempts,
    ], { target: upTo(TARGET.PERMANENT_CARD_IN_YOUR_GRAVEYARD, { diedThisTurn: true }) })],
  },
  'Saruman the White': {
    keywords: [KEYWORD.WARD],
    ward: { mana: { generic: 2 } },
    triggeredAbilities: [when(TRIGGER.SPELL_CAST, 'Whenever you cast your second spell each turn, amass Orcs 2.', [amass(2)], { filter: { nthThisTurn: 2 } })],
  },
  'Second Breakfast': {
    targets: [upTo(TARGET.CREATURE), upTo(TARGET.CREATURE)],
    effects: [pump(2, 1), food()],
  },
  'Shadowfax, Lord of Horses': {
    staticAbilities: [anthem({ keywords: [KEYWORD.HASTE], subtypes: ['Horse'] })],
    triggeredAbilities: [when(TRIGGER.ATTACKS, 'Whenever Shadowfax attacks, you may put a creature card with lesser power from your hand onto the battlefield tapped and attacking.', [
      { type: EFFECT.PUT_FROM_HAND_ONTO_BATTLEFIELD, filter: { types: [CREATURE] }, lesserPowerThanSource: true, tapped: true, attacking: true },
    ])],
  },
  'Shire Scarecrow': {
    keywords: [KEYWORD.DEFENDER],
    abilities: [ability('{1}: Add one mana of any color. Activate only once each turn.', { mana: { generic: 1 } }, [{ type: EFFECT.ADD_MANA, anyColor: 1 }], {
      oncePerTurn: true,
    })],
  },
  'Shire Shirriff': {
    keywords: [KEYWORD.VIGILANCE],
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When this creature enters, you may sacrifice a token. When you do, exile target creature an opponent controls until this creature leaves the battlefield.', [
      { type: EFFECT.OPTIONAL_COST, options: [{ sacrifice: { kind: TARGET.PERMANENT, filter: { token: true } } }] },
      reflexive({ target: TARGET.CREATURE_OPPONENT_CONTROLS, effects: [{ type: EFFECT.EXILE_UNTIL_SOURCE_LEAVES }] }, { condition: { paid: true } }),
    ])],
  },
  'Shortcut to Mushrooms': {
    triggeredAbilities: [
      when(TRIGGER.ENTERS_BATTLEFIELD, 'When this enchantment enters, the Ring tempts you.', [ringTempts]),
      when(TRIGGER.END_STEP, 'At the beginning of your end step, if a permanent you controlled left the battlefield this turn, put a +1/+1 counter on target creature you control.', [
        counters(1),
      ], { condition: { permanentLeftThisTurn: true }, target: TARGET.CREATURE_YOU_CONTROL }),
    ],
  },
  'Slip On the Ring': {
    target: target(TARGET.CREATURE, { owner: 'you' }),
    effects: [{ type: EFFECT.FLICKER }, ringTempts],
  },
  'Smite the Deathless': {
    target: TARGET.CREATURE,
    effects: [damage(3), { type: EFFECT.PUMP, removeKeywords: [KEYWORD.INDESTRUCTIBLE], exileIfDies: true }],
  },
  'Snarling Warg': {
    keywords: [KEYWORD.MENACE],
    staticAbilities: [self({ power: 1, condition: youControl(goblinOrOrc) })],
  },
  'Stone of Erech': {
    staticAbilities: [{ rule: 'exileOpponentsDyingCreatures' }],
    abilities: [ability("{2}, {T}, Sacrifice Stone of Erech: Exile target player's graveyard. Draw a card.", { mana: { generic: 2 }, tap: true, sacrificeSelf: true }, [
      { type: EFFECT.EXILE_GRAVEYARD, affected: AFFECTED.TARGET }, draw(1),
    ], { target: TARGET.PLAYER })],
  },
  'Strider, Ranger of the North': {
    triggeredAbilities: [when(TRIGGER.LAND_ENTERS, 'Landfall — Whenever a land you control enters, target creature gets +1/+1 until end of turn. Then if that creature has power 4 or greater, it gains first strike until end of turn.', [
      pump(1, 1), grant([KEYWORD.FIRST_STRIKE], { condition: { targetMatches: { power: { min: 4 } } } }),
    ], { target: TARGET.CREATURE })],
  },
  'Surrounded by Orcs': {
    target: TARGET.PLAYER,
    effects: [amass(3), { type: EFFECT.MILL, count: 1, affected: AFFECTED.TARGET, per: { of: 'amassedArmyPower' } }],
  },
  'Tale of Tinúviel': {
    triggeredAbilities: [
      chapter([1], 'I — Target creature you control gains indestructible for as long as you control this Saga.', [
        grant([KEYWORD.INDESTRUCTIBLE], { whileSourceControlled: true }),
      ], { target: TARGET.CREATURE_YOU_CONTROL }),
      chapter([2], 'II — Return target creature card from your graveyard to the battlefield.', [{ type: EFFECT.RETURN_FROM_GRAVEYARD, to: 'battlefield' }], {
        target: target(TARGET.CARD_IN_YOUR_GRAVEYARD, { types: [CREATURE] }),
      }),
      chapter([3], 'III — Up to two target creatures you control each gain lifelink until end of turn.', [grant([KEYWORD.LIFELINK])], {
        targets: [upTo(TARGET.CREATURE_YOU_CONTROL), upTo(TARGET.CREATURE_YOU_CONTROL)],
      }),
    ],
  },
  'The Bath Song': {
    triggeredAbilities: [
      chapter([1, 2], 'I, II — Draw two cards, then discard a card.', [draw(2), discard(1)]),
      chapter([3], 'III — Shuffle any number of target cards from your graveyard into your library. Add {U}{U}.', [
        { type: EFFECT.SHUFFLE_INTO_LIBRARY, filter: {} }, { type: EFFECT.ADD_MANA, mana: { U: 2 } },
      ]),
    ],
  },
  'The Grey Havens': {
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When The Grey Havens enters, scry 1.', [scry(1)])],
    abilities: [
      tapForC,
      { ...tapForAny, text: '{T}: Add one mana of any color among legendary creature cards in your graveyard.', effects: [{ type: EFFECT.ADD_MANA, anyColor: 1, colorsFrom: 'legendaryCreatureCardsInYourGraveyard' }] },
    ],
  },
  'The Mouth of Sauron': {
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, "When The Mouth of Sauron enters, target player mills three cards. Then amass Orcs X, where X is the number of instant and sorcery cards in that player's graveyard.", [
      { type: EFFECT.MILL, count: 3, affected: AFFECTED.TARGET },
      amass(1, { per: { of: 'cards', whose: 'target', filter: { types: [INSTANT, SORCERY] } } }),
    ], { target: TARGET.PLAYER })],
  },
  'The Torment of Gollum': {
    target: TARGET.OPPONENT,
    effects: [{ type: EFFECT.REVEAL_HAND_DISCARD, filter: { notTypes: [LAND] } }, amass(2)],
  },
  'Treason of Isengard': {
    target: upTo(TARGET.CARD_IN_YOUR_GRAVEYARD, { types: [INSTANT, SORCERY] }),
    effects: [{ type: EFFECT.PUT_INTO_LIBRARY, position: 1 }, amass(2)],
  },
  'Uglúk of the White Hand': {
    triggeredAbilities: [when(TRIGGER.CREATURE_DIES, 'Whenever another creature you control dies, put a +1/+1 counter on Uglúk. If that creature was a Goblin or Orc, put two +1/+1 counters on Uglúk instead.', [
      ifThen({ subjectMatches: goblinOrOrc }, [counters(2, source)], [counters(1, source)]),
    ], { filter: { other: true } })],
  },
  'Voracious Fell Beast': {
    keywords: [KEYWORD.FLYING],
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When this creature enters, each opponent sacrifices a creature of their choice. Create a Food token for each creature sacrificed this way.', [
      { type: EFFECT.SACRIFICE, ...eachOpponent }, food(1, { per: { of: 'sacrificedCount' } }),
    ])],
  },
  'Warbeast of Gorgoroth': {
    triggeredAbilities: [when(TRIGGER.CREATURE_DIES, 'Whenever this creature or another creature you control with power 4 or greater dies, amass Orcs 2.', [amass(2)], {
      filter: { power: { min: 4 } },
    })],
  },
  "Wizard's Rockets": {
    entersTapped: true,
    abilities: [ability('{X}, {T}, Sacrifice this artifact: Add X mana in any combination of colors.', { mana: { X: 1 }, tap: true, sacrificeSelf: true }, [
      { type: EFFECT.ADD_MANA, anyCombination: 1, per: { of: 'x' } },
    ])],
    triggeredAbilities: [when(TRIGGER.PUT_INTO_GRAVEYARD, 'When this artifact is put into a graveyard from the battlefield, draw a card.', [draw(1)])],
  },
  'Wose Pathfinder': {
    abilities: [
      tapForAny,
      ability('{6}{G}, {T}: Another target creature gets +3/+3 and gains trample until end of turn.', { mana: { generic: 6, G: 1 }, tap: true }, [
        pump(3, 3, { keywords: [KEYWORD.TRAMPLE] }),
      ], { target: target(TARGET.CREATURE, null, { other: true }) }),
    ],
  },
  'You Cannot Pass!': {
    target: target(TARGET.CREATURE, { blockedByOrBlockedLegendaryThisTurn: true }),
    effects: [{ type: EFFECT.DESTROY }],
  },
  // Rares and mythics
  'Andúril, Flame of the West': {
    staticAbilities: [attached({ power: 3, toughness: 1 })],
    triggeredAbilities: [when(TRIGGER.EQUIPPED_ATTACKS, 'Whenever equipped creature attacks, create two tapped 1/1 white Spirit creature tokens with flying. If that creature is legendary, instead create two of those tokens that are tapped and attacking.', [
      ifThen({ subjectMatches: legendary }, [tokens(spirit, 2, { tapped: true, attacking: true })], [tokens(spirit, 2, { tapped: true })]),
    ])],
    abilities: [equip(2)],
  },
  'Aragorn, the Uniter': {
    triggeredAbilities: [
      when(TRIGGER.SPELL_CAST, 'Whenever you cast a white spell, create a 1/1 white Human Soldier creature token.', [tokens(soldier)], { filter: { colors: ['W'] } }),
      when(TRIGGER.SPELL_CAST, 'Whenever you cast a blue spell, scry 2.', [scry(2)], { filter: { colors: ['U'] } }),
      when(TRIGGER.SPELL_CAST, 'Whenever you cast a red spell, Aragorn deals 3 damage to target opponent.', [damage(3)], { filter: { colors: ['R'] }, target: TARGET.OPPONENT }),
      when(TRIGGER.SPELL_CAST, 'Whenever you cast a green spell, target creature gets +4/+4 until end of turn.', [pump(4, 4)], { filter: { colors: ['G'] }, target: TARGET.CREATURE }),
    ],
  },
  'Barad-dûr': {
    entersTappedUnless: controlsLegendaryCreature,
    abilities: [
      tapFor('B'),
      ability('{X}{X}{B}, {T}: Amass Orcs X. Activate only if a creature died this turn.', { mana: { X: 2, B: 1 }, tap: true }, [amass(1, { per: { of: 'x' } })], {
        activationCondition: { anyCreatureDiedThisTurn: true },
      }),
    ],
  },
  'Boromir, Warden of the Tower': {
    keywords: [KEYWORD.VIGILANCE],
    triggeredAbilities: [when(TRIGGER.SPELL_CAST, 'Whenever an opponent casts a spell, if no mana was spent to cast it, counter that spell.', [
      { type: EFFECT.COUNTER_SPELL, affected: AFFECTED.SUBJECT_SPELL },
    ], { filter: { controller: 'opponent' }, condition: { noManaSpent: true } })],
    abilities: [ability('Sacrifice Boromir: Creatures you control gain indestructible until end of turn. The Ring tempts you.', { sacrificeSelf: true }, [
      grant([KEYWORD.INDESTRUCTIBLE], yourCreatures), ringTempts,
    ])],
  },
  'Call of the Ring': {
    triggeredAbilities: [
      when(TRIGGER.UPKEEP, 'At the beginning of your upkeep, the Ring tempts you.', [ringTempts]),
      when(TRIGGER.RING_TEMPTS, 'Whenever you choose a creature as your Ring-bearer, you may pay 2 life. If you do, draw a card.', [
        { type: EFFECT.OPTIONAL_COST, options: [{ life: 2 }] }, draw(1, { condition: { paid: true } }),
      ], { condition: { ringBearerChosen: true } }),
    ],
  },
  'Dawn of a New Age': {
    entersWithCounters: { counter: COUNTER.HOPE, per: { of: 'creatures' } },
    triggeredAbilities: [when(TRIGGER.END_STEP, 'At the beginning of your end step, remove a hope counter from this enchantment. If you do, draw a card. Then if this enchantment has no hope counters on it, sacrifice it and you gain 4 life.', [
      { type: EFFECT.REMOVE_COUNTERS, counter: COUNTER.HOPE, count: 1, ...source },
      draw(1, { condition: { paid: true } }),
      ifThen({ sourceCounters: { counter: COUNTER.HOPE, max: 0 } }, [{ type: EFFECT.SACRIFICE, affected: AFFECTED.YOU, sourceOnly: true, filter: {} }, gainLife(4)]),
    ])],
  },
  'Delighted Halfling': {
    abilities: [
      tapForC,
      ability("{T}: Add one mana of any color. Spend this mana only to cast a legendary spell, and that spell can't be countered.", { tap: true }, [
        { type: EFFECT.ADD_MANA, anyCombination: 1, restriction: 'legendary', uncounterable: true },
      ]),
    ],
  },
  'Fall of Gil-galad': {
    triggeredAbilities: [
      chapter([1], 'I — Scry 2.', [scry(2)]),
      chapter([2], 'II — Put two +1/+1 counters on target creature you control.', [counters(2)], { target: TARGET.CREATURE_YOU_CONTROL }),
      chapter([3], 'III — Until end of turn, target creature you control gains "When this creature dies, draw two cards." Then that creature fights up to one other target creature.', [
        { type: EFFECT.PUMP, targetIndex: 0, grantTriggers: [{ id: 'gilGaladDraw', trigger: TRIGGER.DIES, text: 'When this creature dies, draw two cards.', effects: [draw(2)] }] },
        { type: EFFECT.FIGHT },
      ], { targets: [TARGET.CREATURE_YOU_CONTROL, upTo(TARGET.CREATURE)] }),
    ],
  },
  'Flame of Anor': {
    modes: [
      { text: 'Target player draws two cards.', target: TARGET.PLAYER, effects: [draw(2, { affected: AFFECTED.TARGET })] },
      { text: 'Destroy target artifact.', target: TARGET.ARTIFACT, effects: [{ type: EFFECT.DESTROY }] },
      { text: 'Flame of Anor deals 5 damage to target creature.', target: TARGET.CREATURE, effects: [damage(5)] },
    ],
    chooseTwo: youControl({ subtypes: ['Wizard'] }),
  },
  'Flowering of the White Tree': {
    staticAbilities: [
      anthem({ power: 2, toughness: 1, keywords: [KEYWORD.WARD], ward: { mana: { generic: 1 } }, filter: legendary }),
      anthem({ power: 1, toughness: 1, filter: { nonlegendary: true } }),
    ],
  },
  'Galadriel of Lothlórien': {
    triggeredAbilities: [
      when(TRIGGER.RING_TEMPTS, 'Whenever the Ring tempts you, if you chose a creature other than Galadriel as your Ring-bearer, scry 3.', [scry(3)], {
        condition: { chosenOtherThanSource: true },
      }),
      when(TRIGGER.SCRY, 'Whenever you scry, you may reveal the top card of your library. If a land card is revealed this way, put it onto the battlefield tapped.', [
        { type: EFFECT.REVEAL_TOP }, { type: EFFECT.PUT_REVEALED_ONTO_BATTLEFIELD, tapped: true, condition: { revealedMatches: { types: [LAND] } } },
      ], { optional: true }),
    ],
  },
  'Gimli, Mournful Avenger': {
    staticAbilities: [self({ keywords: [KEYWORD.INDESTRUCTIBLE], condition: { creaturesDiedThisTurn: 2 } })],
    triggeredAbilities: [when(TRIGGER.CREATURE_DIES, "Whenever another creature you control dies, put a +1/+1 counter on Gimli. When this ability resolves for the third time this turn, Gimli fights up to one target creature you don't control.", [
      counters(1, source),
      reflexive({
        text: "When this ability resolves for the third time this turn, Gimli fights up to one target creature you don't control.",
        target: upTo(TARGET.CREATURE_OPPONENT_CONTROLS),
        effects: [{ type: EFFECT.FIGHT, withSource: true }],
      }, { condition: { resolvedThisTurn: 3 } }),
    ], { filter: { other: true } })],
  },
  'Glóin, Dwarf Emissary': {
    triggeredAbilities: [when(TRIGGER.SPELL_CAST, 'Whenever you cast a historic spell, create a Treasure token. This ability triggers only once each turn.', [treasure()], {
      filter: { historic: true }, oncePerTurn: true,
    })],
    abilities: [ability('{T}, Sacrifice a Treasure: Goad target creature.', { tap: true, sacrifice: { kind: TARGET.PERMANENT, filter: { subtypes: ['Treasure'] } } }, [
      { type: EFFECT.GOAD },
    ], { target: TARGET.CREATURE })],
  },
  'Horn of Gondor': {
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When Horn of Gondor enters, create a 1/1 white Human Soldier creature token.', [tokens(soldier)])],
    abilities: [ability('{3}, {T}: Create X 1/1 white Human Soldier creature tokens, where X is the number of Humans you control.', { mana: { generic: 3 }, tap: true }, [
      tokens(soldier, 1, { per: { of: 'creatures', filter: { subtypes: ['Human'] } } }),
    ])],
  },
  'Horn of the Mark': {
    triggeredAbilities: [when(TRIGGER.ATTACKS_WITH, 'Whenever two or more creatures you control attack a player, look at the top five cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.', [
      { type: EFFECT.LOOK_AT_TOP, count: 5, filter: { types: [CREATURE] }, max: 1 },
    ], { filter: {}, minCount: 2 })],
  },
  "Isildur's Fateful Strike": {
    target: TARGET.CREATURE,
    effects: [{ type: EFFECT.DESTROY }, { type: EFFECT.EXILE_HAND_EXCESS, keep: 4, affected: AFFECTED.TARGET_CONTROLLER }],
  },
  'Last March of the Ents': {
    cantBeCountered: true,
    effects: [draw(1, { per: { of: 'greatestToughness' } }), { type: EFFECT.PUT_FROM_HAND_ONTO_BATTLEFIELD, filter: { types: [CREATURE] }, any: true }],
  },
  'Legolas, Master Archer': {
    keywords: [KEYWORD.REACH],
    triggeredAbilities: [
      when(TRIGGER.SPELL_CAST, 'Whenever you cast a spell that targets Legolas, put a +1/+1 counter on Legolas.', [counters(1, source)], { filter: {}, targetsSource: true }),
      when(TRIGGER.SPELL_CAST, "Whenever you cast a spell that targets a creature you don't control, Legolas deals damage equal to its power to up to one target creature.", [
        damage(1, { per: { of: 'powerOf', who: 'source' } }),
      ], { filter: {}, targetsCreatureYouDontControl: true, target: upTo(TARGET.CREATURE) }),
    ],
  },
  'Lotho, Corrupt Shirriff': {
    triggeredAbilities: [when(TRIGGER.SPELL_CAST, 'Whenever a player casts their second spell each turn, you lose 1 life and create a Treasure token.', [loseLife(1), treasure()], {
      filter: { controller: 'any', nthThisTurn: 2 },
    })],
  },
  'Merry, Esquire of Rohan': {
    keywords: [KEYWORD.HASTE],
    staticAbilities: [self({ keywords: [KEYWORD.FIRST_STRIKE], condition: { sourceEquipped: true } })],
    triggeredAbilities: [when(TRIGGER.ATTACKS_WITH, 'Whenever you attack with Merry and another legendary creature, draw a card.', [draw(1)], {
      filter: legendary, minCount: 2, includesSource: true,
    })],
  },
  'Minas Tirith': {
    entersTappedUnless: controlsLegendaryCreature,
    abilities: [
      tapFor('W'),
      ability('{1}{W}, {T}: Draw a card. Activate only if you attacked with two or more creatures this turn.', { mana: { generic: 1, W: 1 }, tap: true }, [draw(1)], {
        activationCondition: { attackedWithAtLeast: 2 },
      }),
    ],
  },
  'Mines of Moria': {
    entersTappedUnless: controlsLegendaryCreature,
    abilities: [
      tapFor('R'),
      ability('{3}{R}, {T}, Exile three cards from your graveyard: Create two Treasure tokens.', { mana: { generic: 3, R: 1 }, tap: true, exileFromGraveyard: 3 }, [treasure(2)]),
    ],
  },
  'Mithril Coat': {
    keywords: [KEYWORD.FLASH, KEYWORD.INDESTRUCTIBLE],
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When Mithril Coat enters, attach it to target legendary creature you control.', [{ type: EFFECT.ATTACH }], {
      target: target(TARGET.CREATURE_YOU_CONTROL, legendary),
    })],
    staticAbilities: [attached({ keywords: [KEYWORD.INDESTRUCTIBLE] })],
    abilities: [equip(3)],
  },
  'Mount Doom': {
    abilities: [
      ability('{T}, Pay 1 life: Add {B} or {R}.', { tap: true, life: 1 }, [{ type: EFFECT.ADD_MANA, anyColor: 1, colorsFrom: ['B', 'R'] }]),
      ability('{1}{B}{R}, {T}: Mount Doom deals 1 damage to each opponent.', { mana: { generic: 1, B: 1, R: 1 }, tap: true }, [damage(1, eachOpponent)]),
      ability('{5}{B}{R}, {T}, Sacrifice Mount Doom and a legendary artifact: Choose up to two creatures, then destroy the rest. Activate only as a sorcery.', {
        mana: { generic: 5, B: 1, R: 1 }, tap: true, sacrificeSelf: true, sacrifice: { kind: TARGET.ARTIFACT, filter: legendary },
      }, [{ type: EFFECT.KEEP_AND_DESTROY_REST, keep: 2 }], { timing: SORCERY_SPEED }),
    ],
  },
  'One Ring to Rule Them All': {
    triggeredAbilities: [
      chapter([1], "I — The Ring tempts you, then each player mills cards equal to your Ring-bearer's power.", [
        ringTempts, { type: EFFECT.MILL, count: 1, affected: AFFECTED.EACH_PLAYER, per: { of: 'ringBearerPower' } },
      ]),
      chapter([2], 'II — Destroy all nonlegendary creatures.', [{ type: EFFECT.DESTROY, affected: AFFECTED.EACH_CREATURE, filter: { nonlegendary: true } }]),
      chapter([3], "III — Each opponent loses 1 life for each creature card in that player's graveyard.", [
        loseLife(1, { ...eachOpponent, perPlayer: { of: 'cards', filter: { types: [CREATURE] } } }),
      ]),
    ],
  },
  'Rangers of Ithilien': {
    keywords: [KEYWORD.VIGILANCE],
    triggeredAbilities: [when(TRIGGER.ENTERS_BATTLEFIELD, 'When this creature enters, gain control of up to one target creature with lesser power for as long as you control this creature. Then the Ring tempts you.', [
      { type: EFFECT.GAIN_CONTROL, whileSourceControlled: true }, ringTempts,
    ], { target: target(TARGET.CREATURE, null, { optional: true, lesserPowerThanSource: true }) })],
  },
  Rivendell: {
    entersTappedUnless: controlsLegendaryCreature,
    abilities: [
      tapFor('U'),
      ability('{1}{U}, {T}: Scry 2. Activate only if you control a legendary creature.', { mana: { generic: 1, U: 1 }, tap: true }, [scry(2)], {
        activationCondition: controlsLegendaryCreature,
      }),
    ],
  },
  'Samwise Gamgee': {
    triggeredAbilities: [when(TRIGGER.CREATURE_ENTERS, 'Whenever another nontoken creature you control enters, create a Food token.', [food()], { filter: { other: true, token: false } })],
    abilities: [ability('Sacrifice three Foods: Return target historic card from your graveyard to your hand.', { sacrifice: { ...foodSpec, count: 3 } }, [
      { type: EFFECT.RETURN_FROM_GRAVEYARD },
    ], { target: target(TARGET.CARD_IN_YOUR_GRAVEYARD, { historic: true }) })],
  },
  'Shagrat, Loot Bearer': {
    triggeredAbilities: [when(TRIGGER.ATTACKS, 'Whenever Shagrat attacks, attach up to one target Equipment to it. Then amass Orcs X, where X is the number of Equipment attached to Shagrat.', [
      { type: EFFECT.ATTACH, toSource: true }, amass(1, { per: { of: 'equipmentAttachedToSource' } }),
    ], { target: upTo(TARGET.ARTIFACT, { subtypes: ['Equipment'] }) })],
  },
  'Sméagol, Helpful Guide': {
    triggeredAbilities: [
      when(TRIGGER.END_STEP, 'At the beginning of your end step, if a creature died under your control this turn, the Ring tempts you.', [ringTempts], {
        condition: { creatureDiedThisTurn: true },
      }),
      when(TRIGGER.RING_TEMPTS, 'Whenever the Ring tempts you, target opponent reveals cards from the top of their library until they reveal a land card. Put that card onto the battlefield tapped under your control and the rest into their graveyard.', [
        { type: EFFECT.REVEAL_UNTIL, affected: AFFECTED.TARGET, filter: { types: [LAND] }, count: 1, tapped: true, rest: 'graveyard' },
      ], { target: TARGET.OPPONENT }),
    ],
  },
  'Spiteful Banditry': {
    triggeredAbilities: [
      when(TRIGGER.ENTERS_BATTLEFIELD, 'When this enchantment enters, it deals X damage to each creature.', [damage(1, { affected: AFFECTED.EACH_CREATURE, per: { of: 'sourceX' } })]),
      when(TRIGGER.CREATURE_DIES, 'Whenever one or more creatures your opponents control die, you create a Treasure token. This ability triggers only once each turn.', [treasure()], {
        filter: { controller: 'opponent' }, oncePerTurn: true,
      }),
    ],
  },
  'Sting, the Glinting Dagger': {
    staticAbilities: [
      attached({ power: 1, toughness: 1, keywords: [KEYWORD.HASTE] }),
      attached({ keywords: [KEYWORD.FIRST_STRIKE], condition: { hostBlockingOrBlockedBy: goblinOrOrc } }),
    ],
    triggeredAbilities: [when(TRIGGER.BEGINNING_OF_COMBAT, 'At the beginning of each combat, untap equipped creature.', [{ type: EFFECT.UNTAP, affected: AFFECTED.ATTACHED_PERMANENT }], {
      eachTurn: true,
    })],
    abilities: [equip(2)],
  },
  "The Balrog, Durin's Bane": {
    costReduction: { per: { of: 'permanentsSacrificedThisTurn' } },
    keywords: [KEYWORD.HASTE, KEYWORD.BLOCKED_ONLY_BY_LEGENDARY],
    triggeredAbilities: [when(TRIGGER.DIES, 'When The Balrog dies, destroy target artifact or creature an opponent controls.', [{ type: EFFECT.DESTROY }], {
      target: target(TARGET.PERMANENT, { types: [ARTIFACT, CREATURE], controller: 'opponent' }),
    })],
  },
  'The Battle of Bywater': {
    effects: [{ type: EFFECT.DESTROY, affected: AFFECTED.EACH_CREATURE, filter: { power: { min: 3 } } }, food(1, { per: { of: 'creatures' } })],
  },
  'The Ring Goes South': {
    effects: [
      ringTempts,
      { type: EFFECT.REVEAL_UNTIL, affected: AFFECTED.YOU, filter: { types: [LAND] }, count: 1, per: { of: 'creatures', filter: legendary }, tapped: true, rest: 'bottom' },
    ],
  },
  'The Shire': {
    entersTappedUnless: controlsLegendaryCreature,
    abilities: [
      tapFor('G'),
      ability('{1}{G}, {T}, Tap an untapped creature you control: Create a Food token.', { mana: { generic: 1, G: 1 }, tap: true, tapCreatures: { count: 1 } }, [food()]),
    ],
  },
  'There and Back Again': {
    triggeredAbilities: [
      chapter([1], "I — Up to one target creature can't block for as long as you control this Saga. The Ring tempts you.", [
        grant([KEYWORD.CANT_BLOCK], { whileSourceControlled: true }), ringTempts,
      ], { target: upTo(TARGET.CREATURE) }),
      chapter([2], 'II — Search your library for a Mountain card, put it onto the battlefield, then shuffle.', [
        { type: EFFECT.SEARCH_LIBRARY, filter: { subtypes: ['Mountain'] }, count: 1, destination: 'battlefield' },
      ]),
      chapter([3], 'III — Create Smaug, a legendary 6/6 red Dragon creature token with flying, haste, and "When Smaug dies, create fourteen Treasure tokens."', [tokens(smaug)]),
    ],
  },
  'War of the Last Alliance': {
    triggeredAbilities: [
      chapter([1, 2], 'I, II — Search your library for a legendary creature card, reveal it, put it into your hand, then shuffle.', [
        { type: EFFECT.SEARCH_LIBRARY, filter: legendaryCreature, count: 1, destination: 'hand' },
      ]),
      chapter([3], 'III — Creatures you control gain double strike until end of turn. The Ring tempts you.', [grant([KEYWORD.DOUBLE_STRIKE], yourCreatures), ringTempts]),
    ],
  },
  'Witch-king of Angmar': {
    keywords: [KEYWORD.FLYING],
    triggeredAbilities: [when(TRIGGER.COMBAT_DAMAGE_TO_YOU, 'Whenever one or more creatures deal combat damage to you, each opponent sacrifices a creature of their choice that dealt combat damage to you this turn. The Ring tempts you.', [
      { type: EFFECT.SACRIFICE, ...eachOpponent, dealtCombatDamageToYou: true }, ringTempts,
    ])],
    abilities: [ability('Discard a card: Witch-king of Angmar gains indestructible until end of turn. Tap him.', { discard: 1 }, [
      grant([KEYWORD.INDESTRUCTIBLE], source), { type: EFFECT.TAP, ...source },
    ])],
  },
};
