/**
 * Pai Gow's CPU opponents: figures of Middle-earth, each with a portrait from their LTR card's art,
 * what they say (see src/campaign/banter.js), and how they play: the search AI with their own
 * thinking time and evaluation (an archetype from src/ai/evaluate.js).
 */
import { AI_KIND } from '../campaign/campaign.js';

const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

/**
 * A portrait: a card's art crop on Scryfall's CDN (`path` after art_crop/front/), where the face is
 * (`x`, `y`: background-position percentages), how far to zoom in (`zoom`: background-size
 * percentage), and the card and artist it comes from.
 */
const portrait = (path, x, y, zoom, card, artist) => ({
  art: `https://cards.scryfall.io/art_crop/front/${path}`, x, y, zoom, card, artist,
});

const search = (budgetMs, weights) => ({ kind: AI_KIND.SEARCH, budgetMs, ...(weights ? { weights } : {}) });

export const PAIGOW_OPPONENTS = deepFreeze({
  gandalf: {
    name: 'Gandalf', color: 'blue', ai: search(2000),
    portrait: portrait('c/c/cc9cfcc7-be64-4871-8d52-851e43fe3305.jpg?1783916321', 68, 0, 300, 'Gandalf, Friend of the Shire', 'Dmitry Burmak'),
    banter: {
      start: ['Three cards each? A small game. Small things have a way of mattering.', 'Shall we? I have fireworks to see to afterwards.', 'Mind your hand. A wizard notices things.'],
      win: ['Well played, but not well enough. Off you go.', 'There. Even a grey old wanderer can win a round.'],
      lose: ['Ha! You surprised me. That happens less often than you might think.', 'Splendid. I shall think about that one on the road.'],
      comeback: ['Do not count the wizard out just yet.', 'Ah, there is the light I was looking for.'],
      collapse: ['Hm. I seem to have walked into that.', 'No, no. That one was my own doing.'],
    },
  },
  tomBombadil: {
    name: 'Tom Bombadil', color: 'gold', ai: search(1000),
    portrait: portrait('2/a/2ab04c49-76a1-4896-8dca-8cb4c615f489.jpg?1783916244', 56, 0, 300, 'Tom Bombadil', 'Dmitry Burmak'),
    banter: {
      start: ['Hop along, come along! Tom will play a merry game!', 'Cards, is it? Tom has time. Tom always has time.', 'Hey dol! Sit you down, and deal them merry!'],
      win: ['Ho! Tom wins, and none the worse for it. Sing with me!', 'Down you tumble, light as a leaf! No harm done.'],
      lose: ['Well, well! You beat old Tom. The river laughs at both of us.', 'Ho ho! A clever game. Tom will hum about it.'],
      comeback: ['Up again, up again, Tom is dancing!', 'The willow lets go, and Tom is merry!'],
      collapse: ['Oho, a puddle where Tom meant to step!', 'Never mind, never mind. The sun still shines.'],
    },
  },
  sauron: {
    name: 'Sauron', color: 'black', ai: search(2500, 'aggro'),
    portrait: portrait('0/3/034e0929-b2c7-4b5f-94f2-8eaf4fb1a2a1.jpg?1783916249', 50, 0, 320, 'Sauron, the Dark Lord', 'Kieran Yanner'),
    banter: {
      start: ['You play against me? Then you have already lost.', 'Every card you hold, I see.', 'Kneel, or be broken. The choice is the only one you have.'],
      win: ['As it was always going to be.', 'Your hope burns out. Mine never did.'],
      lose: ['A spark. Nothing more. I will find you again.', 'You have won nothing but my attention.'],
      comeback: ['The shadow returns. It always returns.', 'Did you think the Eye had closed?'],
      collapse: ['Insolence. You will regret it.', 'This changes nothing. Nothing!'],
    },
  },
  saruman: {
    name: 'Saruman', color: 'white', ai: search(2000, 'control'),
    portrait: portrait('1/b/1bfccbab-29fa-4e92-8919-6cd4815fb655.jpg?1783916311', 52, 16, 300, 'Saruman the White', 'Matt Stewart'),
    banter: {
      start: ['Come, let us be reasonable. You cannot win, but you may learn something.', 'I have studied every card in this game. Have you?', 'Sit. My patience is greater than your deck.'],
      win: ['Knowledge, my friend. It wins in the end.', 'You were outplayed by a better mind. There is no shame in it. Much.'],
      lose: ['A mere accident of the draw.', 'Hm. I shall have to revise my calculations.'],
      comeback: ['As I foresaw. Every turn of it.', 'The plan holds. It always held.'],
      collapse: ['That was not in the palantír.', 'You are cleverer than you look. Irritating.'],
    },
  },
  theoden: {
    name: 'Théoden', color: 'red', ai: search(1500, 'aggro'),
    portrait: portrait('f/6/f6dcd1ca-4943-46e4-bb5d-c14949e21e23.jpg?1783916242', 27, 0, 300, 'Théoden, King of Rohan', 'Kieran Yanner'),
    banter: {
      start: ['Ride with me, or ride against me! Either way, we ride!', 'A king does not hide behind his cards.', 'Sound the horns. Let this be a game worth singing of.'],
      win: ['The field is ours! A fine charge, if I say so myself.', 'For the Mark! Well fought, friend.'],
      lose: ['Well struck. Rohan bows to a worthy foe.', 'Fall back and regroup. We shall meet again.'],
      comeback: ['To me, riders! The day is not lost!', 'Now the tide turns. Charge!'],
      collapse: ['Hold the line! Hold it!', 'The enemy is stronger than the scouts said.'],
    },
  },
  denethor: {
    name: 'Denethor', color: 'black', ai: search(1000, 'control'),
    portrait: portrait('f/a/fa8654cf-431c-427b-b78f-0e48f6007e9e.jpg?1783916256', 34, 4, 320, 'Denethor, Ruling Steward', 'Campbell White'),
    banter: {
      start: ['You come before the Steward of Gondor. Play carefully.', 'I have seen how this ends. Shall we pretend otherwise?', 'Sit. I rule here, and I do not lose lightly.'],
      win: ['As I said. Hope is a fool\'s comfort.', 'Gondor stands. You do not.'],
      lose: ['So the city falls. I always knew it would.', 'Go, then. Take your victory and leave me.'],
      comeback: ['Perhaps there is strength in the old blood yet.', 'You see? The Steward does not break.'],
      collapse: ['All is lost. All of it.', 'I was betrayed by my own cards.'],
    },
  },
  elrond: {
    name: 'Elrond', color: 'blue', ai: search(1500, 'control'),
    portrait: portrait('a/6/a62a5e55-fa1b-4c70-9293-740dd513d52e.jpg?1783916319', 52, 0, 320, 'Elrond, Lord of Rivendell', 'Ryan Yee'),
    banter: {
      start: ['Welcome to Rivendell. Let us play, and let the game be fair.', 'I have watched long ages. One more game is no burden.', 'Take your time. Here, time is something we have.'],
      win: ['The wise do not boast. But I did play that well.', 'Rest now. You have earned it, even in defeat.'],
      lose: ['Well done. The young surprise me still.', 'A worthy victory. Remember how you won it.'],
      comeback: ['The river rises in my favor.', 'Patience. The tide always returns.'],
      collapse: ['I did not foresee that.', 'Even the long-lived can be caught unawares.'],
    },
  },
  galadriel: {
    name: 'Galadriel', color: 'green', ai: search(2500),
    portrait: portrait('a/6/a6e5c3b3-9a70-4a1c-bfb3-db27e51c4b8d.jpg?1783916254', 34, 0, 320, 'Galadriel of Lothlórien', 'Magali Villeneuve'),
    banter: {
      start: ['I know what is in your hand. And what is in your heart.', 'Look into the mirror, and play what you see.', 'Welcome to the Golden Wood. Tread softly.'],
      win: ['You were tested. The test is over.', 'The light of the Eldar does not fade so easily.'],
      lose: ['You have passed the test. Go in peace.', 'I see now why the Ring was given to small hands.'],
      comeback: ['The light returns to Lothlórien.', 'You thought the wood had gone dark. It never does.'],
      collapse: ['The mirror showed many things. Not this.', 'Even the Lady of the Wood can stumble.'],
    },
  },
});

/** A Pai Gow opponent by id. */
export const paigowOpponent = (id) => PAIGOW_OPPONENTS[id];
