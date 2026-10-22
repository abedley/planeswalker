/**
 * Draws the battlefield and animates changes between states.
 *
 * Every card keeps one element for as long as it's visible, keyed by its id, so a
 * card moving from the hand to the stack to the battlefield is the same element
 * gliding between zones (FLIP: measure, move in the DOM, then animate the
 * difference with a transform). Lands are drawn grouped ("Forest ×5"), and the
 * opponent's hand only as a count: the app never shows hidden cards.
 */
import { h, setText, toggle, reconcile } from '../dom.js';
import { icon } from '../icons.js';
import { crest } from '../art.js';
import { symbolText, inlineSymbols } from '../symbols.js';
import { fullCard, boardCard, chipFace, boardSignature, manaPips, cardBack } from '../cardView.js';
import { isCreature, isLand } from '../../src/cards/cards.js';
import { DECISION } from '../../src/engine/Game.js';
import { TURN_PIPS } from './describe.js';
import {
  relRect, flip, floatText, shake, pop, flyAway, crumble, banner, enter,
} from './fx.js';

const DEATH_EVENTS = new Set(['creatureDied', 'permanentDestroyed', 'permanentSacrificed', 'cardBurned', 'spellCountered']);

export class BoardView {
  #app;
  #me;
  #opp;
  /** id → { el, zone, sig } for every card element on screen. */
  #cards = new Map();
  /** `${playerId}:${cardId}` → element, for grouped lands. */
  #landGroups = new Map();
  #abilityButtons = new Map();
  /** Each player's `{ name, color?, art? }`, for their crest. */
  #info = {};
  /** Stack object id → its element (spells are keyed by card id). */
  #stackObjects = new Map();
  #parts = {};
  #lastLife = {};
  #handWidth = 0;
  #selectedHandId = null;
  #state = null;
  #lineTimer = null;
  #previewKey = null;

  constructor(app, { me, opp, meInfo, oppInfo }) {
    this.#app = app;
    this.#me = me;
    this.#opp = opp;
    this.#info = { [me]: meInfo, [opp]: oppInfo };
    this.el = this.#build(meInfo, oppInfo);
  }

