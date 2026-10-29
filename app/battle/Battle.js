/**
 * A battle: the game, the CPU opponent, and the player's input.
 *
 * The engine runs instantly and emits events; the board plays them back as
 * animations, one state at a time (a queue that speeds up when it falls behind).
 * The player can act once the board has caught up and it's their move. Priority
 * is passed automatically when there's nothing sensible to do (autopass.js), and
 * every play is one tap: mana is tapped for you (play.js).
 */
import {
  Game, GAME_STATUS, DECISION, CHOICE, OPENING_HAND_SIZE,
} from '../../src/engine/Game.js';
import { ACTION } from '../../src/engine/actions.js';
import { actingPlayerId } from '../../src/ai/simulate.js';
import { createCpuController } from '../../src/campaign/cpu.js';
import {
  BANTER, SwingWatch, outlook, pickLine,
} from '../../src/campaign/banter.js';
import { h, wait } from '../dom.js';
import { icon } from '../icons.js';
import { crest, preloadImages } from '../art.js';
import { BoardView } from './BoardView.js';
import {
  playOptions, perform, nextChoice, narrow, interchangeableTargets,
} from './play.js';
import { shouldAutoPass, primaryAction } from './autopass.js';
import {
  promptFor, variantLabel, nameOf, findCard, choiceLabel, BOARD_CHOICES, HAND_CHOICES,
} from './describe.js';
import { damagePlans } from './damage.js';
import { PlayHistory, historyView } from './history.js';
import { boardCard, fullCard, typeLine } from '../cardView.js';
import { relRect } from './fx.js';
import { inlineSymbols } from '../symbols.js';
import { isLand, castsAtInstantSpeed, TARGET } from '../../src/cards/cards.js';
import { formatMana } from '../../src/engine/mana.js';

const LONG_PRESS_MS = 430;

/** With `window.__pwProfile = []`, slow steps (over 8 ms) are recorded there. */
function timed(label, fn) {
  const profile = globalThis.__pwProfile;
  if (!profile) return fn();
  const started = performance.now();
  const result = fn();
  const ms = performance.now() - started;
  if (ms > 8) profile.push({ label, ms: Math.round(ms) });
  return result;
}

export class Battle {
  #app;
  #game;
  #cpu;
  #me;
  #opp;
  #view;
  #onEnd;
  #intro;
  #queue = [];
  #pending = [];
  #presenting = false;
  #state = null;
  #options = [];
  #interactive = false;
  #mode = { kind: 'idle' };
  #endTurnOf = null;
  #fullControl = false;
  #autoTimer = null;
  #gesture = null;
  #finished = false;
  #unsubscribe = [];
  /** What the opponent says (banter.js): its lines, those said, and swings in its outlook. */
  #banter = null;
  #said = new Set();
  #swing = new SwingWatch();
  #outlookTurn = 0;
  #history = new PlayHistory();
  #oppName;
  #greeted = false;

