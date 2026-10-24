/**
 * Things shown over a screen: card inspection, choice sheets, the deck viewer,
 * settings and confirmations. One at a time; tapping the backdrop closes them.
 */
import { h } from './dom.js';
import { icon } from './icons.js';
import { fullCard } from './cardView.js';
import { manaValue } from '../src/cards/cards.js';
import { symbolText } from './symbols.js';

export function createOverlays(app) {
  let open = null;

  function close() {
    if (!open) return;
    const { el, onClose } = open;
    open = null;
    el.style.pointerEvents = 'none';
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished
      .catch(() => {}).then(() => el.remove());
    onClose?.();
  }

  function show(content, { onClose, kind = 'sheet', dismissable = true } = {}) {
    close();
    const el = h(`div.overlay.overlay-${kind}`, h('div.backdrop'), content);
    // A tap that opened this overlay (on pointerup) still sends its click, which lands
    // here, on the backdrop or on whatever option is under the finger. Only clicks whose
    // press (or key) also started here count.
    let pressed = false;
    el.addEventListener('pointerdown', () => { pressed = true; });
    el.addEventListener('keydown', () => { pressed = true; });
    el.addEventListener('click', (event) => {
      if (!pressed) {
        event.stopPropagation();
        event.preventDefault();
      }
    }, { capture: true });
    if (dismissable) {
      el.addEventListener('click', (event) => {
        if (event.target === el || event.target.classList.contains('backdrop')) close();
      });
    }
    app.root.append(el);
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    content.animate([{ transform: 'translateY(24px) scale(.97)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    open = { el, onClose };
    return el;
  }

  /** A big view of a card (real cards show their full image, artist included). Tap anywhere to close it. */
  function inspect(card, { actions = [] } = {}) {
    app.sound('select');
    const view = h('div.inspect',
      fullCard(card, app.definitions, { big: true }),
      actions.length ? h('div.inspect-actions', actions.map((a) => h('button.btn', {
        class: a.primary ? 'primary' : '',
        disabled: a.disabled,
        onclick: () => { close(); a.onPick(); },
      }, a.label))) : null);
    view.addEventListener('click', (event) => {
      if (!event.target.closest('button')) close();
    });
    show(view, { kind: 'inspect' });
  }

  /**
   * A list of choices. `options`: `[{ label, sub?, onPick, disabled?, primary? }]`.
   * `onCancel` runs when it closes without a pick (Cancel, or tapping the backdrop).
   */
  function sheet({ title, text, body = null, options, cancel = 'Cancel', onCancel }) {
    let picked = false;
    show(h('div.sheet',
      h('div.sheet-grip'),
      title ? h('h3', title) : null,
      text ? h('div.sheet-text', symbolText(text)) : null,
      body,
      h('div.sheet-options', options.map((o) => h('button.btn.option', {
        class: o.primary ? 'primary' : '',
        disabled: o.disabled,
        onclick: () => { picked = true; close(); o.onPick(); },
      }, h('span.label', o.label), o.sub ? h('span.sub', o.sub) : null))),
      cancel ? h('button.btn.ghost', { onclick: close }, cancel) : null), { onClose: () => { if (!picked) onCancel?.(); } });
  }

  /** Yes or no. */
  function confirm({ title, text, yes = 'Yes', no = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
      let answered = false;
      const answer = (value) => {
        if (answered) return;
        answered = true;
        close();
        resolve(value);
      };
      show(h('div.sheet',
        h('h3', title),
        text ? h('p.sheet-text', text) : null,
        h('div.row', h('button.btn.ghost', { onclick: () => answer(false) }, no),
          h('button.btn', { class: danger ? 'danger' : 'primary', onclick: () => answer(true) }, yes))), { onClose: () => answer(false) });
    });
  }

  /**
   * A deck as a grid of cards, sorted by mana value. With `onPick`, tapping a card
   * picks it (e.g. to remove it); otherwise it inspects it.
   */
  function deck(cardIds, { title = 'Deck', onPick, pickLabel } = {}) {
    const counts = new Map();
    for (const id of cardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    const entries = [...counts].map(([cardId, n]) => ({ card: { ...app.definitions[cardId], cardId, id: cardId }, n }))
      .sort((a, b) => manaValue(a.card.manaCost ?? {}) - manaValue(b.card.manaCost ?? {}) || a.card.name.localeCompare(b.card.name));
    show(h('div.deck-view',
      h('div.deck-head', h('h3', title), h('span.count', `${cardIds.length} cards`),
        h('button.icon-btn', { onclick: close, 'aria-label': 'Close' }, icon('close'))),
      pickLabel ? h('p.sheet-text', pickLabel) : null,
      h('div.deck-grid', entries.map(({ card, n }) => h('button.deck-card', {
        onclick: () => {
          if (onPick) { close(); onPick(card.cardId); } else inspect(card);
        },
      }, fullCard(card, app.definitions), n > 1 ? h('span.qty', `×${n}`) : null)))), { kind: 'deck' });
  }

  /** Sound, speed and auto-pass; plus `extra` buttons (e.g. concede, abandon run). */
  function settings({ extra = [] } = {}) {
    const s = app.settings;
    const toggleRow = (label, key, on, offLabel = 'Off', onLabel = 'On') => h('div.setting',
      h('span', label),
      h('button.btn.small', {
        class: on ? 'primary' : '',
        onclick: (event) => {
          app.updateSettings({ [key]: !app.settings[key] });
          event.currentTarget.classList.toggle('primary', app.settings[key]);
          event.currentTarget.textContent = app.settings[key] ? onLabel : offLabel;
        },
      }, on ? onLabel : offLabel));
    show(h('div.sheet.settings',
      h('h3', 'Settings'),
      toggleRow('Sound', 'sound', s.sound),
      h('div.setting', h('span', 'Animation speed'), h('div.seg', [['Normal', 1], ['Fast', 0.6], ['Turbo', 0.35]].map(([label, value]) => h('button.btn.small', {
        class: s.speed === value ? 'primary' : '',
        onclick: (event) => {
          app.updateSettings({ speed: value });
          for (const b of event.currentTarget.parentElement.children) b.classList.remove('primary');
          event.currentTarget.classList.add('primary');
        },
      }, label)))),
      toggleRow('Auto-pass priority', 'autoPass', s.autoPass, 'Full control', 'Smart'),
      extra.map((e) => h('button.btn', { class: e.danger ? 'danger' : '', onclick: () => { close(); e.onPick(); } }, e.label)),
      h('button.btn.ghost', { onclick: close }, 'Done')), {});
  }

  return { inspect, sheet, confirm, deck, settings, close, get isOpen() { return Boolean(open); } };
}
