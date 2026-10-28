/** Bits shared by the campaign screens. */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { AI_KIND } from '../../src/campaign/campaign.js';
import { symbolText, inlineSymbols } from '../symbols.js';

/** Name, color and portrait for a planeswalker or opponent (for crests). */
export const personInfo = (person, fallbackName) => ({
  name: person?.name ?? fallbackName, color: person?.color, art: person?.art, portrait: person?.portrait,
});

/** 1–4: how hard an opponent is, from its AI and life. */
export function difficultyOf(opponent, boss = false) {
  if (boss) return 4;
  if (opponent.ai.kind === AI_KIND.BASIC) return 1;
  return (opponent.ai.budgetMs ?? 0) < 1000 ? 2 : 3;
}

export function difficultyPips(level) {
  return h('span.difficulty', Array.from({ length: 4 }, (_, i) => h(`span.dpip${i < level ? '.on' : ''}`)));
}

export function hearts(lives, max = lives) {
  return h('span.hearts', Array.from({ length: Math.max(lives, max) }, (_, i) => icon('heart', i < lives ? 'full' : 'empty')));
}

/** A header bar with an optional back button and right-side content. */
export function header({ title, onBack, right }) {
  return h('header.top',
    onBack ? h('button.icon-btn', { onclick: onBack, 'aria-label': 'Back' }, icon('back')) : h('span.spacer'),
    h('h2', title),
    right ?? h('span.spacer'));
}

/** A planeswalker power, drawn like a card (for rewards and the run map). */
export function powerFace(power, content) {
  const emblem = power.emblemId ? content.emblems?.[power.emblemId] : null;
  const glyph = { emblem: 'star', activations: 'bolt', startingLife: 'heart', extraLife: 'plus' }[power.kind] ?? 'star';
  return h('div.card-face.power-face',
    h('div.cf-top', h('span.cf-name', power.name)),
    h('div.power-glyph', icon(glyph)),
    h('div.cf-type', 'Planeswalker power'),
    h('div.cf-text', symbolText(power.text ?? '')),
    emblem ? h('div.power-ability', emblem.abilities.map((a) => h('div', inlineSymbols(a.text)))) : null);
}
