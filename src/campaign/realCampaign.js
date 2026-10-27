import { AI_KIND, POWER } from './campaign.js';
import { SAMPLE_CAMPAIGN } from './sampleCampaign.js';
import {
  REAL_DECKS, REWARD_ONLY_CARDS, PATHFINDER_DECK, PATHFINDER_REWARDS,
} from './decks.js';
import { EFFECT, TARGET, ACTIVATION_TIMING } from '../cards/cards.js';

/**
 * The campaign the app plays: real cards (imported from Scryfall, see
 * cards/real-cards.txt), a deck per color, and a ladder from light builds up to the
 * Dragonlord. The planeswalkers' emblems and powers are shared with the sample
 * campaign.
 */
const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const LANDS = new Set(['forest', 'island', 'plains', 'swamp', 'mountain']);
const once = { activationsPerTurn: 1 };
const sorcery = ACTIVATION_TIMING.SORCERY;
const untap = { target: TARGET.CREATURE, effects: [{ type: EFFECT.UNTAP }], timing: sorcery };
const spellsOf = (...decks) => [...new Set(decks.flat().filter((id) => !LANDS.has(id)))];

export const CAMPAIGN = deepFreeze({
  rules: {
    lives: 3,
    minDeckSize: 40,
    rewards: { cards: 2, powers: 1, removeCard: true },
  },

  // Every card is in CARDS already (imported or hand-written).
  cards: {},
  emblems: {
    ...SAMPLE_CAMPAIGN.emblems,
    // The Pathfinder's: an untap, which the upgrade makes free, and Elves.
    pathfinderUntap: {
      id: 'pathfinderUntap', name: 'Pathfinder\'s Call', ...once,
      abilities: [{ id: 'untap', text: '{G}: Untap target creature.', cost: { mana: { G: 1 } }, ...untap }],
    },
    pathfinderFreeUntap: {
      id: 'pathfinderFreeUntap', name: 'Pathfinder\'s Call', ...once,
      abilities: [{ id: 'untap', text: '0: Untap target creature.', cost: {}, ...untap }],
    },
    pathfinderElves: {
      id: 'pathfinderElves', name: 'Elf Summons', ...once,
      abilities: [{
        id: 'summon', text: '{2}: Create a 1/1 green Elf Warrior creature token.', cost: { mana: { generic: 2 } }, timing: sorcery,
        effects: [{ type: EFFECT.CREATE_TOKEN, count: 1, token: { colors: ['green'], subtypes: ['Elf', 'Warrior'], power: 1, toughness: 1 } }],
      }],
    },
  },
  powers: {
    ...SAMPLE_CAMPAIGN.powers,
    pathfinderFreeUntap: {
      kind: POWER.UPGRADE, emblemId: 'pathfinderUntap', to: 'pathfinderFreeUntap', name: 'Free Call', text: 'Untapping a creature costs 0 instead of {G}.',
    },
    pathfinderElves: { kind: POWER.EMBLEM, emblemId: 'pathfinderElves', name: 'Elf Summons', text: 'Gain "{2}: Create a 1/1 Elf Warrior."' },
  },

  planeswalkers: {
    warden: {
      ...SAMPLE_CAMPAIGN.planeswalkers.warden,
      text: 'A keeper of the deep forests. Big creatures, bigger counters.',
      colors: ['G'],
      decks: ['greenStompy'],
    },
    sage: {
      ...SAMPLE_CAMPAIGN.planeswalkers.sage,
      text: 'A scholar of the skies. Flyers, walls and counterspells.',
      colors: ['U'],
      decks: ['blueSkies'],
    },
    pathfinder: {
      name: 'The Pathfinder',
      color: 'green',
      text: 'Speaks for the elves of the canopy. A wide board, lords and mana.',
      colors: ['G'],
      emblems: ['pathfinderUntap'],
      powers: ['pathfinderFreeUntap', 'pathfinderElves', 'toughHide', 'secondWind'],
      decks: ['elfTribe'],
      // Rewards come from the deck's sideboard, in every tier.
      cardPool: 'pathfinder',
    },
  },

  starterDecks: {
    greenStompy: { name: 'Green Stompy', cards: REAL_DECKS.greenStompy },
    blueSkies: { name: 'Blue Skies', cards: REAL_DECKS.blueSkies },
    elfTribe: { name: 'Elf Tribe', cards: PATHFINDER_DECK },
  },

  opponents: {
    // Outskirts: lighter builds, basic AI.
    shieldMaiden: { name: 'Shield-Maiden', color: 'white', deck: REAL_DECKS.whiteRecruits, ai: { kind: AI_KIND.BASIC } },
    graveRobber: { name: 'Grave Robber', color: 'black', deck: REAL_DECKS.blackRabble, ai: { kind: AI_KIND.BASIC } },
    raider: { name: 'Goblin Raider', color: 'red', deck: REAL_DECKS.redRaiders, ai: { kind: AI_KIND.BASIC } },
    // Deep Wilds: full builds, searching.
    knightCaptain: { name: 'Knight-Captain', color: 'white', deck: REAL_DECKS.whiteWeenie, ai: { kind: AI_KIND.SEARCH, budgetMs: 500, weights: 'aggro' } },
    nightStalker: { name: 'Night Stalker', color: 'black', deck: REAL_DECKS.blackRemoval, ai: { kind: AI_KIND.SEARCH, budgetMs: 500 } },
    pyromancer: { name: 'Pyromancer', color: 'red', deck: REAL_DECKS.redBurn, ai: { kind: AI_KIND.SEARCH, budgetMs: 500, weights: 'aggro' } },
    // Citadel: the other planeswalkers' colors, thinking harder, with an emblem.
    beastLord: {
      name: 'Beast Lord', color: 'green', deck: REAL_DECKS.greenStompy, emblems: ['planeswalker'],
      ai: { kind: AI_KIND.SEARCH, budgetMs: 1500 },
    },
    stormCaller: {
      name: 'Storm Caller', color: 'blue', deck: REAL_DECKS.blueSkies, emblems: ['planeswalker'],
      ai: { kind: AI_KIND.SEARCH, budgetMs: 1500, weights: 'control' },
    },
    // Throne: the boss.
    dragonlord: {
      name: 'The Dragonlord', color: 'red', deck: REAL_DECKS.dragonlord, emblems: ['bossDominion', 'planeswalker'], startingLife: 25,
      ai: { kind: AI_KIND.SEARCH, budgetMs: 2500 },
    },
  },

  cardPools: {
    early: spellsOf(REAL_DECKS.whiteRecruits, REAL_DECKS.blackRabble, REAL_DECKS.redRaiders, REAL_DECKS.greenStompy, REAL_DECKS.blueSkies),
    late: spellsOf(...Object.values(REAL_DECKS), REWARD_ONLY_CARDS),
    pathfinder: [...PATHFINDER_REWARDS],
  },

  ladder: [
    { id: 'outskirts', name: 'Outskirts', fights: 2, opponents: ['shieldMaiden', 'graveRobber', 'raider'], cardPool: 'early' },
    { id: 'wilds', name: 'Deep Wilds', fights: 2, opponents: ['knightCaptain', 'nightStalker', 'pyromancer'], cardPool: 'late' },
    { id: 'citadel', name: 'Citadel', fights: 1, opponents: ['beastLord', 'stormCaller'], cardPool: 'late', rewards: { cards: 2, powers: 2 } },
    { id: 'throne', name: 'Throne', boss: true, fights: 1, opponents: ['dragonlord'] },
  ],
});
