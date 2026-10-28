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

/**
 * A portrait: a card's art crop on Scryfall's CDN (`path` after art_crop/front/), with
 * where the face is (`x`, `y`: background-position percentages) and how far to zoom in
 * (`zoom`: background-size percentage), and the card and artist it comes from.
 */
const portrait = (path, x, y, zoom, card, artist) => ({
  art: `https://cards.scryfall.io/art_crop/front/${path}`, x, y, zoom, card, artist,
});

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
      portrait: portrait('8/d/8d64871b-6ee5-426b-9828-125cb9c7746d.jpg?1783931145', 50, 22, 240, 'Nissa, Steward of Elements', 'Howard Lyon'),
      ...SAMPLE_CAMPAIGN.planeswalkers.warden,
      text: 'A keeper of the deep forests. Big creatures, bigger counters.',
      colors: ['G'],
      decks: ['greenStompy'],
    },
    sage: {
      portrait: portrait('c/8/c8817585-0d32-4d56-9142-0d29512e86a9.jpg?1783930196', 50, 14, 240, 'Jace, the Mind Sculptor', 'Jason Chan'),
      ...SAMPLE_CAMPAIGN.planeswalkers.sage,
      text: 'A scholar of the skies. Flyers, walls and counterspells.',
      colors: ['U'],
      decks: ['blueSkies'],
    },
    pathfinder: {
      portrait: portrait('8/3/83b4a09f-ea53-42b4-a41a-4299192a6fd3.jpg?1783908890', 40, 6, 260, 'Imperious Perfect', 'Scott M. Fischer'),
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

  // Each opponent's `banter` is what it says (see banter.js), in its own voice.
  opponents: {
    // Outskirts: lighter builds, basic AI.
    shieldMaiden: {
      portrait: portrait('a/1/a11f77e4-edb6-43c6-b8ca-d4f62d26d0c0.jpg?1783915725', 30, 22, 250, 'Danitha Capashen, Paragon', 'Chris Rallis'),
      name: 'Shield-Maiden', color: 'white', deck: REAL_DECKS.whiteRecruits, ai: { kind: AI_KIND.BASIC },
      banter: {
        start: ['Shields up! I\'ve trained my whole life for this.', 'For the village! Um, and for honor!', 'Stand and fight, walker. I won\'t run.'],
        win: ['We held the line! Wait until the captain hears.', 'Ha! The recruits aren\'t so green after all.'],
        lose: ['I yield... but I\'ll train harder.', 'Well fought. My shield arm needs rest anyway.'],
        comeback: ['Rally! We\'re not beaten yet!', 'Hold fast, everyone, the tide is turning!'],
        collapse: ['That\'s... not how the drills went.', 'Steady... steady... oh no.'],
      },
    },
    graveRobber: {
      portrait: portrait('4/4/44d7906e-8a89-4644-acb5-46fbe97ab39f.jpg?1783915675', 63, 22, 250, 'Ghoulcaller Gisa', 'Karla Ortiz'),
      name: 'Grave Robber', color: 'black', deck: REAL_DECKS.blackRabble, ai: { kind: AI_KIND.BASIC },
      banter: {
        start: ['Nice boots. You won\'t be needing them much longer.', 'Shh. The dead don\'t like a racket.', 'Every grave\'s a treasure chest, if you dig deep enough.'],
        win: ['Mind if I go through your pockets? Too late.', 'Another one for the collection. Heh heh.'],
        lose: ['Fine, fine! Keep your trinkets.', 'Bah. I\'ll dig up better friends next time.'],
        comeback: ['Up you get, lads. Night shift isn\'t over.', 'Thought I was finished? I\'m only just digging in.'],
        collapse: ['Uh oh. That\'s my shovel you\'re standing on.', 'Wait, wait, we can split the loot!'],
      },
    },
    raider: {
      portrait: portrait('3/d/3d726dff-2904-4a82-adaa-29c57a5c2aed.jpg?1783907068', 52, 25, 200, 'Legion Warboss', 'Alex Konstad'),
      name: 'Goblin Raider', color: 'red', deck: REAL_DECKS.redRaiders, ai: { kind: AI_KIND.BASIC },
      banter: {
        start: ['SMASH TIME! Wait, is it smash time? IT\'S SMASH TIME!', 'Me raid! You cry! Good deal!', 'Ooh, shiny planeswalker. Me take it.'],
        win: ['Hahaha! Me best raider! Me tell EVERYONE!', 'You go boom. Me keep your stuff.'],
        lose: ['Ow ow ow. Me go home now.', 'Not fair! You smash better!'],
        comeback: ['Hehe, me not dead yet! MORE SMASH!', 'Goblins never give up! Mostly!'],
        collapse: ['Uh. Where my goblins go?', 'Too much smash coming wrong way!'],
      },
    },
    // Deep Wilds: full builds, searching.
    knightCaptain: {
      portrait: portrait('8/4/8400f1a7-ebf0-49b2-a51d-3b2056c05b61.jpg?1783917184', 57, 12, 260, 'Knight Exemplar', 'Jason Chan'),
      name: 'Knight-Captain', color: 'white', deck: REAL_DECKS.whiteWeenie, ai: { kind: AI_KIND.SEARCH, budgetMs: 500, weights: 'aggro' },
      banter: {
        start: ['Company, form ranks! We ride at my word.', 'You face the Order now, walker. Kneel, or be ridden down.', 'Banners high. Let this be an honest fight.'],
        win: ['The field is ours. Give my regards to your next master.', 'Discipline beats talent. Every time.'],
        lose: ['Sound the retreat. You have earned this field.', 'A fine victory. The Order will remember your name.'],
        comeback: ['Reform the line! Now we advance!', 'The charge holds! Press them, knights!'],
        collapse: ['Close the gaps! Hold, curse you, hold!', 'Our flank is broken. Rally to me!'],
      },
    },
    nightStalker: {
      portrait: portrait('5/6/561d616c-df11-4144-acec-f9fe47efa5c7.jpg?1783908076', 53, 0, 330, 'Olivia Voldaren', 'Eric Deschamps'),
      name: 'Night Stalker', color: 'black', deck: REAL_DECKS.blackRemoval, ai: { kind: AI_KIND.SEARCH, budgetMs: 500 },
      banter: {
        start: ['How kind of you to come to me. I do hate hunting on an empty stomach.', 'The moon is up. You should have stayed indoors.', 'Every heartbeat is so loud from here.'],
        win: ['Shh. It only hurts until it doesn\'t.', 'Exquisite. Your vintage was worth the wait.'],
        lose: ['The sun will set again. And I will find you.', 'Enjoy the dawn, little warmblood.'],
        comeback: ['There it is. That flutter of panic in your pulse.', 'Did you think me dead? How charming.'],
        collapse: ['Insolent thing. You draw too close to the light.', 'You bite back. How... unexpected.'],
      },
    },
    pyromancer: {
      portrait: portrait('2/c/2cabfcfe-012e-4cab-bba2-24052eac0946.jpg?1783932984', 50, 18, 240, 'Chandra, Acolyte of Flame', 'Anna Steinbauer'),
      name: 'Pyromancer', color: 'red', deck: REAL_DECKS.redBurn, ai: { kind: AI_KIND.SEARCH, budgetMs: 500, weights: 'aggro' },
      banter: {
        start: ['Ooh, you look flammable!', 'Let\'s keep this quick. I\'m on a tight burn schedule.', 'Mind the sparks. Actually, don\'t.'],
        win: ['Look at that glow! You\'re beautiful when you smolder.', 'Burned to a crisp. My favorite doneness.'],
        lose: ['Okay, okay, I\'ll put it out. This time.', 'Fizzled. Ugh. I hate fizzling.'],
        comeback: ['Oh, now we\'re cooking!', 'Fan the flames! It\'s spreading!'],
        collapse: ['Who turned down the heat?!', 'Wait, I\'m running low on kindling!'],
      },
    },
    // Citadel: the other planeswalkers' colors, thinking harder, with an emblem.
    beastLord: {
      portrait: portrait('7/9/79cfc0d7-fccb-47fb-87b6-08dd32528be6.jpg?1783927534', 34, 18, 230, 'Garruk, Primal Hunter', 'D. Alexander Gregory'),
      name: 'Beast Lord', color: 'green', deck: REAL_DECKS.greenStompy, emblems: ['planeswalker'],
      ai: { kind: AI_KIND.SEARCH, budgetMs: 1500 },
      banter: {
        start: ['The wild has woken. It is hungry.', 'Small one. You smell of cities.', 'Hear the ground shake? That is my herd.'],
        win: ['The herd tramples. The forest grows back. You do not.', 'The strong eat. That is the oldest law.'],
        lose: ['You are a worthy predator. The wild will remember.', 'The herd scatters. For now.'],
        comeback: ['The beasts stir again. ROAR with me!', 'Wounded beasts fight hardest.'],
        collapse: ['My herd falls? Impossible!', 'The pack grows thin. Stand, my beasts!'],
      },
    },
    stormCaller: {
      portrait: portrait('1/b/1be3ed47-072e-481a-b3d9-dc232ac4b24f.jpg?1783911937', 57, 8, 280, 'Talrand, Sky Summoner', 'Svetlin Velinov'),
      name: 'Storm Caller', color: 'blue', deck: REAL_DECKS.blueSkies, emblems: ['planeswalker'],
      ai: { kind: AI_KIND.SEARCH, budgetMs: 1500, weights: 'control' },
      banter: {
        start: ['I have already counted every move you can make.', 'Look up. The forecast calls for your defeat.', 'Patience. The storm always arrives on time.'],
        win: ['As calculated. Do try to be less predictable.', 'Clear skies, now. How peaceful.'],
        lose: ['An outlier. I shall revise my models.', 'Hm. The barometer lied.'],
        comeback: ['And now the pressure drops. Can you feel it?', 'The clouds part. Precisely on schedule.'],
        collapse: ['A miscalculation. A small one. Surely.', 'This front was not in my forecast.'],
      },
    },
    // Throne: the boss.
    dragonlord: {
      portrait: portrait('0/6/06f90d62-6d21-47b1-a427-eb25a42f4dcb.jpg?1783907070', 72, 24, 210, 'Glorybringer', 'Sam Burley'),
      name: 'The Dragonlord', color: 'red', deck: REAL_DECKS.dragonlord, emblems: ['bossDominion', 'planeswalker'], startingLife: 25,
      ai: { kind: AI_KIND.SEARCH, budgetMs: 2500 },
      banter: {
        start: ['So, you climbed my mountain. Few do. Fewer leave.', 'Kneel, and I may let you burn quickly.', 'All of this realm is my hoard. You are just one more coin.'],
        win: ['Ash to ash. Another walker for the hoard.', 'Did you truly think the sky would bow to you?'],
        lose: ['Impossible... the mountain... falls?', 'Remember this day, walker. My brood will not forget it.'],
        comeback: ['There it is. The moment hope leaves your eyes.', 'You merely woke the dragon. Now it is angry.'],
        collapse: ['You dare wound me? I will raze your homeland for this!', 'Enough! The skies burn at my command!'],
      },
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
