/**
 * A battle: the game, the CPU opponent, and the player's input.
 *
 * The engine runs instantly and emits events; the board plays them back as
 * animations, one state at a time (a queue that speeds up when it falls behind).
 * The player can act once the board has caught up and it's their move. Priority
 * is passed automatically when there's nothing sensible to do (autopass.js), and
 * every play is one tap: mana is tapped for you (play.js).
 */
import { Game, GAME_STATUS, DECISION, OPENING_HAND_SIZE } from '../../src/engine/Game.js';
import { ACTION } from '../../src/engine/actions.js';
import { actingPlayerId } from '../../src/ai/simulate.js';
import { createCpuController } from '../../src/campaign/cpu.js';
import { h, wait } from '../dom.js';
import { icon } from '../icons.js';
import { crest, preloadImages } from '../art.js';
import { BoardView } from './BoardView.js';
import {
  playOptions, variantsFor, secondTargets, perform,
} from './play.js';
import { shouldAutoPass, primaryAction } from './autopass.js';
import { promptFor, variantLabel, nameOf, findCard } from './describe.js';
import { damagePlans } from './damage.js';
import { boardCard, fullCard, typeLine } from '../cardView.js';
import { relRect } from './fx.js';
import { inlineSymbols } from '../symbols.js';
import { isLand, castsAtInstantSpeed, TARGET } from '../../src/cards/cards.js';

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
    this.#game = new Game(setup.game);
    this.#view = new BoardView(app, { me: this.#me, opp: this.#opp, meInfo, oppInfo });
    this.el = this.#view.el;
    this.#cpu = createCpuController(this.#game, setup.cpu, { delayMs: Math.round(650 * app.settings.speed) });
    if (this.#cpu.on) this.#unsubscribe.push(this.#cpu.on('thinking', ({ active }) => this.#view.setThinking(active)));
    this.#unsubscribe.push(this.#game.onAny((name, payload) => this.#onEvent(name, payload)));
    this.#bindInput();
    this.el.append(h('button.menu-btn', { 'aria-label': 'Menu', onclick: () => this.#menu() }, icon('gear')));
    this.#intro = { meInfo, oppInfo, subtitle, setup };
    const onResize = () => this.#view.relayout();
    window.addEventListener('resize', onResize);
    this.#unsubscribe.push(() => window.removeEventListener('resize', onResize));
  }

  /** Shows the "versus" intro while card art loads, then starts the game. */
  async start() {
    if (this.#intro.started) return;
    this.#intro.started = true;
    const { meInfo, oppInfo, subtitle, setup } = this.#intro;
    const defs = this.#app.definitions;
    const urls = [...setup.game.decks[this.#me], ...setup.game.decks[this.#opp]].map((id) => defs[id]?.image?.art);
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
  }

  // ---------------------------------------------------------------------------
  // Events → animations

  #onEvent(name, payload) {
    if (name !== 'state') {
      this.#pending.push({ name, payload });
      return;
    }
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
        break;
      default: break;
    }
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
    await this.#view.finale(won, this.#app.settings.speed);
    this.#cpu.detach();
    this.#onEnd?.({ won, turns: state.turn });
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
      ctx.main = { label: mode.cancel === false ? '…' : 'Cancel', disabled: mode.cancel === false };
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
      return option.kind === 'land' ? 'Play land' : option.targets.length ? 'Cast → target' : 'Cast';
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

  /** Starts a play: choose its target if it has one, then any remaining choice. */
  #begin(option) {
    this.#view.showPreview(null);
    if (option.targets.length) {
      this.#mode = {
        kind: 'targeting',
        targets: new Set(option.targets),
        sourceId: option.sourceId,
        // The source shows itself (the lifted card, the lit ability button); the lane is narrow.
        prompt: 'Choose a target',
        pick: (targetId) => this.#commit(option, targetId),
      };
      this.#app.sound('select');
      this.#refresh();
      return;
    }
    this.#commit(option, null);
  }

  #commit(option, targetId, secondId = null) {
    let variants = variantsFor(option, targetId);
    // A second target (a fight): tap it on the board.
    const seconds = secondTargets(variants);
    if (seconds.length > 1 && secondId === null) {
      this.#mode = {
        kind: 'targeting',
        targets: new Set(seconds),
        sourceId: targetId,
        prompt: 'Choose the second target',
        pick: (id) => this.#commit(option, targetId, id),
      };
      this.#refresh();
      return;
    }
    if (secondId !== null) variants = variants.filter((v) => v.targets[1] === secondId);
    const go = (variant) => {
      this.#mode = { kind: 'idle' };
      this.#view.showPreview(null);
      clearTimeout(this.#autoTimer);
      const result = perform(this.#game, this.#me, option, variant);
      if (!result.ok) this.#view.toast(result.reason ?? 'Not allowed');
    };
    if (variants.length === 1) {
      go(variants[0]);
      return;
    }
    const state = this.#state;
    // Choices that read the same (two identical tokens) are the same choice: list one.
    const byLabel = new Map();
    for (const variant of variants) {
      const label = variantLabel(state, variant, this.#me);
      if (!byLabel.has(label)) byLabel.set(label, variant);
    }
    if (byLabel.size === 1) {
      go(variants[0]);
      return;
    }
    this.#app.overlays.sheet({
      title: 'Choose how to pay',
      options: [...byLabel].map(([label, variant]) => ({ label: inlineSymbols(label), onPick: () => go(variant) })),
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
      extra: [{ label: 'Concede', danger: true, onPick: () => this.#concede() }],
    });
  }

  async #concede() {
    const yes = await this.#app.overlays.confirm({ title: 'Concede?', text: 'This counts as a loss.', yes: 'Concede', danger: true });
    if (!yes || this.#finished) return;
    this.#finished = true;
    clearTimeout(this.#autoTimer);
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
      // Aiming: the card waits in the hand while an arrow follows the finger.
      el.style.transform = 'translateY(-30px)';
      const r = relRect(el, this.el);
      this.#view.drawArrow({ x: r.cx, y: r.y }, point);
      if (this.#mode.kind !== 'targeting') {
        this.#mode = { kind: 'targeting', targets: new Set(option.targets), sourceId: option.sourceId, prompt: 'Release on a target', pick: (id) => this.#commit(option, id) };
        this.#refresh();
      }
    } else {
      this.#view.drawArrow(null);
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
        const under = document.elementFromPoint(event.clientX, event.clientY);
        const target = this.#targetOf(under);
        const id = target?.kind === 'player' ? target.id
          : target?.kind === 'card' ? (target.stackId && option.targets.includes(target.stackId) ? target.stackId : target.id) : null;
        if (released && id && option.targets.includes(id)) this.#commit(option, id);
        else this.#cancel();
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

  #endGesture() {
    if (this.#gesture) clearTimeout(this.#gesture.timer);
    if (this.#gesture?.drag) {
      this.#gesture.drag.el.style.transform = '';
      this.#gesture.drag.el.classList.remove('dragging');
      this.#view.drawArrow(null);
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
    if (this.#mode.kind !== 'idle') {
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
    if (!card.abilities?.some((a) => !a.isManaAbility)) {
      this.#app.overlays.inspect(card);
      return;
    }
    const actions = card.abilities.filter((a) => !a.isManaAbility).map((ability) => {
      const option = options.find((o) => o.abilityId === ability.id);
      return { label: inlineSymbols(ability.text), disabled: !option, onPick: () => option && this.#begin(option) };
    });
    this.#select(target, card, actions);
  }

  #select(target, card, actions) {
    this.#mode = { kind: 'selected', id: target.id, zone: target.zone };
    this.#app.sound('select');
    this.#view.showPreview(card, actions);
    this.#refresh();
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
