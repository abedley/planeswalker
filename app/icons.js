/**
 * The app's icons, as one inline SVG sprite (no image requests). `icon(name)`
 * returns an <svg> that uses a symbol; installIcons() adds the sprite once.
 */
const PATHS = {
  // Keywords
  flying: 'M2 14c4-1 7-4 10-9 1 4 0 7-2 9 3-1 6-3 9-6-1 5-5 9-11 10-2 0-4-1-6-4z',
  firstStrike: 'M5 19 17 7l1-4-4 1L2 16zM14 4l6 6',
  doubleStrike: 'M3 19 13 9l1-4-4 1L0 16zM11 21l10-10 1-4-4 1L8 18',
  deathtouch: 'M12 2a8 8 0 0 0-8 8c0 3 2 5 3 6v3h10v-3c1-1 3-3 3-6a8 8 0 0 0-8-8zM8.5 9.5a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zm7 0a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM10 19v3m4-3v3',
  lifelink: 'M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-3 4.5 4.5 0 0 1 8 3c0 6-8 11-8 11zM12 9v6m-3-3h6',
  trample: 'M3 18 9 6l3 6 3-6 6 12zM3 18h18',
  menace: 'M4 4c1 6 4 9 8 10 4-1 7-4 8-10-3 3-5 4-8 4S7 7 4 4zM8 14l-2 6m10-6 2 6',
  reach: 'M12 2v20M2 12h20M5 5l14 14M19 5 5 19M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  vigilance: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  haste: 'M13 2 4 14h7l-1 8 9-12h-7z',
  defender: 'M12 2 4 5v6c0 6 4 9 8 11 4-2 8-5 8-11V5z',
  // Card types
  creature: 'M4 20c0-6 3-9 6-10l-2-6 4 4 4-4-2 6c3 1 6 4 6 10M9 14h.01M15 14h.01',
  instant: 'M13 2 4 14h7l-1 8 9-12h-7z',
  sorcery: 'M12 3a9 9 0 1 0 9 9c0 3-3 5-6 5a5 5 0 0 1-5-5c0-2 2-4 4-4',
  artifact: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2',
  enchantment: 'M12 2l3 7h7l-6 4 2 8-6-5-6 5 2-8-6-4h7z',
  land: 'M2 20 9 8l4 6 3-4 6 10z',
  token: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  // Interface
  heart: 'M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-3 4.5 4.5 0 0 1 8 3c0 6-8 11-8 11z',
  hand: 'M7 4h8l3 3v13H7zM4 7v13',
  library: 'M5 3h12v16H5zM8 21h12V6',
  grave: 'M7 21V9a5 5 0 0 1 10 0v12zM4 21h16M12 11v5m-2-3h4',
  sword: 'M14 3h7v7L9 22l-3-3 1-1-4-4 4-1 1 1z',
  shield: 'M12 2 4 5v6c0 6 4 9 8 11 4-2 8-5 8-11V5z',
  crown: 'M3 18 2 7l5 4 5-7 5 7 5-4-1 11z',
  gear: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM10 2h4l1 3 3 1 3-2 2 4-2 2v4l2 2-2 4-3-2-3 1-1 3h-4l-1-3-3-1-3 2-2-4 2-2v-4L2 8l2-4 3 2 3-1z',
  sound: 'M4 9h4l5-4v14l-5-4H4zM16 8a5 5 0 0 1 0 8m2-11a9 9 0 0 1 0 14',
  mute: 'M4 9h4l5-4v14l-5-4H4zM16 9l6 6m0-6-6 6',
  back: 'M15 4 7 12l8 8',
  close: 'M5 5l14 14M19 5 5 19',
  cards: 'M3 6h12v15H3zM8 3h13v15',
  star: 'M12 2l3 7h7l-6 4 2 8-6-5-6 5 2-8-6-4h7z',
  skull: 'M12 2a8 8 0 0 0-8 8c0 3 2 5 3 6v3h10v-3c1-1 3-3 3-6a8 8 0 0 0-8-8zM8.5 9.5a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zm7 0a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z',
  plus: 'M12 4v16M4 12h16',
  minus: 'M4 12h16',
  check: 'M4 12l5 5L20 6',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  flag: 'M5 21V3m0 1h12l-3 4 3 4H5',
  zzz: 'M4 5h6L4 12h6M13 12h5l-5 6h5',
  // A hooded figure: the portrait of someone without art.
  hooded: 'M12 2C8 2 5.5 5 5.5 9.5c0 2.6.8 4.6 1.8 6L4 22h16l-3.3-6.5c1-1.4 1.8-3.4 1.8-6C18.5 5 16 2 12 2zm0 5.5c1.9 0 3.2 1.7 3.2 4 0 1.6-.7 3-1.6 3.8L12 17l-1.6-1.7c-.9-.8-1.6-2.2-1.6-3.8 0-2.3 1.3-4 3.2-4z',
};

/** Icons drawn with strokes rather than fills. */
const STROKED = new Set(['firstStrike', 'reach', 'hand', 'library', 'grave', 'artifact', 'sound', 'mute', 'back', 'close',
  'cards', 'plus', 'minus', 'check', 'flag', 'zzz', 'sorcery', 'creature', 'gear', 'trample', 'menace']);

export function installIcons() {
  if (document.getElementById('icon-sprite')) return;
  const symbols = Object.entries(PATHS).map(([name, d]) => {
    const style = STROKED.has(name)
      ? 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
      : 'fill="currentColor"';
    return `<symbol id="i-${name}" viewBox="0 0 24 24"><path d="${d}" ${style}/></symbol>`;
  }).join('');
  const holder = document.createElement('div');
  holder.innerHTML = `<svg id="icon-sprite" xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols}</svg>`;
  document.body.prepend(holder.firstChild);
}

/** An icon element (`class="icon"`), sized by CSS. */
export function icon(name, extraClass = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icon ${extraClass}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${PATHS[name] ? name : 'star'}`);
  svg.append(use);
  return svg;
}

export const hasIcon = (name) => Boolean(PATHS[name]);
