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
import { crest, frameOf } from '../art.js';
import { fit } from '../fit.js';
import { fullCard, boardCard, chipFace, abilityFace, boardSignature, manaPips, cardBack } from '../cardView.js';
import { isCreature, isLand } from '../../src/cards/cards.js';
import { DECISION } from '../../src/engine/Game.js';
import { TURN_PIPS, findCard } from './describe.js';
import {
  relRect, flip, floatText, shake, pop, flyAway, crumble, banner, enter,
  impact, shakeScreen, lunge, LUNGE_MS, LUNGE_HIT, projectile, sparkle, slam, showcase, FX_COLORS,
} from './fx.js';

/** How long a spell's bolt takes to reach its target (ms, before `speed`). */
const BOLT_MS = 300;

const DEATH_EVENTS = new Set(['creatureDied', 'permanentDestroyed', 'permanentSacrificed', 'cardBurned', 'spellCountered']);

/** Whether a permanent is its controller's Ring-bearer (701.54a). */
const isRingBearer = (state, id) => state.players.some((p) => p.ring?.bearerId === id
  && state.battlefield.some((b) => b.id === id && b.controllerId === p.id));

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
  #speech = null;
  #aimed = null;
  #handPeek = '';
  #nameObserver = null;

  constructor(app, { me, opp, meInfo, oppInfo }) {
    this.#app = app;
    this.#me = me;
    this.#opp = opp;
    this.#info = { [me]: meInfo, [opp]: oppInfo };
    this.el = this.#build(meInfo, oppInfo);
    // A name's room changes with the abilities and the main button beside it: fit it again.
    if (typeof ResizeObserver === 'function') {
      this.#nameObserver = new ResizeObserver((entries) => entries.forEach((entry) => fit(entry.target)));
      for (const side of ['me', 'opp']) this.#nameObserver.observe(this.#parts[side].avatar.parentElement.querySelector('.who'));
    }
  }

  /** Stops watching the bars (when the battle ends). */
  destroy() {
    this.#nameObserver?.disconnect();
  }

  get parts() { return this.#parts; }

  /** A player's bar: portrait with the life total on it, name and card counts, abilities (and for us, the main button). */
  #bar(side, info) {
    const player = side === 'me' ? this.#me : this.#opp;
    const life = h('div.life', { dataset: { player } }, h('span.life-n', '20'));
    const avatar = h('div.avatar', { dataset: { player } }, crest(info, { size: 'sm' }), h('div.think-ring'), life);
    const counts = h('div.counts',
      h('span.count.hand-count', icon('hand'), h('b', '0')),
      h('span.count.lib-count', icon('library'), h('b', '0')),
      h('span.count.grave-count', icon('grave'), h('b', '0')),
      // Exile: shown once something is there (cards may be played from it: Moria Marauder).
      h('span.count.exile-count', { title: 'Exile' }, icon('exile'), h('b', '0')),
      // The Ring (701.54): how many of its abilities this player's Ring-bearer has; hidden until it tempts them.
      h('span.count.ring-count', { title: 'The Ring' }, icon('ring'), h('b', '0')));
    const abilities = h('div.abilities');
    const parts = { life, avatar, counts, abilities };
    const who = h('div.who', h('div.name.fit', { dataset: { min: 9 } }, info.name), counts);
    if (side === 'me') {
      parts.main = h('button.main-btn', { disabled: true }, h('span.main-label', '…'), h('span.spinner'), h('span.full-badge', 'Full control'));
      return { bar: h('div.bar.bar-me', avatar, who, abilities, parts.main), parts };
    }
    return { bar: h('div.bar.bar-opp', avatar, who, abilities), parts };
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
    // Auras and Equipment on a creature sit beside it, on its controller's side.
    const creatures = state.battlefield.filter(isCreature);
    const hosted = (p) => !isCreature(p) && creatures.some((c) => c.id === p.attachedTo);
    for (const pid of [this.#me, this.#opp]) {
      const mine = state.battlefield.filter((p) => p.controllerId === pid);
      for (const creature of mine.filter(isCreature)) {
        put(`creatures-${pid}`, [creature]);
        put(`attached-${pid}`, state.battlefield.filter((p) => p.attachedTo === creature.id && !isCreature(p)));
      }
      put(`perms-${pid}`, mine.filter((p) => !isCreature(p) && !isLand(p) && !hosted(p)));
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
    return kind === 'creatures' || kind === 'attached' ? this.#parts[`${side}Creatures`] : this.#parts[`${side}Strip`].perms;
  }

  #face(zone, entry, state) {
    const defs = this.#app.definitions;
    if (zone === 'hand') return fullCard(entry.card, defs);
    if (zone === 'stack') {
      if (entry.card) return fullCard(entry.card, defs);
      return this.abilityFace(entry.object, state);
    }
    if (zone.startsWith('creatures')) {
      const attachments = state.battlefield.filter((p) => p.attachedTo === entry.card.id);
      return boardCard(entry.card, defs, { attachments, ringBearer: isRingBearer(state, entry.card.id) });
    }
    return chipFace(entry.card, defs);
  }

  /**
   * An ability on the stack, showing what it comes from: the source card's art
   * (wherever the card is now, e.g. in the graveyard for a "dies" trigger), or the
   * planeswalker's crest for an emblem's ability. `big` for inspecting it.
   */
  abilityFace(object, state, { big = false } = {}) {
    const owner = state.players.find((p) => p.emblems.some((e) => e.id === object.sourceId));
    const portrait = owner && this.#info[owner.id] ? crest(this.#info[owner.id], { size: big ? 'md' : 'sm' }) : null;
    const source = portrait ? null : object.sourceSnapshot ?? findCard(state, object.sourceId);
    return abilityFace(object, { source: source?.cardId ? source : null, portrait, definitions: this.#app.definitions, big });
  }

  #signature(zone, entry, state) {
    if (zone.startsWith('creatures')) {
      const attachments = state.battlefield.filter((p) => p.attachedTo === entry.card.id).map((p) => p.id).join();
      return `${zone}|${boardSignature(entry.card, `${attachments}|${isRingBearer(state, entry.card.id)}`)}`;
    }
    // A Saga's chip shows its chapter.
    return `${zone}|${entry.card?.counters?.lore ?? 0}`;
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
    const zoneBefore = new Map([...this.#cards].map(([id, record]) => [id, record.zone]));

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
    const redrawn = [];
    for (const [id, entry] of zones) {
      let record = this.#cards.get(id);
      if (!record) {
        record = { el: h('div.card', { dataset: { id } }), zone: null, sig: null };
        this.#cards.set(id, record);
        created.push(id);
      }
      const sig = this.#signature(entry.zone, entry, state);
      if (record.zone !== entry.zone || record.sig !== sig) {
        if (record.zone !== entry.zone) record.el.className = `card z-${entry.zone.split('-')[0]}${entry.object && !entry.card ? ' ability' : ''}`;
        record.el.replaceChildren(this.#face(entry.zone, entry, state));
        record.zone = entry.zone;
        record.sig = sig;
        redrawn.push(record.el);
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
    // Damage lands when the blow or the bolt does: life totals change then.
    const hitDelay = animate && previous ? hitDelayOf(events, speed) : 0;
    this.#renderBars(state, previous, { animate, speed, delay: hitDelay });
    this.#renderPips(state);
    if (!previous) fit(this.el);
    else redrawn.forEach(fit);

    if (!animate || !previous) {
      this.#drawLines(state);
      return Promise.resolve();
    }

    // FLIP the cards that moved, and bring in new ones.
    if (moved) {
      const size = relRect(root, root);
      for (const [id, record] of this.#cards) {
        const first = firstRects.get(id);
        const isNew = created.includes(id);
        if (!first && !isNew) continue;
        const last = relRect(record.el, root);
        const arrives = record.zone.startsWith('creatures') && zoneBefore.get(id) !== record.zone;
        if (arrives && (isNew || ['stack', 'hand'].includes(zoneBefore.get(id)))) {
          // A creature coming onto the battlefield: it rises, then slams down.
          const card = state.battlefield.find((p) => p.id === id);
          blocking.push(slam(record.el, first ?? null, last, { speed, onLand: () => this.#landed(record.el, card, speed) }));
        } else if (first) {
          const fromHand = record.zone === 'stack' && first.y > last.y;
          const moved = flip(record.el, first, last, { speed, duration: fromHand ? 300 : 360 });
          blocking.push(moved);
          if (fromHand) {
            // A spell cast from the hand lands on the stack in a burst of its color.
            const { card } = zones.get(id);
            const color = (card && FX_COLORS[frameOf(card)]) ?? FX_COLORS.gold;
            moved.then(() => impact(this.#parts.fx, last.cx, last.cy, { speed, strength: 0.7, color, sparks: 6 }));
          }
        } else if (record.zone === 'hand') {
          const lib = anchorsBefore.meLib ?? relRect(this.#parts.me.counts, root);
          blocking.push(flip(record.el, { x: lib.x, y: lib.y, w: 20, h: 28 }, last, { speed, duration: 420, delay: 40 * created.indexOf(id) }));
        } else if (record.zone === 'stack') {
          const object = zones.get(id).object;
          if (object.kind === 'spell' && object.controllerId !== this.#me) {
            // The opponent's spell: shown big in the middle on its way to the stack, so you see what it is.
            const from = anchorsBefore.oppHand ?? relRect(this.#parts.opp.avatar, root);
            const center = { cx: size.w / 2, cy: size.h * 0.42 };
            const scale = Math.min(2.4, (size.w * 0.52) / (last.w || 88));
            this.#parts.stack.classList.add('showcasing');
            const shown = showcase(record.el, from, last, center, { speed, scale })
              .then(() => this.#parts.stack.classList.remove('showcasing'));
            blocking.push(shown);
          } else {
            const source = object.kind !== 'spell' ? this.elementFor(object.sourceId) : null;
            const from = source ? relRect(source, root) : (anchorsBefore.oppHand ?? last);
            blocking.push(flip(record.el, { ...from, w: from.w || 20, h: from.h || 28 }, last, { speed, duration: 380 }));
          }
        } else {
          blocking.push(enter(record.el, { speed }));
        }
      }
    }
    for (const group of landPops) {
      blocking.push(pop(group, { speed, scale: 1.15 }));
      const r = relRect(group, root);
      impact(this.#parts.fx, r.x + 15, r.cy, { speed, strength: 0.4, color: FX_COLORS.dust, sparks: 5 });
    }

    // Damage, life, buffs and banners; the blows land after `hitDelay`.
    const leavingById = new Map(leaving.map((l) => [l.id, l]));
    this.#effects(events, state, previous, speed, blocking, { leavingById, hitDelay });

    // Cards that left: break apart (once the blow has landed), or fly to where they went.
    const dying = new Map();
    for (const event of events) {
      if (DEATH_EVENTS.has(event.name)) dying.set(event.payload.cardId, event.name);
      if (event.name === 'permanentExiled') dying.set(event.payload.cardId, 'exile');
    }
    for (const { id, el } of leaving) {
      if (dying.has(id)) {
        const kind = dying.get(id) === 'cardBurned' ? 'burn' : dying.get(id) === 'exile' ? 'exile' : 'die';
        const breakUp = () => {
          const r = { cx: parseFloat(el.style.left) + el.offsetWidth / 2, cy: parseFloat(el.style.top) + el.offsetHeight / 2 };
          if (kind === 'die') impact(this.#parts.fx, r.cx, r.cy, { speed, strength: 0.8, color: '#9b8cff', sparks: 6 });
          return crumble(el, this.#parts.fx, { speed, kind });
        };
        blocking.push(hitDelay ? new Promise((resolve) => { setTimeout(resolve, hitDelay + 60 * speed); }).then(breakUp) : breakUp());
      } else {
        blocking.push(flyAway(el, this.#destination(state, id), { speed }));
      }
    }

    this.#drawLines(state);
    clearTimeout(this.#lineTimer);
    this.#lineTimer = setTimeout(() => this.#drawLines(this.#state), 380 * speed);
    return Promise.all(blocking);
  }

  /** A creature has hit the battlefield: dust, and for a big one, the board shakes. */
  #landed(el, card, speed) {
    if (!el.isConnected) return;
    this.#app.sound('enter');
    const r = relRect(el, this.el);
    const power = card?.power ?? 1;
    const strength = Math.min(2, 0.55 + power / 4);
    impact(this.#parts.fx, r.cx, r.y + r.h * 0.85, { speed, strength, color: FX_COLORS.dust, sparks: power >= 4 ? 9 : 6 });
    if (power >= 4) shakeScreen(this.el, { speed, strength: Math.min(1.6, (power - 2) / 3) });
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
    // An attached chip steps forward with its creature.
    for (const record of this.#cards.values()) {
      if (!record.zone.startsWith('attached')) continue;
      const host = state.battlefield.find((p) => p.id === record.el.dataset.id)?.attachedTo;
      toggle(record.el, 'attacking', attacking.has(host));
      toggle(record.el, 'blocking', blocking.has(host));
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
    const spread = n > 1 ? Math.min(cardWidth * 0.8, (width - cardWidth - 12) / (n - 1)) : 0;
    cards.forEach((el, i) => {
      const offset = i - (n - 1) / 2;
      const selected = el.dataset.id === this.#selectedHandId;
      const x = width / 2 - cardWidth / 2 + offset * spread;
      // A selected card rises only into the hand's own gap (its preview shows it whole), clear of the bar.
      const y = selected ? -6 : Math.abs(offset) ** 2 * 1.1;
      el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
      // It keeps its tilt too: straightened, it would slide under the next card's edge.
      el.style.rotate = `${(offset * 1.8).toFixed(2)}deg`;
      // A selected card keeps its place in the fan: lifted over the next card it would hide that card's name.
      el.style.zIndex = i + 1;
      const covered = i < n - 1 && spread < cardWidth - 4;
      toggle(el, 'covered', covered);
      if (covered) el.dataset.fitHide = '';
      else delete el.dataset.fitHide;
    });
    // Names fit the strip of each card the next one leaves uncovered.
    const peek = `${Math.round(spread)}|${n}`;
    if (this.#handPeek !== peek) {
      this.#handPeek = peek;
      this.#parts.hand.style.setProperty('--peek', `${Math.round(spread)}px`);
      fit(this.#parts.hand);
    }
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

  /** Bigger cards when a side has three creatures or fewer; two rows of smaller ones past five. */
  #updateBoardDensity() {
    for (const zone of [this.#parts.meCreatures, this.#parts.oppCreatures]) {
      const n = zone.querySelectorAll(':scope > .z-creatures').length;
      toggle(zone, 'roomy', n <= 3);
      toggle(zone, 'dense', n > 5);
    }
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
      const player = state.players.find((p) => p.id === pid);
      const floating = Object.fromEntries(Object.entries(player.manaPool).filter(([, n]) => n > 0));
      // Mana that can be any color (some of it only for some spells), as a rainbow pip.
      const any = (player.specialMana ?? []).reduce((sum, m) => sum + m.amount, 0);
      const poolKey = `${JSON.stringify(floating)}|${any}`;
      if (strip.pool.dataset.key !== poolKey) {
        strip.pool.dataset.key = poolKey;
        strip.pool.replaceChildren(
          Object.keys(floating).length ? manaPips(floating) : '',
          any ? h('span.pip-any', { title: 'Mana of any color' }, String(any)) : '',
        );
      }
    }
    return pops;
  }

  #renderBars(state, previous, { animate, speed, delay = 0 }) {
    for (const player of state.players) {
      const side = player.id === this.#me ? 'me' : 'opp';
      const parts = this.#parts[side];
      const before = this.#lastLife[player.id];
      const changed = animate && before !== undefined && before !== player.life;
      const show = () => {
        setText(parts.life.querySelector('.life-n'), player.life);
        toggle(parts.life, 'low', player.life <= 5);
        if (!changed) return;
        toggle(parts.life, 'gain', player.life > before);
        pop(parts.life, { speed, scale: 1.45 });
      };
      // A newer state shows its own total.
      if (changed && delay) setTimeout(() => { if (this.#state === state) show(); }, delay);
      else show();
      this.#lastLife[player.id] = player.life;
      const [hand, lib, grave, exile, ring] = parts.counts.querySelectorAll('b');
      setText(hand, player.hand.length);
      setText(lib, player.library.length);
      setText(grave, player.graveyard.length);
      setText(exile, player.exile.length);
      toggle(exile.parentElement, 'on', player.exile.length > 0);
      const level = player.ring?.level ?? 0;
      setText(ring, level);
      toggle(ring.parentElement, 'on', level > 0);
      toggle(parts.avatar.parentElement, 'active', state.activePlayerId === player.id);
      toggle(parts.avatar, 'protected', (state.temporaryEffects ?? []).some((e) => e.playerProtection && e.targetId === player.id));
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
        side === 'me' ? h('span.ab-text.fit', { dataset: { min: 6.5 } }, label) : null,
        left !== null ? h('span.ab-uses', '•'.repeat(Math.max(0, left))) : null);
      this.#abilityButtons.set(`${emblem.id}/${ability.id}`, button);
      return button;
    });
    parts.abilities.replaceChildren(...buttons);
    // With several, they show just their costs (a long press tells what each does).
    toggle(parts.abilities, 'many', buttons.length > 1);
    // The name has the room the abilities leave.
    fit(parts.abilities.parentElement);
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
    // Before the first turn (while players mulligan) there's no turn to show.
    toggle(badge, 'pending', !state.activePlayerId);
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
        const line = `x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"`;
        paths.push(`<line class="block-glow" ${line} /><line class="block-line" ${line} />`);
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
        const d = `M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
        const side = top.controllerId === this.#me ? 'mine' : 'theirs';
        paths.push(`<path class="target-glow ${side}" d="${d}" /><path class="target-line ${side}" d="${d}" marker-end="url(#arrow-${side})" />`
          + `<circle class="target-ring ${side}" cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="13" />`);
      }
    }
    const html = paths.join('');
    if (svg.dataset.html === html) return;
    svg.dataset.html = html;
    svg.innerHTML = `${ARROW_DEFS}${html}`;
  }

  /**
   * Damage numbers, life changes, stat pops and turn banners. In combat each creature
   * lunges at what it hits; a spell's damage flies to its target as a bolt. Hits land
   * after `hitDelay` (see hitDelayOf). `leavingById`: cards that left the board this
   * state (still drawn where they were, in the effects layer).
   */
  #effects(events, state, previous, speed, blocking, { leavingById, hitDelay }) {
    const root = this.el;
    const fx = this.#parts.fx;
    const sound = this.#app.sound;
    // Where an id is: a player's portrait, a card (or one that just left), a stack object.
    const at = (id) => {
      const el = id === this.#me ? this.#parts.me.avatar : id === this.#opp ? this.#parts.opp.avatar
        : leavingById.get(id)?.el ?? this.elementFor(id);
      if (!el) return null;
      return { el, rect: relRect(el, root) };
    };
    const later = (ms, fn) => (ms > 0 ? setTimeout(fn, ms) : fn());
    const hit = (targetId, amount, color = FX_COLORS.hit) => {
      const target = at(targetId);
      if (!target) return;
      const player = targetId === this.#me || targetId === this.#opp;
      // A buzz when you're hit, where phones support it (not iOS).
      if (targetId === this.#me) navigator.vibrate?.(40);
      floatText(fx, target.rect.cx, target.rect.cy, `−${amount}`, 'damage', { speed });
      impact(fx, target.rect.cx, target.rect.cy, { speed, strength: Math.min(2, 0.5 + amount / 3), color });
      shake(target.el, { speed });
      if (player) {
        target.el.classList.remove('hurt');
        void target.el.offsetWidth;
        target.el.classList.add('hurt');
      }
    };
    for (const { name, payload } of events) {
      switch (name) {
        case 'combatDamageDealt': {
          // Attackers (and blockers, less far) throw themselves at what they hit.
          const attackers = new Set((previous ?? state).combat.attackers.map((a) => a.cardId));
          const lunged = new Set();
          let toPlayers = 0;
          for (const d of payload.damage) {
            const targetId = d.targetPlayerId ?? d.targetCardId;
            if (d.targetPlayerId) toPlayers += d.amount;
            const source = at(d.sourceId);
            const target = at(targetId);
            if (source && target && !lunged.has(d.sourceId)) {
              lunged.add(d.sourceId);
              blocking.push(lunge(source.el, source.rect, target.rect, { speed, reach: attackers.has(d.sourceId) ? 0.72 : 0.3 }));
            }
            later(hitDelay, () => hit(targetId, d.amount));
          }
          later(hitDelay, () => {
            sound('hit');
            if (toPlayers) shakeScreen(root, { speed, strength: Math.min(1.8, 0.4 + toPlayers / 4) });
          });
          break;
        }
        case 'damageDealt': {
          const targetId = payload.targetPlayerId ?? payload.targetCardId;
          const source = at(payload.sourceId);
          const target = at(targetId);
          const card = findCard(previous ?? state, payload.sourceId) ?? findCard(state, payload.sourceId);
          const color = FX_COLORS[card ? frameOf(card) : 'red'] ?? FX_COLORS.red;
          if (source && target && source.el !== target.el) {
            blocking.push(projectile(fx, source.rect, target.rect, { speed, color, duration: BOLT_MS }));
            later(hitDelay, () => {
              sound('hit');
              hit(targetId, payload.amount, color);
            });
          } else {
            sound('hit');
            hit(targetId, payload.amount, color);
          }
          break;
        }
        case 'lifeGained': {
          sound('gain');
          const target = at(payload.playerId);
          if (target) {
            later(hitDelay, () => {
              floatText(fx, target.rect.cx, target.rect.cy, `+${payload.amount}`, 'heal', { speed });
              sparkle(fx, target.rect, { speed, color: FX_COLORS.heal, count: 7 });
            });
          }
          break;
        }
        case 'lifeLost': {
          sound('lose');
          const target = at(payload.playerId);
          if (target) {
            floatText(fx, target.rect.cx, target.rect.cy, `−${payload.amount}`, 'damage', { speed });
            impact(fx, target.rect.cx, target.rect.cy, { speed, strength: 0.6, color: FX_COLORS.black, sparks: 5 });
          }
          break;
        }
        case 'countersAdded':
        case 'temporaryEffectCreated': {
          const target = at(payload.cardId ?? payload.targetId);
          if (target) {
            pop(target.el, { speed });
            const down = name === 'temporaryEffectCreated' && ((payload.power ?? 0) < 0 || (payload.toughness ?? 0) < 0);
            const text = name === 'countersAdded' ? `+${payload.count}` : `${payload.power >= 0 ? '+' : ''}${payload.power ?? 0}/${payload.toughness >= 0 ? '+' : ''}${payload.toughness ?? 0}`;
            floatText(fx, target.rect.cx, target.rect.y, text, down ? 'debuff' : 'buff', { speed });
            sparkle(fx, target.rect, { speed, color: down ? FX_COLORS.black : FX_COLORS.gold });
          }
          break;
        }
        case 'cardBurned':
          sound('burn');
          if (payload.playerId === this.#me) {
            const r = relRect(this.#parts.hand, root);
            floatText(fx, r.cx, r.y, `${payload.cardName} burned — hand full`, 'warn', { speed: speed * 1.6 });
          }
          break;
        case 'tokensLimited':
          if (payload.playerId === this.#me) {
            const r = relRect(this.#parts.meCreatures, root);
            floatText(fx, r.cx, r.cy, 'Board full', 'warn', { speed });
          }
          break;
        case 'cardsDrawn':
          if (payload.playerId === this.#me) sound('draw');
          break;
        case 'landPlayed': sound('land'); break;
        case 'spellCast': sound('cast'); break;
        case 'abilityActivated': if (payload.usesStack) sound('cast'); break;
        // Creatures sound as they land (#landed).
        case 'creatureDied': case 'permanentDestroyed': case 'permanentExiled': later(hitDelay, () => sound('die')); break;
        case 'attackersDeclared': {
          if (!payload.attackers.length) break;
          sound('attack');
          // A war cry: each attacker rears up.
          payload.attackers.forEach((id, i) => {
            const attacker = at(id);
            if (!attacker) return;
            attacker.el.animate([
              { transform: 'none' }, { transform: 'translateY(-5px) scale(1.12) rotate(-2deg)', offset: 0.35 }, { transform: 'none' },
            ], { duration: 360 * speed, delay: i * 50 * speed, easing: 'cubic-bezier(.3,.7,.3,1)' });
            impact(fx, attacker.rect.cx, attacker.rect.cy, { speed, strength: 0.5, color: '#ff5d4a', sparks: 0 });
          });
          break;
        }
        case 'turnStarted': {
          const mine = payload.activePlayerId === this.#me;
          sound('turn');
          blocking.push(banner(fx, mine ? 'Your turn' : 'Opponent\'s turn', mine ? 'mine' : 'theirs', { speed, hold: mine ? 520 : 320 }));
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
    if (this.#parts.prompt.textContent !== (ctx.prompt ?? '')) {
      setText(this.#parts.prompt, ctx.prompt ?? '');
      fit(this.#parts.prompt);
    }
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
    fit(preview);
    // Only animate when a card is first shown, not when its buttons change.
    if (!wasOpen) preview.animate([{ opacity: 0, transform: 'translateY(16px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
  }

  /**
   * The aiming arrow from a point to the finger (for dragged spells): a glowing
   * curve with a head and a reticle at its end. `locked`: the finger is on a valid
   * target, and the arrow snaps to it.
   */
  drawArrow(from, to, { locked = false } = {}) {
    const svg = this.#parts.lines;
    let group = svg.querySelector('.aim');
    if (!from) {
      group?.remove();
      return;
    }
    if (!group) {
      if (!svg.querySelector('#arrow-mine')) svg.insertAdjacentHTML('afterbegin', ARROW_DEFS);
      group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'aim');
      group.innerHTML = '<path class="aim-glow"/><path class="aim-line"/><path class="aim-head" d="M-9,-11 L9,0 L-9,11 L-4,0 z"/>'
        + '<g class="aim-reticle"><circle r="15"/><path d="M0,-22v8M0,14v8M-22,0h8M14,0h8"/></g>';
      svg.append(group);
    }
    group.classList.toggle('locked', locked);
    // A curve that bows up, ending a little short of the point so the head sits on it.
    const mx = (from.x + to.x) / 2;
    const my = Math.min(from.y, to.y) - 30 - Math.abs(to.x - from.x) * 0.15;
    const angle = Math.atan2(to.y - my, to.x - mx);
    const ex = to.x - Math.cos(angle) * 16;
    const ey = to.y - Math.sin(angle) * 16;
    const d = `M${from.x.toFixed(1)},${from.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
    group.querySelector('.aim-glow').setAttribute('d', d);
    group.querySelector('.aim-line').setAttribute('d', d);
    group.querySelector('.aim-head').setAttribute('transform', `translate(${ex.toFixed(1)},${ey.toFixed(1)}) rotate(${(angle * 180 / Math.PI).toFixed(1)})`);
    group.querySelector('.aim-reticle').setAttribute('transform', `translate(${to.x.toFixed(1)},${to.y.toFixed(1)})`);
  }

  /** Marks the target the finger is on while aiming (`id`, or null for none). */
  setAimed(id) {
    if (this.#aimed === id) return;
    if (this.#aimed) {
      const old = this.#aimElement(this.#aimed);
      old?.classList.remove('aimed');
    }
    this.#aimed = id;
    if (id) this.#aimElement(id)?.classList.add('aimed');
  }

  #aimElement(id) {
    return id === this.#me || id === this.#opp ? this.elementFor(id) : this.#stackObjects.get(id) ?? this.elementFor(id);
  }

  /** A target was picked: a ring closes in on it. */
  lockOn(id) {
    const el = this.#aimElement(id);
    if (!el) return;
    const r = relRect(el, this.el);
    const ring = h('div.fx-lock');
    Object.assign(ring.style, { left: `${r.cx}px`, top: `${r.cy}px`, width: `${Math.max(r.w, r.h) + 26}px`, height: `${Math.max(r.w, r.h) + 26}px` });
    this.#parts.fx.append(ring);
    ring.animate([
      { transform: 'translate(-50%,-50%) scale(1.5) rotate(-40deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(.9) rotate(0deg)', opacity: 1, offset: 0.6 },
      { transform: 'translate(-50%,-50%) scale(.8)', opacity: 0 },
    ], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.catch(() => {}).then(() => ring.remove());
  }

  /** A short message over the board. */
  toast(text) {
    const r = relRect(this.#parts.lane, this.el);
    floatText(this.#parts.fx, r.cx, r.cy, text, 'warn', { speed: 1.6 });
  }

  /**
   * The opponent says `text`: a speech bubble under their portrait, up long enough
   * to read. A new line replaces the one showing.
   */
  say(text) {
    this.#speech?.remove();
    if (!text) return;
    const avatar = relRect(this.#parts.opp.avatar, this.el);
    const bubble = h('div.speech', { style: { top: `${avatar.y + avatar.h + 10}px` } }, text);
    bubble.style.setProperty('--tail-x', `${Math.max(14, avatar.cx - 8)}px`);
    this.#speech = bubble;
    this.#parts.fx.append(bubble);
    const hold = Math.min(6000, 1800 + 55 * text.length);
    const animation = bubble.animate([
      { opacity: 0, transform: 'translateY(-6px) scale(.9)' },
      { opacity: 1, transform: 'none', offset: 220 / (hold + 520) },
      { opacity: 1, transform: 'none', offset: (hold + 220) / (hold + 520) },
      { opacity: 0, transform: 'translateY(-4px)' },
    ], { duration: hold + 520, easing: 'ease-out' });
    animation.finished.then(() => bubble.remove(), () => bubble.remove());
  }

  /** Victory or defeat. */
  finale(won, speed = 1) {
    this.#app.sound(won ? 'victory' : 'defeat');
    return banner(this.#parts.fx, won ? 'Victory' : 'Defeat', won ? 'victory' : 'defeat', { speed, hold: 1400 });
  }

  /** Re-measures after a resize or rotation. */
  relayout() {
    // A rotation can leave the page, or the screen holding the board, scrolled.
    for (let el = this.el.parentElement; el; el = el.parentElement) if (el.scrollTop || el.scrollLeft) el.scrollTo(0, 0);
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    this.#handWidth = 0;
    this.#handPeek = '';
    this.#layoutHand();
    this.#drawLines(this.#state);
  }

  cardBack() {
    return cardBack();
  }
}

/** Arrowheads for target lines: yours and the opponent's. */
const ARROW_DEFS = '<defs>'
  + ['mine', 'theirs'].map((side) => `<marker id="arrow-${side}" class="arrow-${side}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 L3,5 z" fill="currentColor"/></marker>`).join('')
  + '</defs>';

/**
 * How long until this state's blows land (ms, with `speed`): a combat creature's
 * lunge, or a spell's bolt. Life totals and deaths wait for it.
 */
function hitDelayOf(events, speed) {
  if (events.some((e) => e.name === 'combatDamageDealt' && e.payload.damage.length)) return LUNGE_MS * LUNGE_HIT * speed;
  if (events.some((e) => e.name === 'damageDealt')) return BOLT_MS * speed;
  return 0;
}