  get parts() { return this.#parts; }

  #bar(side, info) {
    const life = h('div.life', { dataset: { player: side === 'me' ? this.#me : this.#opp } }, h('span.life-n', '20'));
    const avatar = h('div.avatar', { dataset: { player: side === 'me' ? this.#me : this.#opp } }, crest(info, { size: 'sm' }), h('div.think-ring'));
    const counts = h('div.counts',
      h('span.count.hand-count', icon('hand'), h('b', '0')),
      h('span.count.lib-count', icon('library'), h('b', '0')),
      h('span.count.grave-count', icon('grave'), h('b', '0')));
    const abilities = h('div.abilities');
    const parts = { life, avatar, counts, abilities };
    if (side === 'me') {
      parts.main = h('button.main-btn', { disabled: true }, h('span.main-label', '…'), h('span.spinner'), h('span.full-badge', 'Full control'));
      const bar = h('div.bar.bar-me', avatar, h('div.who', h('div.name', info.name), counts), abilities, life, parts.main);
      return { bar, parts };
    }
    const bar = h('div.bar.bar-opp', avatar, h('div.who', h('div.name', info.name), counts), abilities, life);
    return { bar, parts };
  }

  #build(meInfo, oppInfo) {
    const opp = this.#bar('opp', oppInfo);
    const me = this.#bar('me', meInfo);
    const strip = (side) => {
      const lands = h('div.lands');
      const pool = h('div.pool');
      const perms = h('div.perms');
      return { el: h(`div.strip.strip-${side}`, lands, pool, perms), lands, pool, perms };
    };
    const oppStrip = strip('opp');
    const meStrip = strip('me');
    const oppCreatures = h('div.zone.creatures.zone-opp');
    const meCreatures = h('div.zone.creatures.zone-me');
    const pips = h('div.pips-turn', TURN_PIPS.map((p) => h('span.tp', { dataset: { pip: p.id } }, p.label)));
    const prompt = h('div.prompt');
    // Whose turn it is: a badge in the middle of the board (and the active side lights up).
    const turnBadge = h('div.turn-badge', h('span.tb-who'), h('span.tb-n'));
    const lane = h('div.lane', turnBadge, prompt, pips);
    const hand = h('div.hand');
    const stack = h('div.stack-zone');
    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    lines.setAttribute('class', 'lines');
    const fx = h('div.fx');
    const preview = h('div.preview');
    this.#parts = {
      opp: opp.parts, me: me.parts, oppStrip, meStrip, oppCreatures, meCreatures, pips, prompt, lane, hand, stack, lines, fx, preview, turnBadge,
    };
    return h('div.battle',
      opp.bar, oppStrip.el, oppCreatures, lane, meCreatures, meStrip.el, me.bar, hand,
      stack, lines, preview, fx);
  }

  /** The element showing `id`: a card, a player's avatar, or a land group holding it. */
  elementFor(id) {
    if (id === this.#me) return this.#parts.me.avatar;
    if (id === this.#opp) return this.#parts.opp.avatar;
    return this.#cards.get(id)?.el ?? this.#stackObjects.get(id) ?? this.#emblemElement(id);
  }

  /** An emblem (a planeswalker's abilities): its first ability button, or its owner's portrait. */
  #emblemElement(id) {
    for (const side of ['me', 'opp']) {
      const button = [...this.#parts[side].abilities.children].find((b) => b.dataset.emblem === id);
      if (button) return button;
    }
    const owner = this.#state?.players.find((p) => p.emblems.some((e) => e.id === id));
    return owner ? this.elementFor(owner.id) : null;
  }

  /**
   * Where a stack object's targeting arrow starts: an ability's source (the
   * permanent, or the planeswalker ability button), a spell's own card.
   */
  #arrowSource(object) {
    if (object.kind === 'spell') return this.#cards.get(object.card.id)?.el ?? null;
    const button = this.#abilityButtons.get(`${object.sourceId}/${object.abilityId}`);
    if (button?.isConnected) return button;
    const source = this.#cards.get(object.sourceId);
    if (source && source.zone !== 'stack') return source.el;
    return this.#emblemElement(object.sourceId) ?? this.#cards.get(object.id)?.el ?? null;
  }

  // ---------------------------------------------------------------------------
  // Rendering

  /** The zones of a state: which card ids go where. */
  #layout(state) {
    const me = state.players.find((p) => p.id === this.#me);
    const zones = new Map();
    const put = (zone, cards) => cards.forEach((card) => zones.set(card.id, { zone, card }));
    put('hand', me.hand);
    for (const pid of [this.#me, this.#opp]) {
      const mine = state.battlefield.filter((p) => p.controllerId === pid);
      put(`creatures-${pid}`, mine.filter(isCreature));
      put(`perms-${pid}`, mine.filter((p) => !isCreature(p) && !isLand(p)));
    }
    state.stack.slice(-4).forEach((object) => {
      if (object.kind === 'spell') zones.set(object.card.id, { zone: 'stack', card: object.card, object });
      else zones.set(object.id, { zone: 'stack', card: null, object });
    });
    return zones;
  }

  #containerFor(zone) {
    if (zone === 'hand') return this.#parts.hand;
    if (zone === 'stack') return this.#parts.stack;
    const [kind, pid] = zone.split('-');
    const side = pid === this.#me ? 'me' : 'opp';
    return kind === 'creatures' ? this.#parts[`${side}Creatures`] : this.#parts[`${side}Strip`].perms;
  }

  #face(zone, entry, state) {
    const defs = this.#app.definitions;
    if (zone === 'hand') return fullCard(entry.card, defs);
    if (zone === 'stack') {
      if (entry.card) return fullCard(entry.card, defs);
      return this.#abilityFace(entry.object, state);
    }
    if (zone.startsWith('creatures')) {
      const attachments = state.battlefield.filter((p) => p.attachedTo === entry.card.id);
      return boardCard(entry.card, defs, { attachments });
    }
    return chipFace(entry.card, defs);
  }

  /**
   * An ability on the stack: its source (the planeswalker's crest, or the
   * permanent's art) and name, the cost it was activated for, and its effect.
   */
  #abilityFace(object, state) {
    const defs = this.#app.definitions;
    const [, cost, effect] = object.text?.match(/^([^:]+):\s*(.*)$/s) ?? [null, null, object.text ?? ''];
    const owner = state.players.find((p) => p.emblems.some((e) => e.id === object.sourceId));
    const permanent = state.battlefield.find((p) => p.id === object.sourceId);
    const thumb = owner && this.#info[owner.id] ? crest(this.#info[owner.id], { size: 'sm' })
      : permanent ? chipFace(permanent, defs) : null;
    return h('div.card-face.ability-face',
      h('div.af-head', thumb ? h('div.af-src', thumb) : null, h('span.af-name', object.sourceName)),
      h('div.af-text', withCost(symbolText(effect), cost)));
  }

  #signature(zone, entry, state) {
    if (zone.startsWith('creatures')) {
      const attachments = state.battlefield.filter((p) => p.attachedTo === entry.card.id).map((p) => p.id).join();
      return `${zone}|${boardSignature(entry.card, attachments)}`;
    }
    return zone;
  }

  /**
   * Shows `state`. With `animate`, cards glide to their new places and `events`
   * add effects (damage numbers, deaths, banners). Resolves when the animations
   * that should finish before the next state are done.
   */
  render(state, { events = [], speed = 1, animate = true } = {}) {
    const previous = this.#state;
    this.#state = state;
    const root = this.el;
    const zones = this.#layout(state);
    const blocking = [];

    // Has anything moved between zones? If not, there's nothing to measure.
    let moved = !previous;
    for (const [id, { zone }] of zones) if (this.#cards.get(id)?.zone !== zone) moved = true;
    for (const id of this.#cards.keys()) if (!zones.has(id)) moved = true;
    const firstRects = new Map();
    const anchorsBefore = {};
    if (animate && moved && previous) {
      for (const [id, record] of this.#cards) firstRects.set(id, relRect(record.el, root));
      anchorsBefore.oppHand = relRect(this.#parts.opp.counts.querySelector('.hand-count'), root);
      anchorsBefore.meLib = relRect(this.#parts.me.counts.querySelector('.lib-count'), root);
    }

    // Cards leaving the screen: lift them into the effects layer where they were.
    const leaving = [];
    for (const [id, record] of this.#cards) {
      if (zones.has(id)) continue;
      this.#cards.delete(id);
      const rect = firstRects.get(id);
      if (!rect) {
        record.el.remove();
        continue;
      }
      const el = record.el;
      el.style.translate = 'none';
      el.style.rotate = 'none';
      el.classList.add('leaving');
      Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
      this.#parts.fx.append(el);
      leaving.push({ id, el, from: record.zone });
    }

    // Place every card in its zone.
    const wanted = new Map();
    const created = [];
    for (const [id, entry] of zones) {
      let record = this.#cards.get(id);
      if (!record) {
        record = { el: h('div.card', { dataset: { id } }), zone: null, sig: null };
        this.#cards.set(id, record);
        created.push(id);
      }
      const sig = this.#signature(entry.zone, entry, state);
      if (record.zone !== entry.zone || record.sig !== sig) {
        if (record.zone !== entry.zone) record.el.className = `card z-${entry.zone.split('-')[0]}`;
        record.el.replaceChildren(this.#face(entry.zone, entry, state));
        record.zone = entry.zone;
        record.sig = sig;
      }
      record.el.dataset.zone = entry.zone;
      if (entry.object) record.el.dataset.stackId = entry.object.id;
      else delete record.el.dataset.stackId;
      const container = this.#containerFor(entry.zone);
      if (!wanted.has(container)) wanted.set(container, []);
      wanted.get(container).push(record.el);
    }
    for (const container of [this.#parts.hand, this.#parts.stack, this.#parts.meCreatures, this.#parts.oppCreatures,
      this.#parts.meStrip.perms, this.#parts.oppStrip.perms]) {
      reconcile(container, wanted.get(container) ?? []);
    }
    this.#stackObjects = new Map(state.stack.flatMap((object) => {
      const el = this.#cards.get(object.kind === 'spell' ? object.card.id : object.id)?.el;
      return el ? [[object.id, el]] : [];
    }));
    this.#updateCombat(state);
    this.#updateStates(state);
    this.#layoutHand();
    this.#layoutStack();
    this.#updateBoardDensity();
    const landPops = this.#renderLands(state, previous);
    this.#renderBars(state, previous, { animate, speed });
    this.#renderPips(state);

    if (!animate || !previous) {
      this.#drawLines(state);
      return Promise.resolve();
    }

    // FLIP the cards that moved, and bring in new ones.
    if (moved) {
      for (const [id, record] of this.#cards) {
        const first = firstRects.get(id);
        const isNew = created.includes(id);
        if (!first && !isNew) continue;
        const last = relRect(record.el, root);
        if (first) {
          const fromHand = record.zone === 'stack' && first.y > last.y;
          blocking.push(flip(record.el, first, last, { speed, duration: fromHand ? 300 : 360 }));
        } else if (record.zone === 'hand') {
          const lib = anchorsBefore.meLib ?? relRect(this.#parts.me.counts, root);
          blocking.push(flip(record.el, { x: lib.x, y: lib.y, w: 20, h: 28 }, last, { speed, duration: 420, delay: 40 * created.indexOf(id) }));
        } else if (record.zone === 'stack') {
          const object = zones.get(id).object;
          const source = object.kind !== 'spell' ? this.elementFor(object.sourceId) : null;
          const from = source ? relRect(source, root) : (anchorsBefore.oppHand ?? last);
          blocking.push(flip(record.el, { ...from, w: from.w || 20, h: from.h || 28 }, last, { speed, duration: 380, flipFace: object.controllerId !== this.#me && object.kind === 'spell' }));
        } else {
          blocking.push(enter(record.el, { speed }));
        }
      }
    }
    for (const group of landPops) blocking.push(pop(group, { speed, scale: 1.15 }));

    // Cards that left: break apart, or fly to where they went.
    const dying = new Map();
    for (const event of events) {
      if (DEATH_EVENTS.has(event.name)) dying.set(event.payload.cardId, event.name);
      if (event.name === 'permanentExiled') dying.set(event.payload.cardId, 'exile');
    }
    for (const { id, el } of leaving) {
      if (dying.has(id)) {
        const kind = dying.get(id) === 'cardBurned' ? 'burn' : dying.get(id) === 'exile' ? 'exile' : 'die';
        blocking.push(crumble(el, this.#parts.fx, { speed, kind }));
      } else {
        blocking.push(flyAway(el, this.#destination(state, id), { speed }));
      }
    }

    this.#effects(events, state, speed, blocking);
    this.#drawLines(state);
    clearTimeout(this.#lineTimer);
    this.#lineTimer = setTimeout(() => this.#drawLines(this.#state), 380 * speed);
    return Promise.all(blocking);
  }

  /** Where a card that left the screen went: a land group, a graveyard, a hand. */
  #destination(state, id) {
    const root = this.el;
    const land = state.battlefield.find((p) => p.id === id);
    if (land) {
      const group = this.#landGroups.get(`${land.controllerId}:${land.cardId}`);
      if (group) return relRect(group, root);
    }
    for (const player of state.players) {
      const side = player.id === this.#me ? 'me' : 'opp';
      if (player.hand.some((c) => c.id === id)) return relRect(this.#parts[side].counts.querySelector('.hand-count'), root);
      if (player.graveyard.some((c) => c.id === id) || player.exile.some((c) => c.id === id)) {
        return relRect(this.#parts[side].counts.querySelector('.grave-count'), root);
      }
    }
    return relRect(this.#parts.lane, root);
  }

  /** Attacking and blocking creatures step forward. */
  #updateCombat(state) {
    const decision = state.pendingDecision;
    const attacking = new Set(decision?.type === DECISION.DECLARE_ATTACKERS ? decision.attackers : state.combat.attackers.map((a) => a.cardId));
    const blocking = new Set(decision?.type === DECISION.DECLARE_BLOCKERS
      ? Object.keys(decision.blocks)
      : state.combat.attackers.flatMap((a) => a.blockerIds));
    for (const [id, record] of this.#cards) {
      if (!record.zone.startsWith('creatures')) continue;
      toggle(record.el, 'attacking', attacking.has(id));
      toggle(record.el, 'blocking', blocking.has(id));
    }
  }

  /** Tapped, summoning sick, and similar per-card states. */
  #updateStates(state) {
    for (const [id, record] of this.#cards) {
      if (record.zone === 'hand' || record.zone === 'stack') continue;
      const permanent = state.battlefield.find((p) => p.id === id);
      if (!permanent) continue;
      toggle(record.el, 'tapped', permanent.tapped);
      toggle(record.el, 'sick', isCreature(permanent) && permanent.summoningSick && !permanent.keywords.includes('haste')
        && permanent.controllerId === state.activePlayerId);
      toggle(record.el, 'attached', Boolean(permanent.attachedTo));
    }
  }

  /** Fans the hand: cards overlap more as the hand grows. */
  #layoutHand() {
    const cards = [...this.#parts.hand.children];
    const n = cards.length;
    if (!this.#handWidth) this.#handWidth = this.#parts.hand.clientWidth || 374;
    const width = this.#handWidth;
    const cardWidth = parseFloat(getComputedStyle(this.#parts.hand).getPropertyValue('--hand-w')) || 88;
    // Overlap as needed to keep the fan (and its tilt) on screen.
    const spread = n > 1 ? Math.min(cardWidth * 0.82, (width - cardWidth - 12) / (n - 1)) : 0;
    cards.forEach((el, i) => {
      const offset = i - (n - 1) / 2;
      const selected = el.dataset.id === this.#selectedHandId;
      const x = width / 2 - cardWidth / 2 + offset * spread;
      const y = selected ? -38 : Math.abs(offset) ** 2 * 1.3;
      el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
      el.style.rotate = selected ? '0deg' : `${(offset * 2.4).toFixed(2)}deg`;
      el.style.zIndex = selected ? 50 : i + 1;
    });
  }

  #layoutStack() {
    const cards = [...this.#parts.stack.children];
    cards.forEach((el, i) => {
      const fromTop = cards.length - 1 - i;
      el.style.translate = `${-fromTop * 18}px ${fromTop * 6}px`;
      el.style.zIndex = i + 1;
      toggle(el, 'under', fromTop > 0);
    });
    toggle(this.#parts.stack, 'active', cards.length > 0);
    toggle(this.el, 'stacked', cards.length > 0);
  }

  /** Two rows of smaller cards once a side has more than five creatures. */
  #updateBoardDensity() {
    for (const zone of [this.#parts.meCreatures, this.#parts.oppCreatures]) toggle(zone, 'dense', zone.children.length > 5);
  }

  #renderLands(state, previous) {
    const pops = [];
    for (const pid of [this.#me, this.#opp]) {
      const strip = this.#parts[pid === this.#me ? 'meStrip' : 'oppStrip'];
      const groups = new Map();
      for (const land of state.battlefield.filter((p) => p.controllerId === pid && isLand(p))) {
        const key = `${pid}:${land.cardId}`;
        if (!groups.has(key)) groups.set(key, { land, total: 0, untapped: 0 });
        const group = groups.get(key);
        group.total += 1;
        if (!land.tapped) group.untapped += 1;
      }
      const els = [];
      for (const [key, { land, total, untapped }] of groups) {
        let el = this.#landGroups.get(key);
        if (!el) {
          el = h('div.land-group', { dataset: { land: land.id } }, chipFace(land, this.#app.definitions), h('span.land-n'), h('span.land-u'));
          this.#landGroups.set(key, el);
        }
        const before = previous ? previous.battlefield.filter((p) => p.controllerId === pid && p.cardId === land.cardId).length : total;
        if (total > before) pops.push(el);
        setText(el.querySelector('.land-n'), `×${total}`);
        setText(el.querySelector('.land-u'), untapped < total ? `${untapped} ready` : '');
        toggle(el, 'spent', untapped === 0);
        els.push(el);
      }
      for (const key of [...this.#landGroups.keys()]) {
        if (key.startsWith(`${pid}:`) && !groups.has(key)) this.#landGroups.delete(key);
      }
      reconcile(strip.lands, els);
      const pool = state.players.find((p) => p.id === pid).manaPool;
      const floating = Object.fromEntries(Object.entries(pool).filter(([, n]) => n > 0));
      const poolKey = JSON.stringify(floating);
      if (strip.pool.dataset.key !== poolKey) {
        strip.pool.dataset.key = poolKey;
        strip.pool.replaceChildren(Object.keys(floating).length ? manaPips(floating) : '');
      }
    }
    return pops;
  }

  #renderBars(state, previous, { animate, speed }) {
    for (const player of state.players) {
      const side = player.id === this.#me ? 'me' : 'opp';
      const parts = this.#parts[side];
      setText(parts.life.querySelector('.life-n'), player.life);
      const before = this.#lastLife[player.id];
      if (animate && before !== undefined && before !== player.life) {
        parts.life.classList.toggle('gain', player.life > before);
        pop(parts.life, { speed, scale: 1.35 });
      }
      this.#lastLife[player.id] = player.life;
      toggle(parts.life, 'low', player.life <= 5);
      const [hand, lib, grave] = parts.counts.querySelectorAll('b');
      setText(hand, player.hand.length);
      setText(lib, player.library.length);
      setText(grave, player.graveyard.length);
      toggle(parts.avatar.parentElement, 'active', state.activePlayerId === player.id);
      this.#renderAbilities(player, side);
    }
  }

  /** Planeswalker abilities: buttons for us, small badges for the opponent. */
  #renderAbilities(player, side) {
    const parts = this.#parts[side];
    const abilities = player.emblems.flatMap((emblem) => emblem.abilities.map((ability) => ({ emblem, ability })));
    const key = abilities.map(({ emblem, ability }) => `${emblem.id}/${ability.id}/${emblem.activationsThisTurn}`).join();
    if (parts.abilities.dataset.key === key) return;
    parts.abilities.dataset.key = key;
    const buttons = abilities.slice(0, 4).map(({ emblem, ability }) => {
      const left = Number.isFinite(emblem.activationsPerTurn) ? emblem.activationsPerTurn - emblem.activationsThisTurn : null;
      const cost = ability.cost ?? {};
      // A short name: the ability's own, or its emblem's ("Warden's Growth" → "Growth").
      const label = ability.name ?? (emblem.abilities.length === 1 ? emblem.name.replace(/^.*['’]s\s+/, '') : ability.text.replace(/^[^:]*:\s*/, ''));
      const button = h(`button.ability-btn.${side}`, { dataset: { emblem: emblem.id, ability: ability.id } },
        h('span.ab-cost', cost.mana ? manaPips(cost.mana) : cost.life ? `−${cost.life}♥` : '0'),
        side === 'me' ? h('span.ab-text', label) : null,
        left !== null ? h('span.ab-uses', '•'.repeat(Math.max(0, left))) : null);
      this.#abilityButtons.set(`${emblem.id}/${ability.id}`, button);
      return button;
    });
    parts.abilities.replaceChildren(...buttons);
  }

  #renderPips(state) {
    const mine = state.activePlayerId === this.#me;
    toggle(this.#parts.pips, 'theirs', !mine);
    // Whose turn: the badge, and the active side's panel and portrait.
    const badge = this.#parts.turnBadge;
    if (state.activePlayerId && badge.dataset.turn !== String(state.turn)) {
      const changed = badge.dataset.turn !== undefined;
      badge.dataset.turn = String(state.turn);
      setText(badge.querySelector('.tb-who'), mine ? 'Your turn' : 'Opponent\'s turn');
      setText(badge.querySelector('.tb-n'), String(Math.ceil(state.turn / 2)));
      if (changed) badge.animate([{ transform: 'scale(1.25)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    toggle(badge, 'theirs', !mine);
    toggle(this.el, 'my-turn', Boolean(state.activePlayerId) && mine);
    toggle(this.el, 'their-turn', Boolean(state.activePlayerId) && !mine);
    for (const el of this.#parts.pips.children) {
      const pip = TURN_PIPS.find((p) => p.id === el.dataset.pip);
      toggle(el, 'now', pip.match(state));
    }
  }

  /** Lines for blocks and for the targets of the top of the stack. */
  #drawLines(state) {
    if (!state) return;
    const root = this.el;
    const svg = this.#parts.lines;
    const paths = [];
    const center = (el) => {
      const r = relRect(el, root);
      return [r.cx, r.cy];
    };
    const decision = state.pendingDecision;
    const blocks = decision?.type === DECISION.DECLARE_BLOCKERS
      ? Object.entries(decision.blocks)
      : state.combat.attackers.flatMap((a) => a.blockerIds.map((b) => [b, a.cardId]));
    for (const [blockerId, attackerId] of blocks) {
      const a = this.elementFor(blockerId);
      const b = this.elementFor(attackerId);
      if (a && b) {
        const [x1, y1] = center(a);
        const [x2, y2] = center(b);
        paths.push(`<line class="block-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`);
      }
    }
    const top = state.stack.at(-1);
    // Something still flying in would give the arrow a wrong end: draw it once it lands.
    // (Only animations that end: a glow loops forever.)
    const flights = (el) => el.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity);
    for (const targetId of top?.targets ?? []) {
      const source = this.#arrowSource(top);
      const target = this.elementFor(targetId);
      const pending = source && target ? [...flights(source), ...flights(target)] : [];
      if (pending.length) {
        Promise.all(pending.map((a) => a.finished.catch(() => {}))).then(() => this.#drawLines(this.#state));
        continue;
      }
      if (source && target) {
        const [x1, y1] = center(source);
        const [x2, y2] = center(target);
        const mx = (x1 + x2) / 2 + (y2 - y1) * 0.2;
        const my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.2;
        paths.push(`<path class="target-line ${top.controllerId === this.#me ? 'mine' : 'theirs'}" d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" marker-end="url(#arrow)" />`);
      }
    }
    const html = paths.join('');
    if (svg.dataset.html === html) return;
    svg.dataset.html = html;
    svg.innerHTML = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>${html}`;
  }

  /** Damage numbers, life changes, stat pops and turn banners. */
  #effects(events, state, speed, blocking) {
    const root = this.el;
    const sound = this.#app.sound;
    const at = (id) => {
      const el = id === this.#me ? this.#parts.me.life : id === this.#opp ? this.#parts.opp.life : this.elementFor(id);
      return el ? { el, rect: relRect(el, root) } : null;
    };
    const hit = (targetId, amount) => {
      const target = at(targetId);
      if (!target) return;
      // A buzz when you're hit, where phones support it (not iOS).
      if (targetId === this.#me) navigator.vibrate?.(40);
      floatText(this.#parts.fx, target.rect.cx, target.rect.cy, `−${amount}`, 'damage', { speed });
      shake(target.el, { speed });
    };
    for (const { name, payload } of events) {
      switch (name) {
        case 'combatDamageDealt':
          sound('hit');
          for (const d of payload.damage) hit(d.targetPlayerId ?? d.targetCardId, d.amount);
          break;
        case 'damageDealt':
          sound('hit');
          hit(payload.targetPlayerId ?? payload.targetCardId, payload.amount);
          break;
        case 'lifeGained': {
          sound('gain');
          const target = at(payload.playerId);
          if (target) floatText(this.#parts.fx, target.rect.cx, target.rect.cy, `+${payload.amount}`, 'heal', { speed });
          break;
        }
        case 'lifeLost': {
          sound('lose');
          const target = at(payload.playerId);
          if (target) floatText(this.#parts.fx, target.rect.cx, target.rect.cy, `−${payload.amount}`, 'damage', { speed });
          break;
        }
        case 'countersAdded':
        case 'temporaryEffectCreated': {
          const target = at(payload.cardId ?? payload.targetId);
          if (target) {
            pop(target.el, { speed });
            const text = name === 'countersAdded' ? `+${payload.count}` : `${payload.power >= 0 ? '+' : ''}${payload.power ?? 0}/${payload.toughness >= 0 ? '+' : ''}${payload.toughness ?? 0}`;
            floatText(this.#parts.fx, target.rect.cx, target.rect.y, text, 'buff', { speed });
          }
          break;
        }
        case 'cardBurned':
          sound('burn');
          if (payload.playerId === this.#me) {
            const r = relRect(this.#parts.hand, root);
            floatText(this.#parts.fx, r.cx, r.y, `${payload.cardName} burned — hand full`, 'warn', { speed: speed * 1.6 });
          }
          break;
        case 'tokensLimited':
          if (payload.playerId === this.#me) {
            const r = relRect(this.#parts.meCreatures, root);
            floatText(this.#parts.fx, r.cx, r.cy, 'Board full', 'warn', { speed });
          }
          break;
        case 'cardsDrawn':
          if (payload.playerId === this.#me) sound('draw');
          break;
        case 'landPlayed': sound('land'); break;
        case 'spellCast': sound('cast'); break;
        case 'abilityActivated': if (payload.usesStack) sound('cast'); break;
        case 'permanentEntered': if (isCreature(payload.card)) sound('enter'); break;
        case 'tokenCreated': sound('enter'); break;
        case 'creatureDied': case 'permanentDestroyed': case 'permanentExiled': sound('die'); break;
        case 'attackersDeclared': if (payload.attackers.length) sound('attack'); break;
        case 'turnStarted': {
          const mine = payload.activePlayerId === this.#me;
          sound('turn');
          blocking.push(banner(this.#parts.fx, mine ? 'Your turn' : 'Opponent\'s turn', mine ? 'mine' : 'theirs', { speed, hold: mine ? 520 : 320 }));
          break;
        }
        default:
          break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Interaction highlights (no re-render)

  /**
   * What the player can do now, as highlights: `playable`, `canAttack`, `canBlock`,
   * `targetable` (ids, including player ids), `selected` (an id), `pickedBlocker`,
   * `abilities` (keys "emblemId/abilityId"), `main` ({ label, disabled, waiting,
   * fullControl }), `prompt`.
   */
  setInteraction(ctx) {
    for (const [id, record] of this.#cards) {
      toggle(record.el, 'playable', ctx.playable?.has(id));
      toggle(record.el, 'can-attack', ctx.canAttack?.has(id));
      toggle(record.el, 'can-block', ctx.canBlock?.has(id));
      toggle(record.el, 'targetable', ctx.targetable?.has(id) || ctx.targetable?.has(record.el.dataset.stackId));
      toggle(record.el, 'selected', ctx.selected === id);
      toggle(record.el, 'picked', ctx.pickedBlocker === id);
    }
    for (const side of ['me', 'opp']) {
      const pid = side === 'me' ? this.#me : this.#opp;
      toggle(this.#parts[side].avatar, 'targetable', ctx.targetable?.has(pid));
      toggle(this.#parts[side].life, 'targetable', ctx.targetable?.has(pid));
    }
    for (const [key, button] of this.#abilityButtons) {
      if (!button.isConnected) {
        this.#abilityButtons.delete(key);
        continue;
      }
      toggle(button, 'ready', ctx.abilities?.has(key));
      // The ability whose target is being chosen.
      toggle(button, 'selected', Boolean(ctx.selected) && button.dataset.emblem === ctx.selected);
    }
    const main = this.#parts.me.main;
    setText(main.querySelector('.main-label'), ctx.main?.label ?? '');
    main.disabled = Boolean(ctx.main?.disabled);
    toggle(main, 'waiting', Boolean(ctx.main?.waiting));
    toggle(main, 'go', Boolean(ctx.main?.go));
    toggle(main, 'full', Boolean(ctx.main?.fullControl));
    setText(this.#parts.prompt, ctx.prompt ?? '');
    toggle(this.el, 'targeting', Boolean(ctx.targetable?.size));
    if (this.#selectedHandId !== (ctx.selectedHand ?? null)) {
      this.#selectedHandId = ctx.selectedHand ?? null;
      this.#layoutHand();
    }
  }

  setThinking(on) {
    toggle(this.#parts.opp.avatar, 'thinking', on);
  }

  /** What the open preview shows (the `key` it was last shown with), or null. */
  get previewKey() { return this.#previewKey; }

  /**
   * The preview above the hand: a big card and buttons. Pass null to hide it. With
   * `key`, showing the same key again does nothing (no flicker on re-renders).
   */
  showPreview(card, actions = [], { key = null } = {}) {
    const preview = this.#parts.preview;
    if (!card) {
      this.#previewKey = null;
      if (preview.classList.contains('open')) {
        preview.classList.remove('open');
        preview.replaceChildren();
      }
      return;
    }
    if (key && key === this.#previewKey && preview.classList.contains('open')) return;
    const wasOpen = preview.classList.contains('open') && this.#previewKey?.split('|')[0] === key?.split('|')[0];
    this.#previewKey = key;
    preview.replaceChildren(
      h('div.preview-card', fullCard(card, this.#app.definitions, { big: true })),
      h('div.preview-actions', actions.map((a) => h('button.btn', {
        class: [a.primary ? 'primary' : '', a.danger ? 'danger' : ''].join(' '),
        disabled: a.disabled,
        dataset: { action: a.key ?? '' },
        onclick: (event) => {
          event.stopPropagation();
          a.onPick?.();
        },
      }, a.label, a.sub ? h('small', a.sub) : null))),
    );
    preview.classList.add('open');
    // Only animate when a card is first shown, not when its buttons change.
    if (!wasOpen) preview.animate([{ opacity: 0, transform: 'translateY(16px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
  }

  /** A targeting arrow from a point to the finger (for dragged spells). */
  drawArrow(from, to) {
    const svg = this.#parts.lines;
    let path = svg.querySelector('.drag-line');
    if (!from) {
      path?.remove();
      return;
    }
    if (!path) {
      path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'drag-line');
      path.setAttribute('marker-end', 'url(#arrow)');
      if (!svg.querySelector('#arrow')) {
        svg.insertAdjacentHTML('afterbegin', '<defs><marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>');
      }
      svg.append(path);
    }
    const mx = (from.x + to.x) / 2;
    const my = Math.min(from.y, to.y) - 40;
    path.setAttribute('d', `M${from.x},${from.y} Q${mx},${my} ${to.x},${to.y}`);
  }

  /** A short message over the board. */
  toast(text) {
    const r = relRect(this.#parts.lane, this.el);
    floatText(this.#parts.fx, r.cx, r.cy, text, 'warn', { speed: 1.6 });
  }

  /** Victory or defeat. */
  finale(won, speed = 1) {
    this.#app.sound(won ? 'victory' : 'defeat');
    return banner(this.#parts.fx, won ? 'Victory' : 'Defeat', won ? 'victory' : 'defeat', { speed, hold: 1400 });
  }

  /** Re-measures after a resize or rotation. */
  relayout() {
    this.#handWidth = 0;
    this.#layoutHand();
    this.#drawLines(this.#state);
  }

  cardBack() {
    return cardBack();
  }
}

/** Rules-text paragraphs with an ability's cost as a badge at the start of the first. */
function withCost(paragraphs, cost) {
  if (!cost) return paragraphs;
  const badge = h('span.af-cost', inlineSymbols(cost));
  if (paragraphs.length) paragraphs[0].prepend(badge);
  else paragraphs.push(h('p', badge));
  return paragraphs;
}