  /**
   * `setup`: matchSetup()'s result (`game` options, `cpu`, `encounter`), or the
   * same shape for a quick match. `meInfo`/`oppInfo`: `{ name, color?, art? }`.
   * `onEnd({ won, turns })` is called after the final banner.
   */
  constructor(app, { setup, meInfo, oppInfo, onEnd, subtitle = '' }) {
    this.#app = app;
    this.#onEnd = onEnd;
    this.#me = setup.game.players[0].id;
    this.#opp = setup.cpu.playerId;
    this.#oppName = oppInfo.name;
    this.#game = new Game(setup.game);
    this.#view = new BoardView(app, { me: this.#me, opp: this.#opp, meInfo, oppInfo });
    this.el = this.#view.el;
    this.#banter = setup.cpu.banter ?? null;
    this.#cpu = createCpuController(this.#game, setup.cpu, { delayMs: Math.round(650 * app.settings.speed) });
    if (this.#cpu.on) this.#unsubscribe.push(this.#cpu.on('thinking', ({ active }) => this.#view.setThinking(active)));
    this.#unsubscribe.push(this.#game.onAny((name, payload) => this.#onEvent(name, payload)));
    this.#bindInput();
    this.el.append(h('button.menu-btn', { 'aria-label': 'Menu', onclick: () => this.#menu() }, icon('gear')));
    this.#intro = { meInfo, oppInfo, subtitle, setup };
    // Re-measure whenever the board changes size. iOS fires `resize` on rotation before
    // the new layout settles, so the board's own size (ResizeObserver) is what counts;
    // the events, with a late second look, are a fallback.
    let settle = null;
    const onResize = () => {
      this.#view.relayout();
      clearTimeout(settle);
      settle = setTimeout(() => this.#view.relayout(), 350);
    };
    const targets = [window, window.visualViewport].filter(Boolean);
    for (const target of targets) target.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.#view.relayout()) : null;
    observer?.observe(this.el);
    this.#unsubscribe.push(() => {
      for (const target of targets) target.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      observer?.disconnect();
      clearTimeout(settle);
    });
  }

  /** Shows the "versus" intro while card art loads, then starts the game. */
  async start() {
    if (this.#intro.started) return;
    this.#intro.started = true;
    const { meInfo, oppInfo, subtitle, setup } = this.#intro;
    const defs = this.#app.definitions;
    // The decks' art, the portraits, and the tokens' (few) art, so tokens don't arrive blank.
    const tokens = Object.keys(defs).filter((id) => id.startsWith('token:'));
    const urls = [...setup.game.decks[this.#me], ...setup.game.decks[this.#opp], ...tokens].map((id) => defs[id]?.image?.art)
      .concat(meInfo.portrait?.art, oppInfo.portrait?.art);
    const intro = h('div.versus',
      h('div.vs-side.vs-opp', crest(oppInfo, { size: 'lg' }), h('div.vs-name', oppInfo.name), subtitle ? h('div.vs-sub', subtitle) : null),
      h('div.vs-mark', 'VS'),
      h('div.vs-side.vs-me', crest(meInfo, { size: 'lg' }), h('div.vs-name', meInfo.name)));
    this.el.append(intro);
    this.#app.sound('turn');
    await Promise.all([Promise.race([preloadImages(urls), wait(2500)]), wait(1400 * this.#app.settings.speed + 300)]);
    await intro.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(1.06)' }], { duration: 260, fill: 'forwards' }).finished.catch(() => {});
    intro.remove();
    if (this.#finished) return;
    performance.mark('game:start');
    this.#game.start();
    performance.mark('game:started');
  }

  destroy() {
    this.#finished = true;
    clearTimeout(this.#autoTimer);
    this.#unsubscribe.forEach((off) => off());
    this.#cpu.detach();
    this.#view.destroy();
  }

  // ---------------------------------------------------------------------------
  // Events → animations

  #onEvent(name, payload) {
    if (name !== 'state') {
      this.#pending.push({ name, payload });
      return;
    }
    this.#history.record(this.#pending, payload);
    this.#queue.push({ events: this.#pending, state: payload });
    this.#pending = [];
    this.#pump();
  }

  async #pump() {
    if (this.#presenting || this.#finished) return;
    this.#presenting = true;
    clearTimeout(this.#autoTimer);
    this.#setInteractive(false);
    while (this.#queue.length && !this.#finished) {
      let batch = this.#queue.shift();
      let animate = true;
      // Far behind (e.g. a long CPU turn): jump to the latest state.
      if (this.#queue.length > 8) {
        batch = this.#queue.at(-1);
        this.#queue = [];
        animate = false;
      }
      const speed = this.#app.settings.speed * (this.#queue.length > 3 ? 0.5 : 1);
      this.#state = batch.state;
      await timed('render', () => this.#view.render(batch.state, { events: batch.events, speed, animate }));
      this.#greet(batch.state);
      this.#watchSwing(batch.state);
    }
    this.#presenting = false;
    if (!this.#finished) this.#settle();
  }

  /** The board has caught up: pass automatically, or let the player act. */
  #settle() {
    const state = this.#game.getState();
    this.#state = state;
    if (state.status === GAME_STATUS.GAME_OVER) {
      this.#finish(state);
      return;
    }
    const me = this.#me;
    const acting = actingPlayerId(state) === me;
    this.#options = acting && !state.pendingDecision ? timed('playOptions', () => playOptions(this.#game, me)) : [];
    if (acting) {
      const fullControl = this.#fullControl || !this.#app.settings.autoPass;
      if (shouldAutoPass(state, me, { hasOptions: this.#options.length > 0, fullControl, endingTurn: this.#endTurnOf === state.turn })) {
        const { version } = state;
        this.#autoTimer = setTimeout(() => {
          if (this.#game.peekState().version !== version) return;
          this.#dispatch({ type: ACTION.PASS_PRIORITY, playerId: me }, { auto: true });
        }, 60);
        this.#refresh();
        return;
      }
      this.#openDecisionSheet(state);
    }
    this.#setInteractive(acting);
  }

  /** Decisions made on a sheet rather than on the board: damage, mulligans, modes, the legend rule, graveyard cards. */
  #openDecisionSheet(state) {
    const decision = state.pendingDecision;
    switch (decision?.type) {
      case DECISION.ASSIGN_COMBAT_DAMAGE: this.#assignDamage(state); break;
      case DECISION.MULLIGAN: this.#offerMulligan(state); break;
      case DECISION.CHOOSE_MODE: this.#chooseMode(state); break;
      case DECISION.LEGEND_RULE: this.#keepLegend(state); break;
      case DECISION.CHOOSE_TARGETS:
        if (decision.targetKind === TARGET.PERMANENT_CARD_IN_YOUR_GRAVEYARD) this.#chooseGraveyardCard(state);
        else if (this.#severalTargets(state)) this.#chooseTriggerTargets(state);
        break;
      case DECISION.CHOOSE:
        if (BOARD_CHOICES.has(decision.kind)) this.#chooseOnBoard(state);
        else if (!HAND_CHOICES.has(decision.kind)) this.#chooseOnSheet(state);
        break;
      case DECISION.CHOOSE_MANY: this.#chooseMany(state); break;
      default: break;
    }
  }

  /** Whether a triggered ability's targets are several (or "up to"): picked one at a time. */
  #severalTargets(state) {
    return state.validActions.some((a) => a.playerId === this.#me && a.type === ACTION.CHOOSE_TARGETS
      && (a.targets.length > 1 || a.targets.includes(null)));
  }

  /** A triggered ability with several targets: each tapped on the board in turn. */
  #chooseTriggerTargets(state) {
    const actions = state.validActions.filter((a) => a.playerId === this.#me && a.type === ACTION.CHOOSE_TARGETS);
    const decline = actions.find((a) => a.targets.length === 0);
    this.#step(actions.filter((a) => a.targets.length), {
      sourceId: state.pendingDecision.sourceId,
      kinds: () => state.pendingDecision.targetKinds,
      cancel: false,
      finish: (action) => this.#dispatch(action),
      decline: decline ? () => this.#dispatch(decline) : null,
    });
  }

  /** A permanent to choose on the board: the Ring-bearer, an Army, what to sacrifice. */
  #chooseOnBoard(state) {
    const decision = state.pendingDecision;
    const mine = state.validActions.filter((a) => a.playerId === this.#me && a.type === ACTION.CHOOSE);
    this.#mode = {
      kind: 'targeting',
      targets: new Set(mine.map((a) => a.choice)),
      sourceId: decision.sourceId,
      prompt: promptFor(state, this.#me),
      cancel: false,
      pick: (id) => this.#dispatch(mine.find((a) => a.choice === id)),
    };
    this.#refresh();
  }

  /** A choice of words or cards on a sheet: yes or no, a cost, a keyword, a card from a revealed hand… */
  #chooseOnSheet(state) {
    const decision = state.pendingDecision;
    const mine = state.validActions.filter((a) => a.playerId === this.#me && a.type === ACTION.CHOOSE);
    const cardOf = (id) => decision.cards?.find((c) => c.id === id) ?? findCard(state, id);
    const showsCards = [CHOICE.REVEALED_CARD, CHOICE.GRAVEYARD_CARD, CHOICE.HAND_CARD, CHOICE.CAST_FREE].includes(decision.kind);
    // Choices that read the same (two Foods to sacrifice) are the same choice: list one.
    const byLabel = new Map();
    for (const action of mine) {
      const label = choiceLabel(state, decision, action.choice, this.#me);
      if (!byLabel.has(label)) byLabel.set(label, action);
    }
    this.#app.overlays.sheet({
      title: decision.sourceName ?? 'Choose',
      text: promptFor(state, this.#me),
      // A revealed hand shows every card, those that can't be chosen too.
      body: decision.kind === CHOICE.REVEALED_CARD
        ? h('div.mull-hand', decision.cards.map((card) => h('div.mull-card', { class: decision.options.includes(card.id) ? '' : 'dim' }, fullCard(card, this.#app.definitions))))
        : null,
      options: [...byLabel].map(([label, action], i) => {
        const card = showsCards && typeof action.choice === 'string' && action.choice !== 'decline' ? cardOf(action.choice) : null;
        return {
          label: card ? h('div.dmg-row', h('div.dmg-card', fullCard(card, this.#app.definitions))) : inlineSymbols(label),
          sub: card ? label : null,
          primary: i === 0,
          onPick: () => this.#dispatch(action),
        };
      }),
      cancel: null,
    });
  }

  /**
   * Choosing several cards (scrying, searching, The Bath Song): tap cards in and out, in
   * order, then confirm; the engine is told the whole choice at once.
   */
  #chooseMany(state) {
    const decision = state.pendingDecision;
    const selected = [...decision.selected];
    // Cards (or permanents), or for Goldberry, counters ('+1/+1#2'), shown by name.
    const cards = decision.options.map((id) => decision.cards?.find((c) => c.id === id) ?? findCard(state, id)
      ?? { id, label: String(id).split('#')[0] });
    const scry = decision.kind === CHOICE.SCRY;
    const done = h('button.btn.primary', {}, 'Done');
    const tiles = cards.map((card) => {
      const badge = h('span.pick-n');
      const tile = h('button.pick-card', {
        onclick: () => {
          const at = selected.indexOf(card.id);
          if (at >= 0) selected.splice(at, 1);
          else if (selected.length < decision.max) selected.push(card.id);
          update();
        },
      }, card.label ? h('div.pick-label', `${card.label} counter`) : fullCard(card, this.#app.definitions), badge);
      return { card, tile, badge };
    });
    const verb = {
      [CHOICE.SEARCH]: 'Take', [CHOICE.LOOK]: 'Take', [CHOICE.KEEP]: 'Keep', [CHOICE.EXILE_COST]: 'Exile', [CHOICE.EXILE_FROM_HAND]: 'Exile',
      [CHOICE.SACRIFICE_ANY]: 'Sacrifice', [CHOICE.HAND_CARDS]: 'Put', [CHOICE.COUNTERS]: 'Move',
    }[decision.kind];
    const update = () => {
      for (const { card, tile, badge } of tiles) {
        const at = selected.indexOf(card.id);
        tile.classList.toggle('chosen', at >= 0);
        badge.textContent = at < 0 ? (scry ? 'Bottom' : '') : scry ? `Top ${at + 1}` : '✓';
      }
      done.disabled = selected.length < decision.min;
      done.textContent = scry || !verb ? 'Done' : `${verb} ${selected.length}`;
    };
    update();
    const confirm = () => {
      // The engine's selection starts empty; toggle in the chosen cards in order, then confirm.
      for (const id of decision.selected.filter((c) => !selected.includes(c))) this.#game.dispatch({ type: ACTION.TOGGLE_CHOICE, playerId: this.#me, choice: id });
      for (const id of selected.filter((c) => !decision.selected.includes(c))) this.#game.dispatch({ type: ACTION.TOGGLE_CHOICE, playerId: this.#me, choice: id });
      this.#dispatch({ type: ACTION.CONFIRM_CHOICE, playerId: this.#me });
    };
    done.addEventListener('click', () => {
      this.#app.overlays.close();
      confirm();
    });
    this.#app.overlays.sheet({
      title: decision.sourceName ?? 'Choose',
      text: promptFor(state, this.#me),
      body: h('div.pick-grid', tiles.map((t) => t.tile), h('div.pick-done', done)),
      options: [],
      cancel: null,
    });
  }

  /** "Choose one —" (700.2): a sheet of the modes; a mode with a target then asks for it on the board. */
  #chooseMode(state) {
    const decision = state.pendingDecision;
    const mine = state.validActions.filter((a) => a.playerId === this.#me && a.type === ACTION.CHOOSE_MODE);
    const modes = [...new Set(mine.map((a) => a.mode))];
    const pick = (mode) => {
      const actions = mine.filter((a) => a.mode === mode);
      if (actions.length === 1) {
        this.#dispatch(actions[0]);
        return;
      }
      this.#mode = {
        kind: 'targeting',
        targets: new Set(actions.map((a) => a.targets[0])),
        sourceId: decision.sourceId,
        prompt: 'Choose a target',
        pick: (id) => this.#dispatch(actions.find((a) => a.targets[0] === id)),
      };
      this.#refresh();
    };
    this.#app.overlays.sheet({
      title: decision.sourceName,
      text: 'Choose one.',
      options: modes.map((mode, i) => ({ label: inlineSymbols(decision.modes[mode].text), primary: i === 0, onPick: () => pick(mode) })),
      cancel: null,
    });
  }

  /** The legend rule (704.5j): which of your legendary permanents with the same name stays. */
  #keepLegend(state) {
    const decision = state.pendingDecision;
    const mine = state.validActions.filter((a) => a.playerId === this.#me && a.type === ACTION.KEEP_LEGEND);
    this.#app.overlays.sheet({
      title: `Two ${decision.name}`,
      text: 'You can control only one legendary permanent with the same name. Keep one; the other goes to the graveyard.',
      options: mine.map((action, i) => {
        const card = findCard(state, action.cardId);
        return {
          label: h('div.dmg-row', h('div.dmg-card', boardCard(card, this.#app.definitions))),
          sub: [card.tapped ? 'Tapped' : 'Untapped', card.summoningSick ? 'just arrived' : ''].filter(Boolean).join(', '),
          primary: i === 0,
          onPick: () => this.#dispatch(action),
        };
      }),
      cancel: null,
    });
  }

  /** A card in your graveyard as a target (Elvish Regrower): a sheet of the cards. */
  #chooseGraveyardCard(state) {
    const decision = state.pendingDecision;
    const mine = state.validActions.filter((a) => a.playerId === this.#me && a.type === ACTION.CHOOSE_TARGETS);
    this.#app.overlays.sheet({
      title: decision.sourceName,
      text: inlineSymbols(decision.text),
      options: mine.map((action) => {
        if (!action.targets.length) return { label: 'Don\'t', onPick: () => this.#dispatch(action) };
        const card = findCard(state, action.targets[0]);
        return { label: card.name, sub: typeLine(card), onPick: () => this.#dispatch(action) };
      }),
      cancel: null,
    });
  }

  async #finish(state) {
    if (this.#finished) return;
    this.#finished = true;
    this.#setInteractive(false);
    this.#view.showPreview(null);
    const won = state.winnerId === this.#me;
    await this.#lastWord(won);
    await this.#view.finale(won, this.#app.settings.speed);
    this.#cpu.detach();
    this.#onEnd?.({ won, turns: state.turn });
  }

  /** The opponent says a line of `kind`, if it has one. Returns whether it spoke. */
  #say(kind) {
    const line = pickLine(this.#banter, kind, { used: this.#said });
    if (line) this.#view.say(line);
    return Boolean(line);
  }

  /** The opening line, once both players have kept their hands. */
  #greet(state) {
    if (this.#greeted || state.status !== GAME_STATUS.IN_PROGRESS) return;
    if ([DECISION.MULLIGAN, DECISION.PUT_ON_BOTTOM].includes(state.pendingDecision?.type)) return;
    this.#greeted = true;
    this.#say(BANTER.START);
  }

  /** Once a turn, as the board shows it: a big swing in the opponent's outlook gets a line. */
  #watchSwing(state) {
    if (!this.#banter || state.status !== GAME_STATUS.IN_PROGRESS || state.turn === this.#outlookTurn) return;
    this.#outlookTurn = state.turn;
    const swing = this.#swing.observe(outlook(state, this.#opp));
    if (swing) this.#say(swing);
  }

  /** The opponent's word on the result, with a moment to read it before the banner. */
  async #lastWord(won) {
    if (this.#say(won ? BANTER.LOSE : BANTER.WIN)) await wait(700 * this.#app.settings.speed + 300);
  }

  #setInteractive(on) {
    this.#interactive = on;
    // Inspecting a hand card outlasts the opponent's moves; other modes don't.
    if (!on && !this.#mode.inspecting) this.#mode = { kind: 'idle' };
    this.#refresh();
  }

  // ---------------------------------------------------------------------------
  // What the player can do (highlights)

  #refresh() {
    const state = this.#state;
    if (!state) return;
    const me = this.#me;
    const primary = primaryAction(state, me);
    const ctx = { prompt: promptFor(state, me), main: { ...primary, disabled: !this.#interactive || !(primary.action || primary.reopen), fullControl: this.#fullControl } };
    if (!this.#interactive) {
      ctx.main.waiting = actingPlayerId(state) !== me && state.status === GAME_STATUS.IN_PROGRESS;
      ctx.main.disabled = true;
      if (this.#mode.inspecting) {
        ctx.selected = this.#mode.id;
        ctx.selectedHand = this.#mode.id;
      }
      this.#view.setInteraction(ctx);
      this.#syncPreview();
      return;
    }
    const mine = state.validActions.filter((a) => a.playerId === me);
    const decision = state.pendingDecision;
    const mode = this.#mode;
    if (mode.kind === 'targeting') {
      ctx.targetable = mode.targets;
      ctx.prompt = mode.prompt;
      ctx.selected = mode.sourceId;
      ctx.main = mode.skip ? { label: mode.skipLabel, disabled: false }
        : { label: mode.cancel === false ? '…' : 'Cancel', disabled: mode.cancel === false };
    } else if (decision?.type === DECISION.CHOOSE && HAND_CHOICES.has(decision.kind)) {
      ctx.playable = new Set(mine.filter((a) => a.type === ACTION.CHOOSE).map((a) => a.choice));
    } else if (decision?.type === DECISION.DECLARE_ATTACKERS) {
      ctx.canAttack = new Set(mine.filter((a) => a.type === ACTION.TOGGLE_ATTACKER).map((a) => a.cardId));
      ctx.main.go = decision.attackers.length > 0;
    } else if (decision?.type === DECISION.DECLARE_BLOCKERS) {
      const blockers = mine.filter((a) => a.type === ACTION.SET_BLOCKER);
      ctx.canBlock = new Set(blockers.map((a) => a.cardId));
      if (mode.kind === 'blocker') {
        ctx.pickedBlocker = mode.blockerId;
        ctx.targetable = new Set(blockers.filter((a) => a.cardId === mode.blockerId && a.attackerId).map((a) => a.attackerId));
      }
    } else if (decision?.type === DECISION.DISCARD_TO_HAND_SIZE) {
      ctx.playable = new Set(mine.filter((a) => a.type === ACTION.DISCARD).map((a) => a.cardId));
    } else if (decision?.type === DECISION.PUT_ON_BOTTOM) {
      ctx.playable = new Set(mine.filter((a) => a.type === ACTION.PUT_ON_BOTTOM).map((a) => a.cardId));
    } else if (decision?.type === DECISION.MULLIGAN) {
      // Nothing to tap: the hand can still be inspected.
    } else if (decision?.type === DECISION.CHOOSE_TARGETS) {
      ctx.targetable = new Set(mine.filter((a) => a.type === ACTION.CHOOSE_TARGETS).map((a) => a.targets[0]));
    } else {
      ctx.playable = new Set(this.#options.map((o) => o.sourceId));
      ctx.abilities = new Set(this.#options.filter((o) => o.kind === 'activate').map((o) => `${o.sourceId}/${o.abilityId}`));
      ctx.main.go = this.#options.length === 0 && !state.stack.length;
    }
    if (mode.kind === 'selected') {
      ctx.selected = mode.id;
      ctx.selectedHand = mode.zone === 'hand' ? mode.id : null;
    }
    this.#view.setInteraction(ctx);
    // An ability usable from the graveyard lights up the graveyard's count; cards playable from exile or the top of
    // the library light up those counts.
    const counts = this.#view.parts.me.counts;
    counts.querySelector('.grave-count')?.classList.toggle('live', this.#options.some((o) => o.fromGraveyard));
    counts.querySelector('.exile-count')?.classList.toggle('live', this.#options.some((o) => o.fromZone === 'exile'));
    counts.querySelector('.lib-count')?.classList.toggle('live', this.#options.some((o) => o.fromZone === 'library'));
    this.#syncPreview();
  }

  /**
   * Keeps the preview of an inspected hand card current: what it can do when you
   * have priority, otherwise a status line. While the board animates on your turn
   * it's left as it is, so it doesn't flicker.
   */
  #syncPreview() {
    const mode = this.#mode;
    if (!mode.inspecting) return;
    const state = this.#state;
    const card = state.players.find((p) => p.id === this.#me).hand.find((c) => c.id === mode.id);
    const decision = state.pendingDecision;
    // Gone from the hand, or a decision of yours needs the board: stop inspecting.
    if (!card || (this.#interactive && decision?.playerId === this.#me)) {
      this.#mode = { kind: 'idle' };
      this.#view.showPreview(null);
      this.#refresh();
      return;
    }
    // No Close button: tapping anywhere else closes the preview.
    if (this.#interactive) {
      const actions = this.#handActions(card);
      this.#view.showPreview(card, actions, { key: `${card.id}|act|${actions.map((a) => a.label).join()}` });
      return;
    }
    if (this.#view.previewKey?.startsWith(`${card.id}|`) && state.activePlayerId === this.#me) return;
    const status = state.activePlayerId === this.#me ? 'Waiting…' : 'Opponent\'s turn';
    this.#view.showPreview(card, [{ label: status, disabled: true }], { key: `${card.id}|wait|${status}` });
  }

  /** The preview buttons for a hand card when you have priority: play it, and cycle it. */
  #handActions(card) {
    const options = this.#options.filter((o) => o.sourceId === card.id);
    if (!options.length) return [{ label: this.#whyNot(card), disabled: true }];
    const labelOf = (option) => {
      if (option.fromHand) return inlineSymbols(option.text);
      if (option.kind === 'land') return 'Play land';
      const xs = new Set(option.variants.map((v) => v.x).filter((x) => x !== undefined));
      return `Cast${xs.size ? ` (X up to ${Math.max(...xs)})` : ''}${option.targets.length ? ' → target' : ''}`;
    };
    return options.map((option, i) => ({ label: labelOf(option), primary: i === 0, onPick: () => this.#interactive && this.#begin(option) }));
  }

  /** Tapping a hand card: inspect it (and, on your move, see what it can do); tap again to close. */
  #inspectHand(target) {
    if (this.#mode.inspecting && this.#mode.id === target.id) {
      this.#cancel();
      return;
    }
    this.#mode = { kind: 'selected', id: target.id, zone: 'hand', inspecting: true };
    this.#app.sound('select');
    this.#refresh();
  }

  // ---------------------------------------------------------------------------
  // Acting

  /** Takes an action. `auto`: passing for the player, which leaves an open inspection alone. */
  #dispatch(action, { auto = false } = {}) {
    clearTimeout(this.#autoTimer);
    if (!auto || !this.#mode.inspecting) {
      this.#mode = { kind: 'idle' };
      this.#view.showPreview(null);
    }
    const result = timed(`dispatch ${action.type}`, () => this.#game.dispatch(action));
    if (!result.ok) this.#view.toast(result.reason ?? 'Not allowed');
    return result;
  }

  /** Starts a play: its mode, X and targets (one at a time), then any remaining choice. */
  #begin(option) {
    this.#view.showPreview(null);
    this.#app.sound('select');
    this.#commit(option, null);
  }

  /** Carries on with a play once its first target (`targetId`, or null) is known, e.g. dropped on. */
  #commit(option, targetId) {
    const variants = targetId === null ? option.variants : option.variants.filter((v) => v.targets?.includes(targetId));
    const card = findCard(this.#state, option.sourceId);
    // The target kinds, once the mode is known: a spell's (or its mode's), or an ability's.
    const kinds = (mode) => {
      if (option.kind === 'cast') {
        // Two modes at once: their targets one after the other.
        if (Array.isArray(mode)) return mode.flatMap((m) => card?.spell?.modes?.[m]?.targets ?? (card?.spell?.modes?.[m]?.target ? [card.spell.modes[m].target] : []));
        return (mode !== undefined ? card?.spell?.modes?.[mode] : card?.spell)?.targets;
      }
      const ability = [...(card?.abilities ?? []), ...(card?.graveyardAbilities ?? []), ...(card?.handAbilities ?? [])].find((a) => a.id === option.abilityId);
      return ability?.targets;
    };
    this.#step(variants, {
      sourceId: option.sourceId,
      card,
      kinds,
      picked: targetId === null ? [] : [targetId],
      finish: (variant) => this.#pay(option, variant),
      payChoices: (left) => this.#chooseCostVariant(option, left),
    });
  }

  /**
   * Narrows `variants` (of a play, or a decision's actions) one open choice at a time
   * (nextChoice): the mode and X on a sheet, each target on the board (with the main
   * button for "no target", when one may be left out). When one variant is left (or
   * only cost choices), `finish` (or `payChoices`) is called.
   */
  #step(variants, {
    sourceId, card = null, kinds = () => null, finish, payChoices = null, cancel = true, decline = null, picked = [],
  }) {
    const interchangeable = interchangeableTargets(kinds(variants[0]?.mode) ?? []);
    const choice = nextChoice(variants, { interchangeable, picked });
    const next = (value) => this.#step(narrow(variants, choice, value, picked), {
      sourceId, card, kinds, finish, payChoices, cancel, decline: null,
      picked: (choice.kind === 'target' || choice.kind === 'targets') && value ? [...picked, value] : picked,
    });
    if (!choice) {
      if (variants.length === 1 || !payChoices) finish(variants[0]);
      else payChoices(variants);
      return;
    }
    if (choice.kind === 'mode') {
      const modes = card?.spell?.modes ?? [];
      this.#app.overlays.sheet({
        title: card?.name ?? 'Choose one',
        text: 'Choose one.',
        options: choice.values.map((mode, i) => ({
          label: inlineSymbols([mode].flat().map((m) => modes[m]?.text ?? `Mode ${m + 1}`).join(' And: ')), primary: i === 0, onPick: () => next(mode),
        })),
        onCancel: () => this.#cancel(),
      });
      return;
    }
    if (choice.kind === 'x') {
      this.#app.overlays.sheet({
        title: card?.name ?? 'Choose X',
        text: 'Choose X.',
        // The biggest first: it's usually the point.
        options: [...choice.values].reverse().map((x, i) => ({ label: `X = ${x}`, primary: i === 0, onPick: () => next(x) })),
        onCancel: () => this.#cancel(),
      });
      return;
    }
    const targets = choice.values.filter((v) => v !== null);
    const optional = choice.values.includes(null);
    const first = choice.kind === 'targets' ? picked.length === 0 : choice.index === 0;
    const nth = first ? 'a target' : 'another target';
    this.#mode = {
      kind: 'targeting',
      targets: new Set(targets),
      sourceId,
      picked,
      prompt: optional ? `Choose ${nth}, or none` : `Choose ${nth}`,
      cancel,
      pick: (id) => next(id),
      ...(optional ? { skip: () => next(null), skipLabel: first ? 'No target' : 'Done' } : {}),
      ...(decline && !optional ? { skip: decline, skipLabel: 'Don\'t' } : {}),
    };
    this.#refresh();
  }

  /** Carries out a play's chosen variant (tapping mana as the dry run did). */
  #pay(option, variant) {
    this.#mode = { kind: 'idle' };
    this.#view.showPreview(null);
    clearTimeout(this.#autoTimer);
    const result = perform(this.#game, this.#me, option, variant);
    if (!result.ok) this.#view.toast(result.reason ?? 'Not allowed');
  }

  /** The cost choices left (which creature to sacrifice, …): a sheet, unless they all read the same. */
  #chooseCostVariant(option, variants) {
    const state = this.#state;
    // Choices that read the same (two identical tokens) are the same choice: list one.
    const byLabel = new Map();
    for (const variant of variants) {
      const label = variantLabel(state, variant, this.#me);
      if (!byLabel.has(label)) byLabel.set(label, variant);
    }
    if (byLabel.size === 1) {
      this.#pay(option, variants[0]);
      return;
    }
    this.#app.overlays.sheet({
      title: 'Choose how to pay',
      options: [...byLabel].map(([label, variant]) => ({ label: inlineSymbols(label), onPick: () => this.#pay(option, variant) })),
      onCancel: () => this.#cancel(),
    });
  }

  #cancel() {
    this.#mode = { kind: 'idle' };
    this.#view.showPreview(null);
    this.#refresh();
  }

  /**
   * How the attacker deals its damage, as outcomes: which blockers die (damage.js).
   * With one sensible outcome it's applied; otherwise each choice shows the blockers
   * with the damage they'd take.
   */
  #assignDamage(state) {
    const plans = damagePlans(state, this.#me);
    if (!plans.length) return;
    if (plans.length === 1) {
      this.#dispatch(plans[0].action);
      return;
    }
    const decision = state.pendingDecision;
    const attacker = findCard(state, decision.attackerId);
    const blockers = decision.blockerIds.map((id) => findCard(state, id)).filter(Boolean);
    const opponent = this.#intro.oppInfo;
    const names = (ids) => ids.map((id) => nameOf(state, id, this.#me));
    const tramples = plans.some((plan) => plan.toPlayer > 0);
    const summary = (plan) => {
      const dies = plan.kills.length === 0 ? 'Nothing dies'
        : plan.kills.length === blockers.length && blockers.length > 1 ? 'Destroy all blockers'
          : `Destroy ${names(plan.kills).join(' and ')}`;
      return plan.toPlayer ? `${dies}, ${plan.toPlayer} to ${opponent.name}` : dies;
    };
    const row = (plan) => h('div.dmg-row',
      blockers.map((b) => {
        const n = plan.assignment[b.id] ?? 0;
        const dies = plan.kills.includes(b.id);
        return h('div.dmg-card', { class: dies ? 'dies' : n ? '' : 'spared' },
          boardCard(b, this.#app.definitions),
          dies ? h('div.dmg-skull', icon('skull')) : null,
          n ? h('div.dmg-n', `-${n}`) : null);
      }),
      tramples ? h('div.dmg-player', { class: plan.toPlayer ? '' : 'spared' },
        crest(opponent, { size: 'sm' }), plan.toPlayer ? h('div.dmg-n', `-${plan.toPlayer}`) : null) : null);
    this.#app.overlays.sheet({
      title: `${attacker?.name ?? 'Attacker'} deals ${decision.power}`,
      text: 'Choose which blockers die.',
      options: plans.map((plan, i) => ({
        label: row(plan),
        sub: summary(plan),
        primary: i === 0,
        onPick: () => this.#dispatch(plan.action),
      })),
      cancel: null,
    });
  }

  /** Keep or mulligan (103.5): a sheet, which can be closed to look at the hand. */
  #offerMulligan(state) {
    const { mulligans } = state.pendingDecision;
    const mine = state.validActions.filter((a) => a.playerId === this.#me);
    const keep = mine.find((a) => a.type === ACTION.KEEP_HAND);
    const again = mine.find((a) => a.type === ACTION.MULLIGAN);
    const size = OPENING_HAND_SIZE - mulligans;
    const { hand } = state.players.find((p) => p.id === this.#me);
    const lands = hand.filter(isLand).length;
    this.#app.overlays.sheet({
      title: mulligans ? `Mulligan to ${size}` : 'Opening hand',
      text: `${lands} land${lands === 1 ? '' : 's'}.${mulligans ? ` If you keep, you put ${mulligans} card${mulligans > 1 ? 's' : ''} on the bottom.` : ''}`,
      body: h('div.mull-hand', hand.map((card) => h('div.mull-card', fullCard(card, this.#app.definitions)))),
      options: [
        { label: `Keep ${size}`, primary: true, onPick: () => this.#dispatch(keep) },
        ...(again ? [{ label: `Mulligan to ${size - 1}`, sub: 'Shuffle, draw seven, then put one more on the bottom', onPick: () => this.#dispatch(again) }] : []),
      ],
      cancel: null,
    });
  }

  #menu() {
    this.#app.overlays.settings({
      extra: [
        { label: 'Play history', onPick: () => this.#showHistory() },
        { label: 'Concede', danger: true, onPick: () => this.#concede() },
      ],
    });
  }

  #showHistory() {
    const nameOfPlayer = (id) => (id === this.#me ? 'You' : this.#oppName);
    const body = historyView(this.#history.entries, { me: this.#me, nameOfPlayer });
    this.#app.overlays.sheet({ title: 'Play history', body, options: [], cancel: 'Close' });
    // Newest at the bottom: start there.
    const sheet = body.closest('.sheet');
    if (sheet) sheet.scrollTop = sheet.scrollHeight;
  }

  async #concede() {
    const yes = await this.#app.overlays.confirm({ title: 'Concede?', text: 'This counts as a loss.', yes: 'Concede', danger: true });
    if (!yes || this.#finished) return;
    this.#finished = true;
    clearTimeout(this.#autoTimer);
    await this.#lastWord(false);
    await this.#view.finale(false, this.#app.settings.speed);
    this.#cpu.detach();
    this.#onEnd?.({ won: false, turns: this.#state?.turn ?? 0, conceded: true });
  }

  // ---------------------------------------------------------------------------
  // Input: taps, long presses (inspect) and drags from the hand

  #bindInput() {
    const root = this.el;
    root.addEventListener('pointerdown', (event) => this.#down(event));
    root.addEventListener('pointermove', (event) => this.#move(event));
    root.addEventListener('pointerup', (event) => this.#up(event));
    root.addEventListener('pointercancel', () => this.#endGesture());
    root.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  #targetOf(node) {
    if (!(node instanceof Element)) return { kind: 'empty' };
    // The preview's buttons handle themselves; tapping the big card closes it.
    if (node.closest('.preview-actions, .menu-btn, .versus')) return null;
    if (node.closest('.preview')) return { kind: 'preview' };
    const main = node.closest('.main-btn');
    if (main) return { kind: 'main' };
    const ability = node.closest('.ability-btn');
    if (ability) return { kind: ability.classList.contains('me') ? 'ability' : 'oppAbility', emblem: ability.dataset.emblem, ability: ability.dataset.ability };
    const card = node.closest('.card[data-id]');
    if (card) return { kind: 'card', id: card.dataset.id, zone: card.dataset.zone, el: card, stackId: card.dataset.stackId };
    const land = node.closest('.land-group');
    if (land) return { kind: 'land', id: land.dataset.land };
    if (node.closest('.bar-me .grave-count')) return { kind: 'graveyard' };
    if (node.closest('.bar-me .exile-count')) return { kind: 'zone', zone: 'exile' };
    if (node.closest('.bar-me .lib-count')) return { kind: 'zone', zone: 'library' };
    const player = node.closest('[data-player]');
    if (player) return { kind: 'player', id: player.dataset.player };
    return { kind: 'empty' };
  }

  #down(event) {
    const target = this.#targetOf(event.target);
    if (!target) return;
    this.#gesture = { target, x: event.clientX, y: event.clientY, long: false, drag: null, pointerId: event.pointerId };
    this.#gesture.timer = setTimeout(() => {
      if (!this.#gesture || this.#gesture.drag) return;
      this.#gesture.long = true;
      this.#longPress(target);
    }, LONG_PRESS_MS);
  }

  #move(event) {
    const g = this.#gesture;
    if (!g || g.long) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (!g.drag) {
      if (Math.hypot(dx, dy) < 12) return;
      clearTimeout(g.timer);
      if (g.target.kind !== 'card' || g.target.zone !== 'hand' || !this.#interactive) {
        this.#gesture = null;
        return;
      }
      const option = this.#options.find((o) => o.sourceId === g.target.id);
      if (!option) {
        this.#gesture = null;
        return;
      }
      g.drag = { option, el: g.target.el };
      this.el.setPointerCapture?.(g.pointerId);
      g.drag.el.style.willChange = 'transform';
      g.drag.el.classList.add('dragging');
      this.#mode = { kind: 'idle' };
      this.#view.showPreview(null);
    }
    const { option, el } = g.drag;
    const handTop = relRect(this.#view.parts.hand, this.el).y;
    const point = { x: event.clientX - this.el.getBoundingClientRect().left, y: event.clientY - this.el.getBoundingClientRect().top };
    if (option.targets.length && point.y < handTop - 20) {
      // Aiming: the card waits in the hand while an arrow follows the finger, and
      // snaps onto a valid target under it.
      el.style.transform = 'translateY(-30px)';
      const r = relRect(el, this.el);
      const aimed = this.#targetUnder(event, option.targets);
      const aimedEl = aimed ? this.#view.elementFor(aimed) : null;
      const on = aimedEl ? relRect(aimedEl, this.el) : null;
      this.#view.drawArrow({ x: r.cx, y: r.y }, on ? { x: on.cx, y: on.cy } : point, { locked: Boolean(on) });
      this.#view.setAimed(aimedEl ? aimed : null);
      if (this.#mode.kind !== 'targeting') {
        this.#mode = { kind: 'targeting', targets: new Set(option.targets), sourceId: option.sourceId, prompt: 'Release on a target', pick: (id) => this.#commit(option, id) };
        this.#refresh();
      }
    } else {
      this.#view.drawArrow(null);
      this.#view.setAimed(null);
      el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx * 0.03}deg)`;
    }
  }

  #up(event) {
    const g = this.#gesture;
    if (!g) return;
    clearTimeout(g.timer);
    this.#gesture = null;
    if (g.long) return;
    if (g.drag) {
      const { option, el } = g.drag;
      el.classList.remove('dragging');
      el.style.willChange = '';
      this.#view.drawArrow(null);
      this.#view.setAimed(null);
      const handTop = relRect(this.#view.parts.hand, this.el).y;
      const y = event.clientY - this.el.getBoundingClientRect().top;
      const released = y < handTop - 20;
      const snapBack = () => {
        const current = el.style.transform;
        el.style.transform = '';
        el.animate([{ transform: current || 'none' }, { transform: 'none' }], { duration: 200, easing: 'ease-out' });
      };
      if (option.targets.length) {
        snapBack();
        const id = this.#targetUnder(event, option.targets);
        if (released && id) {
          this.#view.lockOn(id);
          this.#commit(option, id);
        } else {
          this.#cancel();
        }
      } else if (released) {
        el.style.transform = '';
        this.#commit(option, null);
      } else {
        snapBack();
      }
      return;
    }
    this.#tap(g.target);
  }

  /** The valid target (one of `targets`) under the pointer, or null. */
  #targetUnder(event, targets) {
    const target = this.#targetOf(document.elementFromPoint(event.clientX, event.clientY));
    const id = target?.kind === 'player' ? target.id
      : target?.kind === 'card' ? (target.stackId && targets.includes(target.stackId) ? target.stackId : target.id) : null;
    return id && targets.includes(id) ? id : null;
  }

  #endGesture() {
    if (this.#gesture) clearTimeout(this.#gesture.timer);
    if (this.#gesture?.drag) {
      this.#gesture.drag.el.style.transform = '';
      this.#gesture.drag.el.classList.remove('dragging');
      this.#view.drawArrow(null);
      this.#view.setAimed(null);
    }
    this.#gesture = null;
  }

  #longPress(target) {
    const state = this.#state;
    if (!state) return;
    if (target.kind === 'main') {
      this.#fullControl = !this.#fullControl;
      this.#view.toast(this.#fullControl ? 'Full control: stopping at every step' : 'Auto-pass on');
      this.#refresh();
      return;
    }
    if (target.kind === 'card' || target.kind === 'land') {
      const card = findCard(state, target.id);
      if (card && (card.cardId || card.kind === undefined)) this.#app.overlays.inspect(card.card ?? card);
      return;
    }
    if (target.kind === 'ability' || target.kind === 'oppAbility') this.#showAbility(target);
  }

  #showAbility(target) {
    const emblem = findCard(this.#state, target.emblem);
    const ability = emblem?.abilities.find((a) => a.id === target.ability);
    if (!ability) return;
    const option = this.#options.find((o) => o.sourceId === target.emblem && o.abilityId === target.ability);
    this.#app.overlays.sheet({
      title: emblem.name,
      text: ability.text,
      options: target.kind === 'ability' && option ? [{ label: 'Activate', primary: true, onPick: () => this.#begin(option) }] : [],
      cancel: 'Close',
    });
  }

  #tap(target) {
    const state = this.#state;
    if (!state) return;
    this.#app.sound('tap');
    const mode = this.#mode;
    if (target.kind === 'preview') {
      this.#cancel();
      return;
    }
    // Targeting: tap a target, or anything else to cancel.
    if (mode.kind === 'targeting') {
      const id = target.kind === 'player' ? target.id
        : target.kind === 'card' ? (target.stackId && mode.targets.has(target.stackId) ? target.stackId : target.id) : null;
      if (id && mode.targets.has(id)) {
        this.#mode = { kind: 'idle' };
        this.#view.lockOn(id);
        mode.pick(id);
      } else if (mode.cancel !== false) {
        this.#cancel();
      }
      return;
    }
    if (target.kind === 'main') {
      this.#pressMain();
      return;
    }
    if (target.kind === 'oppAbility') {
      this.#showAbility(target);
      return;
    }
    if (target.kind === 'graveyard') {
      this.#showGraveyard();
      return;
    }
    if (target.kind === 'zone') {
      this.#showZone(target.zone);
      return;
    }
    if (!this.#interactive) {
      // Cards stay inspectable while the opponent acts.
      if (target.kind === 'card' && target.zone === 'hand') this.#inspectHand(target);
      else if (target.kind === 'card') this.#longPress(target);
      else if (target.kind === 'empty' && this.#mode.inspecting) this.#cancel();
      return;
    }
    const decision = state.pendingDecision;
    const mine = state.validActions.filter((a) => a.playerId === this.#me);
    if (decision?.type === DECISION.DECLARE_ATTACKERS && target.kind === 'card') {
      const toggleAction = mine.find((a) => a.type === ACTION.TOGGLE_ATTACKER && a.cardId === target.id);
      if (toggleAction) this.#dispatch(toggleAction);
      else if (target.zone !== 'hand') this.#longPress(target);
      return;
    }
    if (decision?.type === DECISION.DECLARE_BLOCKERS && target.kind === 'card') {
      this.#tapBlock(target, mine, decision);
      return;
    }
    if (decision?.type === DECISION.CHOOSE_TARGETS) {
      const action = mine.find((a) => a.type === ACTION.CHOOSE_TARGETS && (a.targets[0] === target.id || a.targets[0] === target.stackId));
      if (action) this.#dispatch(action);
      return;
    }
    if (decision?.type === DECISION.PUT_ON_BOTTOM && target.kind === 'card' && target.zone === 'hand') {
      const card = findCard(state, target.id);
      const action = mine.find((a) => a.type === ACTION.PUT_ON_BOTTOM && a.cardId === target.id);
      this.#select(target, card, [{ label: 'Put on bottom', onPick: () => this.#dispatch(action) }]);
      return;
    }
    if (decision?.type === DECISION.CHOOSE && HAND_CHOICES.has(decision.kind) && target.kind === 'card' && target.zone === 'hand') {
      // A card from your hand: to discard (a loot), or to put on the bottom.
      const card = findCard(state, target.id);
      const action = mine.find((a) => a.type === ACTION.CHOOSE && a.choice === target.id);
      if (action) this.#select(target, card, [{ label: decision.kind === CHOICE.DISCARD ? 'Discard' : 'Put on bottom', danger: decision.kind === CHOICE.DISCARD, onPick: () => this.#dispatch(action) }]);
      return;
    }
    if (decision?.type === DECISION.DISCARD_TO_HAND_SIZE && target.kind === 'card' && target.zone === 'hand') {
      const card = findCard(state, target.id);
      const action = mine.find((a) => a.type === ACTION.DISCARD && a.cardId === target.id);
      this.#select(target, card, [{ label: 'Discard', danger: true, onPick: () => this.#dispatch(action) }]);
      return;
    }
    if (target.kind === 'ability') {
      const option = this.#options.find((o) => o.sourceId === target.emblem && o.abilityId === target.ability);
      if (option) this.#begin(option);
      else this.#showAbility(target);
      return;
    }
    if (target.kind === 'card') {
      this.#tapCard(target);
      return;
    }
    if (target.kind === 'land') {
      this.#longPress(target);
      return;
    }
    if (mode.kind !== 'idle') this.#cancel();
  }

  #pressMain() {
    if (this.#mode.skip) {
      const { skip } = this.#mode;
      this.#mode = { kind: 'idle' };
      skip();
      return;
    }
    if (this.#mode.kind !== 'idle') {
      if (this.#mode.cancel === false) return;
      this.#cancel();
      return;
    }
    if (!this.#interactive) return;
    const primary = primaryAction(this.#state, this.#me);
    if (primary.reopen) {
      this.#openDecisionSheet(this.#state);
      return;
    }
    if (!primary.action) {
      if (primary.hint) this.#view.toast(primary.hint);
      return;
    }
    if (primary.endTurn) this.#endTurnOf = this.#state.turn;
    this.#app.sound('select');
    this.#dispatch(primary.action);
  }

  #tapBlock(target, mine, decision) {
    const mode = this.#mode;
    const isMine = mine.some((a) => a.type === ACTION.SET_BLOCKER && a.cardId === target.id);
    if (isMine) {
      // Tapping a blocker that's already blocking takes it back.
      if (decision.blocks[target.id] && mode.blockerId !== target.id) {
        const unblock = mine.find((a) => a.type === ACTION.SET_BLOCKER && a.cardId === target.id && a.attackerId === null);
        if (unblock) this.#dispatch(unblock);
        return;
      }
      this.#mode = mode.blockerId === target.id ? { kind: 'idle' } : { kind: 'blocker', blockerId: target.id };
      this.#refresh();
      return;
    }
    if (mode.kind === 'blocker') {
      const action = mine.find((a) => a.type === ACTION.SET_BLOCKER && a.cardId === mode.blockerId && a.attackerId === target.id);
      if (action) this.#dispatch(action);
      else this.#view.toast('Can\'t block that');
      return;
    }
    this.#longPress(target);
  }

  /** Tapping a card with priority: select it and show what it can do. */
  #tapCard(target) {
    const state = this.#state;
    const card = findCard(state, target.id);
    if (!card) return;
    if (this.#mode.kind === 'selected' && this.#mode.id === target.id) {
      this.#cancel();
      return;
    }
    if (target.zone === 'stack') {
      this.#app.overlays.inspect(card);
      return;
    }
    const options = this.#options.filter((o) => o.sourceId === target.id);
    if (target.zone === 'hand') {
      this.#inspectHand(target);
      return;
    }
    // Mana abilities are paid automatically, but our own can be activated by hand too:
    // to float mana, e.g. before untapping the creature to tap it again.
    const abilities = (card.abilities ?? []).filter((a) => !a.isManaAbility || card.controllerId === this.#me);
    if (!abilities.length) {
      this.#app.overlays.inspect(card);
      return;
    }
    const mine = state.validActions.filter((a) => a.playerId === this.#me && a.type === ACTION.ACTIVATE_ABILITY && a.cardId === card.id);
    const actions = abilities.flatMap((ability) => {
      if (ability.isManaAbility) {
        const activations = mine.filter((a) => a.abilityId === ability.id);
        if (activations.length <= 1) {
          return [{ label: inlineSymbols(ability.text), disabled: !activations.length, onPick: () => this.#dispatch(activations[0]) }];
        }
        // "Add one mana of any color": one button per color.
        return activations.map((a) => ({ label: inlineSymbols(`Add {${a.manaColor}}`), onPick: () => this.#dispatch(a) }));
      }
      const option = options.find((o) => o.abilityId === ability.id);
      return [{ label: inlineSymbols(ability.text), disabled: !option, onPick: () => option && this.#begin(option) }];
    });
    this.#select(target, card, actions);
  }

  #select(target, card, actions) {
    this.#mode = { kind: 'selected', id: target.id, zone: target.zone };
    this.#app.sound('select');
    this.#view.showPreview(card, actions);
    this.#refresh();
  }

  /** Your graveyard: its cards, and the abilities that work from there (Gollum, Patient Plotter). */
  #showGraveyard() {
    const state = this.#state;
    const { graveyard } = state.players.find((p) => p.id === this.#me);
    const options = this.#interactive ? this.#options.filter((o) => o.fromGraveyard) : [];
    this.#app.overlays.sheet({
      title: `Graveyard (${graveyard.length})`,
      body: graveyard.length ? h('div.mull-hand', [...graveyard].reverse().map((card) => h('div.mull-card', fullCard(card, this.#app.definitions)))) : null,
      text: graveyard.length ? null : 'Empty.',
      options: options.map((option, i) => ({
        label: inlineSymbols(option.text),
        sub: findCard(state, option.sourceId)?.name,
        primary: i === 0,
        onPick: () => this.#begin(option),
      })),
      cancel: 'Close',
    });
  }

  /**
   * Your exile, or what you may see of your library (its top card, with Elven Chorus), with what you may play
   * from there: Moria Marauder's card this turn, Shadow of the Enemy's creatures, Elven Chorus's creature on top.
   */
  #showZone(zone) {
    const state = this.#state;
    const me = state.players.find((p) => p.id === this.#me);
    const options = this.#interactive ? this.#options.filter((o) => o.fromZone === zone) : [];
    const playable = options.map((o) => findCard(state, o.sourceId) ?? (zone === 'library' ? me.library[0] : null)).filter(Boolean);
    const cards = zone === 'exile' ? [...me.exile, ...playable.filter((c) => !me.exile.includes(c))] : playable;
    if (zone === 'library' && cards.length === 0) return;
    this.#app.overlays.sheet({
      title: zone === 'exile' ? `Exile (${me.exile.length})` : 'Top of your library',
      body: cards.length ? h('div.mull-hand', [...cards].reverse().map((card) => h('div.mull-card', fullCard(card, this.#app.definitions)))) : null,
      text: cards.length ? null : 'Empty.',
      options: options.map((option, i) => {
        const card = findCard(state, option.sourceId) ?? me.library[0];
        return {
          label: `${option.kind === 'land' ? 'Play' : 'Cast'} ${card?.name ?? ''}`,
          primary: i === 0,
          onPick: () => (option.kind === 'land' ? this.#dispatch(option.variants[0]) : this.#begin(option)),
        };
      }),
      cancel: 'Close',
    });
  }

  #whyNot(card) {
    const state = this.#state;
    if (card.types.includes('Land')) return state.activePlayerId !== this.#me ? 'Play lands on your turn' : 'One land per turn';
    const sorcerySpeed = !castsAtInstantSpeed(card);
    if (sorcerySpeed && (state.activePlayerId !== this.#me || state.stack.length)) return 'Cast on your main phase';
    return 'Not enough mana';
  }

  /** For tests and debugging: what the battle is doing. */
  debug() {
    const state = this.#game.peekState();
    return {
      interactive: this.#interactive, presenting: this.#presenting, queued: this.#queue.length, mode: this.#mode.kind,
      options: this.#options.length, turn: state.turn, phase: state.phase, step: state.step, acting: actingPlayerId(state),
      decision: state.pendingDecision?.type ?? null, finished: this.#finished,
    };
  }

  /** For tests and debugging: the live game. */
  get game() { return this.#game; }

  get busy() { return this.#presenting || this.#queue.length > 0; }

  get nameOf() { return (id) => nameOf(this.#state, id, this.#me); }
}
