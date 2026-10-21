import {
  EFFECT, TARGET, AFFECTED, TOKEN, ACTIVATION_TIMING, DEFAULT_DECK,
} from '../cards/cards.js';
import {
  SAMPLE_CARDS, SAMPLE_DECK, SAMPLE_PERMANENTS, SAMPLE_PERMANENTS_DECK, SAMPLE_SPELLS, SAMPLE_SPELLS_DECK,
  SAMPLE_EFFECTS, SAMPLE_EFFECTS_DECK, SAMPLE_TRIGGERS, SAMPLE_TRIGGERS_DECK,
} from '../cards/sampleCards.js';
import { POWER, AI_KIND } from './campaign.js';

/**
 * Example campaign content, built from the sample cards and decks. It's here to
 * exercise the campaign framework (src/campaign/campaign.js) and to show the
 * content format; the real planeswalkers, decks and opponents will replace it.
 */
const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const once = { activationsPerTurn: 1 };
const sorcery = ACTIVATION_TIMING.SORCERY;
const nonlands = (cards) => Object.keys(cards);

export const SAMPLE_CAMPAIGN = deepFreeze({
  rules: {
    lives: 3,
    minDeckSize: 40,
    /** What each win offers, unless a tier says otherwise. */
    rewards: { cards: 2, powers: 1, removeCard: true },
  },

  cards: {
    ...SAMPLE_CARDS, ...SAMPLE_PERMANENTS, ...SAMPLE_SPELLS, ...SAMPLE_EFFECTS, ...SAMPLE_TRIGGERS,
  },

  emblems: {
    wardenGrowth: {
      id: 'wardenGrowth', name: 'Warden\'s Growth', ...once,
      abilities: [{
        id: 'grow', text: '0: Put a +1/+1 counter on target creature you control.', cost: {}, timing: sorcery,
        target: TARGET.CREATURE_YOU_CONTROL, effects: [{ type: EFFECT.ADD_COUNTERS, counter: '+1/+1', count: 1 }],
      }],
    },
    wardenSprouts: {
      id: 'wardenSprouts', name: 'Warden\'s Sprouts', ...once,
      abilities: [{
        id: 'sprout', text: '{2}: Create a 1/1 green Saproling creature token.', cost: { mana: { generic: 2 } }, timing: sorcery,
        effects: [{ type: EFFECT.CREATE_TOKEN, count: 1, token: { colors: ['green'], subtypes: ['Saproling'], power: 1, toughness: 1 } }],
      }],
    },
    sageInsight: {
      id: 'sageInsight', name: 'Sage\'s Insight', ...once,
      abilities: [{
        id: 'study', text: '{3}: Draw a card.', cost: { mana: { generic: 3 } }, timing: sorcery,
        effects: [{ type: EFFECT.DRAW_CARDS, count: 1 }],
      }],
    },
    sageSpark: {
      id: 'sageSpark', name: 'Sage\'s Spark', ...once,
      abilities: [{
        id: 'spark', text: 'Pay 2 life: Deal 1 damage to any target.', cost: { life: 2 }, timing: sorcery,
        target: TARGET.ANY, effects: [{ type: EFFECT.DEAL_DAMAGE, amount: 1 }],
      }],
    },
    sageHoard: {
      id: 'sageHoard', name: 'Sage\'s Hoard', ...once,
      abilities: [{
        id: 'hoard', text: '{1}: Create a Treasure token.', cost: { mana: { generic: 1 } }, timing: sorcery,
        effects: [{ type: EFFECT.CREATE_TOKEN, count: 1, token: TOKEN.TREASURE }],
      }],
    },
    bossDominion: {
      id: 'bossDominion', name: 'Dominion', ...once,
      abilities: [{
        id: 'rally', text: '0: Creatures you control get +1/+0 until end of turn.', cost: {}, timing: sorcery,
        effects: [{ type: EFFECT.PUMP, power: 1, toughness: 0, affected: AFFECTED.EACH_CREATURE_YOU_CONTROL }],
      }],
    },
  },

  planeswalkers: {
    warden: {
      name: 'The Warden',
      color: 'green',
      text: 'Grows an army, one counter at a time.',
      emblems: ['wardenGrowth'],
      powers: ['wardenSprouts', 'wardenTwice', 'toughHide', 'secondWind'],
    },
    sage: {
      name: 'The Sage',
      color: 'blue',
      text: 'Outlasts opponents with cards and tricks.',
      emblems: ['sageInsight'],
      startingLife: 18,
      powers: ['sageSpark', 'sageHoard', 'toughHide', 'secondWind'],
    },
  },

  starterDecks: {
    keywords: { name: 'Keyword Creatures', cards: SAMPLE_DECK },
    effects: { name: 'Effects', cards: SAMPLE_EFFECTS_DECK },
    triggers: { name: 'Enter and Die', cards: SAMPLE_TRIGGERS_DECK },
  },

  powers: {
    wardenSprouts: { kind: POWER.EMBLEM, emblemId: 'wardenSprouts', name: 'Sprouts', text: 'Gain "{2}: Create a 1/1 Saproling."' },
    wardenTwice: { kind: POWER.ACTIVATIONS, emblemId: 'wardenGrowth', amount: 1, name: 'Double Growth', text: 'Growth can be used twice each turn.' },
    sageSpark: { kind: POWER.EMBLEM, emblemId: 'sageSpark', name: 'Spark', text: 'Gain "Pay 2 life: Deal 1 damage to any target."' },
    sageHoard: { kind: POWER.EMBLEM, emblemId: 'sageHoard', name: 'Hoard', text: 'Gain "{1}: Create a Treasure token."' },
    toughHide: { kind: POWER.STARTING_LIFE, amount: 3, repeatable: true, name: 'Tough Hide', text: 'Start every fight with 3 more life.' },
    secondWind: { kind: POWER.EXTRA_LIFE, amount: 1, repeatable: true, name: 'Second Wind', text: 'Gain an extra life for this run.' },
  },

  opponents: {
    elfHerd: { name: 'Elf Herd', deck: DEFAULT_DECK, ai: { kind: AI_KIND.BASIC } },
    beastPack: { name: 'Beast Pack', deck: SAMPLE_DECK, ai: { kind: AI_KIND.BASIC } },
    tinkerer: { name: 'Tinkerer', deck: SAMPLE_PERMANENTS_DECK, ai: { kind: AI_KIND.BASIC } },
    spellslinger: { name: 'Spellslinger', deck: SAMPLE_SPELLS_DECK, ai: { kind: AI_KIND.SEARCH, budgetMs: 500, weights: 'control' } },
    trickster: { name: 'Trickster', deck: SAMPLE_EFFECTS_DECK, ai: { kind: AI_KIND.SEARCH, budgetMs: 500 } },
    gravecaller: { name: 'Gravecaller', deck: SAMPLE_TRIGGERS_DECK, ai: { kind: AI_KIND.SEARCH, budgetMs: 500 } },
    warlord: {
      name: 'Warlord', deck: SAMPLE_PERMANENTS_DECK, emblems: ['planeswalker'],
      ai: { kind: AI_KIND.SEARCH, budgetMs: 1500, weights: 'aggro' },
    },
    archmage: {
      name: 'Archmage', deck: SAMPLE_EFFECTS_DECK, emblems: ['planeswalker'],
      ai: { kind: AI_KIND.SEARCH, budgetMs: 1500, weights: 'control' },
    },
    overlord: {
      name: 'The Overlord', deck: SAMPLE_TRIGGERS_DECK, emblems: ['bossDominion', 'planeswalker'], startingLife: 25,
      ai: { kind: AI_KIND.SEARCH, budgetMs: 2500 },
    },
  },

  cardPools: {
    early: [...nonlands(SAMPLE_CARDS), ...nonlands(SAMPLE_PERMANENTS)],
    late: [...nonlands(SAMPLE_SPELLS), ...nonlands(SAMPLE_EFFECTS), ...nonlands(SAMPLE_TRIGGERS)],
  },

  ladder: [
    { id: 'outskirts', name: 'Outskirts', fights: 2, opponents: ['elfHerd', 'beastPack', 'tinkerer'], cardPool: 'early' },
    { id: 'wilds', name: 'Deep Wilds', fights: 2, opponents: ['spellslinger', 'trickster', 'gravecaller'], cardPool: 'late' },
    { id: 'citadel', name: 'Citadel', fights: 1, opponents: ['warlord', 'archmage'], cardPool: 'late', rewards: { cards: 2, powers: 2 } },
    { id: 'throne', name: 'Throne', boss: true, fights: 1, opponents: ['overlord'] },
  ],
});
