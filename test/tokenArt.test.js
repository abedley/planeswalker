import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, CARD_TYPE, EFFECT, TOKEN, CARDS, SAMPLE_CAMPAIGN, CAMPAIGN, TOKEN_PRESENTATION, passPriority, castSpell, tokenCardId,
} from '../src/index.js';
import * as SAMPLES from '../src/cards/sampleCards.js';
import { collectTokens, pickTokenPrinting, tokenMatches, tokenQuery } from '../tools/scryfall/tokens.js';
import { readTokenArt, renderTokenArtModule } from '../tools/import-tokens.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KNIGHT = { colors: ['white'], subtypes: ['Knight'], power: 2, toughness: 2, keywords: ['vigilance'] };

/** A Scryfall token printing, with only the fields the matching reads. */
const printing = (fields) => ({
  object: 'card', layout: 'token', id: 'x', set: 'tm19', set_type: 'token', digital: false, promo: false, full_art: false,
  highres_image: true, released_at: '2018-07-13', image_uris: { art_crop: 'art.jpg', normal: 'card.jpg' }, keywords: [],
  colors: [], oracle_text: '', ...fields,
});
const knight = (fields) => printing({
  name: 'Knight', type_line: 'Token Creature — Knight', power: '2', toughness: '2', colors: ['W'],
  keywords: ['Vigilance'], oracle_text: 'Vigilance', ...fields,
});
const treasure = (fields) => printing({
  name: 'Treasure', type_line: 'Token Artifact — Treasure', oracle_text: '{T}, Sacrifice this token: Add one mana of any color.', ...fields,
});

test('tokens created in a game get the card id tokenCardId gives them', () => {
  const spell = (id, token) => ({ id, name: id, manaCost: {}, types: [CARD_TYPE.SORCERY], effects: [{ type: EFFECT.CREATE_TOKEN, count: 1, token }] });
  const cards = { Hoard: spell('Hoard', TOKEN.TREASURE), Muster: spell('Muster', KNIGHT) };
  const deck = ['Hoard', 'Muster', ...Array(38).fill('forest')];
  const game = new Game({ players: [{ id: 'p1' }, { id: 'p2' }], cards, shuffleLibraries: false, emblems: { p1: [], p2: [] }, decks: { p1: deck, p2: deck } });
  game.start();
  const pass = () => { for (let i = 0; i < 2; i++) game.dispatch(passPriority(game.getState().priorityPlayerId)); };
  pass();
  for (const name of ['Hoard', 'Muster']) {
    game.dispatch(castSpell('p1', game.getState().players[0].hand.find((c) => c.name === name).id));
    pass();
  }
  const ids = game.getState().battlefield.filter((p) => p.token).map((p) => p.cardId).sort();
  assert.deepEqual(ids, [tokenCardId(KNIGHT), tokenCardId(TOKEN.TREASURE)].sort());
  assert.equal(tokenCardId(TOKEN.TREASURE), 'token:treasure');
  assert.equal(tokenCardId(KNIGHT), 'token:Knight Token:2/2:white:vigilance');
});

test('collects every token the cards create, with the cards that create them', () => {
  const tokens = collectTokens([CARDS]);
  assert.ok(tokens.has('token:treasure') && tokens.has('token:food') && tokens.has('token:clue'));
  assert.ok(tokens.get(tokenCardId(KNIGHT)).creators.has('gallantCavalry'));
  assert.ok(tokens.get('token:treasure').creators.has('rapaciousDragon'));
});

test('every token the game can create has Scryfall art', () => {
  const tokens = collectTokens([CARDS, ...Object.values(SAMPLES), SAMPLE_CAMPAIGN, CAMPAIGN]);
  const missing = [...tokens.keys()].filter((id) => !TOKEN_PRESENTATION[id]?.image?.art);
  assert.deepEqual(missing, [], 'run `npm run import-tokens`');
});

test('a Scryfall token matches only a token with the same characteristics', () => {
  assert.ok(tokenMatches(knight(), KNIGHT));
  assert.ok(!tokenMatches(knight(), { ...KNIGHT, keywords: [] }), 'missing keyword');
  assert.ok(!tokenMatches(knight({ power: '1', toughness: '1' }), KNIGHT), 'power/toughness');
  assert.ok(!tokenMatches(knight({ colors: ['R'] }), KNIGHT), 'color');
  assert.ok(!tokenMatches(knight({ oracle_text: 'Vigilance\nWhen this token dies, draw a card.' }), KNIGHT), 'more rules text');
  assert.ok(!tokenMatches(knight({ type_line: 'Token Artifact Creature — Knight' }), KNIGHT), 'other types');
  assert.ok(!tokenMatches(knight({ layout: 'normal' }), KNIGHT), 'not a token');
  assert.ok(!tokenMatches(knight({ image_uris: undefined }), KNIGHT), 'no image');
  assert.ok(tokenMatches(treasure(), TOKEN.TREASURE));
  assert.ok(tokenMatches(treasure({ oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.' }), TOKEN.TREASURE));
  assert.ok(!tokenMatches(treasure({ name: 'Sculpture Treasure', type_line: 'Token Artifact Creature — Sculpture Treasure' }), TOKEN.TREASURE));
  assert.ok(!tokenMatches(treasure(), TOKEN.FOOD));
});

test('prefers the token printed with a creating card, then a regular token printing, newest first', () => {
  const cards = [
    knight({ id: 'old', released_at: '2010-01-01' }),
    knight({ id: 'new', released_at: '2024-01-01' }),
    knight({ id: 'lair', set_type: 'box', released_at: '2025-01-01' }),
    knight({ id: 'promo', promo: true, released_at: '2025-01-01' }),
    knight({ id: 'other', power: '1', released_at: '2026-01-01' }),
  ];
  assert.equal(pickTokenPrinting(cards, KNIGHT).id, 'new');
  assert.equal(pickTokenPrinting(cards, KNIGHT, ['other', 'old']).id, 'old');
  assert.equal(pickTokenPrinting(cards, { ...KNIGHT, power: 5 }), null);
});

test('searches Scryfall by type, power/toughness, colors and keywords', () => {
  assert.equal(tokenQuery(KNIGHT), 't:token t:creature t:knight pow=2 tou=2 c=W keyword:"vigilance"');
  assert.equal(tokenQuery(TOKEN.FOOD), 't:token t:artifact t:food !"Food"');
});

test('the token art module round-trips', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-art-'));
  try {
    const path = join(dir, 'tokenArt.js');
    const art = { 'token:treasure': { image: { art: 'a; b', card: 'c' }, artist: 'Someone' } };
    await writeFile(path, renderTokenArtModule(art));
    assert.deepEqual(await readTokenArt(path), art);
    assert.deepEqual(await readTokenArt(join(dir, 'missing.js')), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
