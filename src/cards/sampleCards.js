import { CARD_TYPE, KEYWORD } from './cards.js';

/**
 * Sample creatures with one keyword each, for trying out combat rules (e.g. in the
 * debugger). They aren't real cards. Each costs {G} so a single Forest casts one.
 */
const creature = (id, name, power, toughness, keywords) => Object.freeze({
  id, name, manaCost: { G: 1 }, types: [CARD_TYPE.CREATURE], power, toughness, keywords,
});

export const SAMPLE_CARDS = Object.freeze({
  hasteWolf: creature('hasteWolf', 'Haste Wolf', 2, 1, [KEYWORD.HASTE]),
  firstStrikeElk: creature('firstStrikeElk', 'First Strike Elk', 2, 2, [KEYWORD.FIRST_STRIKE]),
  trampleRhino: creature('trampleRhino', 'Trample Rhino', 3, 3, [KEYWORD.TRAMPLE]),
  menaceLynx: creature('menaceLynx', 'Menace Lynx', 2, 1, [KEYWORD.MENACE]),
  deathtouchAsp: creature('deathtouchAsp', 'Deathtouch Asp', 1, 1, [KEYWORD.DEATHTOUCH]),
  flyingOwl: creature('flyingOwl', 'Flying Owl', 1, 1, [KEYWORD.FLYING]),
  reachSpider: creature('reachSpider', 'Reach Spider', 1, 3, [KEYWORD.REACH]),
  lifelinkBat: creature('lifelinkBat', 'Lifelink Bat', 1, 2, [KEYWORD.LIFELINK]),
  defenderWall: creature('defenderWall', 'Defender Wall', 0, 4, [KEYWORD.DEFENDER]),
  vigilanceBear: creature('vigilanceBear', 'Vigilance Bear', 2, 2, [KEYWORD.VIGILANCE]),
});

/** 10 Forests and one of each sample creature. */
export const SAMPLE_DECK = Object.freeze([...Array(10).fill('forest'), ...Object.keys(SAMPLE_CARDS)]);
