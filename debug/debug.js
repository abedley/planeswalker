import {
  Game, AutoPassController, TURN_STRUCTURE, PHASE_NAMES, STEP_NAMES, ACTION,
} from '../src/index.js';

const PLAYERS = [
  { id: 'p1', name: 'You' },
  { id: 'p2', name: 'Opponent' },
];
const MAX_LOG_ENTRIES = 500;

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const ui = {
  setup: $('setup'),
  startingPlayer: $('starting-player'),
  aiDelay: $('ai-delay'),
  status: $('status'),
  tracker: $('tracker'),
  players: $('players'),
  log: $('log'),
  showState: $('show-state'),
  clearLog: $('clear-log'),
  stateJson: $('state-json'),
};

// Which players are driven by the auto-pass AI. The opponent is, by default.
const controllerKinds = new Map([['p1', 'human'], ['p2', 'auto']]);
const controllers = new Map();
let game = null;
let latestState = null;
let skippedThisTurn = new Set();

// -----------------------------------------------------------------------------
// Game lifecycle

function newGame() {
  for (const controller of controllers.values()) controller.detach();
  controllers.clear();
  ui.log.replaceChildren();
  skippedThisTurn = new Set();

  game = new Game({ players: PLAYERS, startingPlayerId: ui.startingPlayer.value });
  window.game = game;

  game.onAny(logEvent);
  game.on('turnStarted', () => { skippedThisTurn = new Set(); });
  game.on('stepSkipped', ({ phase, step }) => skippedThisTurn.add(segmentIndexOf(phase, step)));
  game.on('state', render);

  for (const player of PLAYERS) setController(player.id, controllerKinds.get(player.id));
  game.start();
}

function setController(playerId, kind) {
  controllerKinds.set(playerId, kind);
  controllers.get(playerId)?.detach();
  controllers.delete(playerId);
  if (kind === 'auto') {
    controllers.set(playerId, new AutoPassController({ game, playerId, delayMs: aiDelay() }));
  }
}

function segmentIndexOf(phase, step) {
  return TURN_STRUCTURE.findIndex((s) => s.phase === phase && s.step === step);
}

function aiDelay() {
  return Math.max(0, Number(ui.aiDelay.value) || 0);
}

function dispatch(action) {
  game.dispatch(action);
}

// -----------------------------------------------------------------------------
// Rendering

function render(state) {
  latestState = state;
  renderStatus(state);
  renderTracker(state);
  renderPlayers(state);
  ui.stateJson.textContent = JSON.stringify(state, null, 2);
}

function renderStatus(state) {
  const name = (id) => state.players.find((p) => p.id === id)?.name ?? '—';
  const where = state.stepName ? `${state.phaseName} › ${state.stepName}` : state.phaseName;
  const item = (label, value) => el('div', {}, [el('span', { textContent: label }), el('strong', { textContent: value })]);
  ui.status.replaceChildren(
    item('Turn', String(state.turn)),
    item('Active player', name(state.activePlayerId)),
    item('Priority', name(state.priorityPlayerId)),
    item('Now', where ?? '—'),
    item('State version', String(state.version)),
  );
}

function renderTracker(state) {
  const phases = [];
  TURN_STRUCTURE.forEach((segment, index) => {
    let group = phases.at(-1);
    if (group?.phase !== segment.phase) {
      group = { phase: segment.phase, items: [] };
      phases.push(group);
    }
    let status = 'upcoming';
    if (index === state.segmentIndex) status = 'current';
    else if (skippedThisTurn.has(index)) status = 'skipped';
    else if (index < state.segmentIndex) status = 'done';

    const label = segment.step ? STEP_NAMES[segment.step].replace(/ Step$/, '') : 'Main';
    const title = [
      segment.step ? STEP_NAMES[segment.step] : PHASE_NAMES[segment.phase],
      segment.priority ? 'players get priority' : 'no priority',
      status,
    ].join(' · ');
    group.items.push(el('li', { className: `chip ${status}`, textContent: label, title }));
  });

  ui.tracker.replaceChildren(...phases.map(({ phase, items }) => el('div', {
    className: `phase${phase === state.phase ? ' current' : ''}`,
  }, [el('h3', { textContent: PHASE_NAMES[phase] }), el('ol', {}, items)])));
}

function renderPlayers(state) {
  ui.players.replaceChildren(...state.players.map((player) => {
    const badges = [];
    if (player.id === state.activePlayerId) badges.push(badge('Active player', 'active'));
    if (player.id === state.priorityPlayerId) badges.push(badge('Has priority', 'priority'));
    if (state.playersPassed.includes(player.id)) badges.push(badge('Passed', 'passed'));

    const select = el('select', { ariaLabel: `${player.name} controller` }, [
      el('option', { value: 'human', textContent: 'Human (buttons)' }),
      el('option', { value: 'auto', textContent: 'AI: always pass' }),
    ]);
    select.value = controllerKinds.get(player.id);
    select.addEventListener('change', () => {
      setController(player.id, select.value);
      controllers.get(player.id)?.actNow();
      renderPlayers(latestState);
    });

    // The buttons come straight from the validActions in the emitted state.
    const actions = state.validActions.filter((a) => a.playerId === player.id);
    const isHuman = controllerKinds.get(player.id) === 'human';
    const buttons = actions.map((action) => {
      const button = el('button', { type: 'button', textContent: actionLabel(action), disabled: !isHuman });
      button.addEventListener('click', () => dispatch(action));
      return button;
    });
    const waiting = actions.length && !isHuman ? 'AI is thinking…' : 'No valid actions — waiting.';

    return el('article', {
      className: `player panel${player.id === state.priorityPlayerId ? ' has-priority' : ''}`,
    }, [
      el('div', { className: 'panel-head' }, [
        el('h2', {}, [player.name, el('small', { textContent: ` ${player.id}` })]),
        select,
      ]),
      el('div', { className: 'badges' }, badges),
      el('div', { className: 'actions' }, buttons.length && isHuman
        ? buttons
        : [...buttons, el('p', { className: 'muted', textContent: waiting })]),
    ]);
  }));
}

function badge(text, kind) {
  return el('span', { className: `badge ${kind}`, textContent: text });
}

function actionLabel(action) {
  switch (action.type) {
    case ACTION.PASS_PRIORITY: return 'Pass priority';
    default: return action.type;
  }
}

// -----------------------------------------------------------------------------
// Event log

function logEvent(name, payload) {
  const entry = el('li', { className: `event ev-${name}` }, [
    el('details', {}, [
      el('summary', {}, [
        el('span', { className: 'seq', textContent: `#${payload.seq}` }),
        el('span', { className: 'name', textContent: name }),
        el('span', { className: 'summary', textContent: summarize(name, payload) }),
      ]),
      el('pre', { className: 'json', textContent: JSON.stringify(payload, null, 2) }),
    ]),
  ]);
  entry.hidden = name === 'state' && !ui.showState.checked;
  ui.log.prepend(entry);
  while (ui.log.children.length > MAX_LOG_ENTRIES) ui.log.lastElementChild.remove();
}

function summarize(name, p) {
  const who = (id) => PLAYERS.find((pl) => pl.id === id)?.name ?? id;
  switch (name) {
    case 'gameStarted': return `${who(p.startingPlayerId)} plays first`;
    case 'turnStarted':
    case 'turnEnded': return `turn ${p.turn} (${who(p.activePlayerId)})`;
    case 'phaseStarted':
    case 'phaseEnded': return p.phaseName;
    case 'stepStarted':
    case 'stepEnded':
    case 'stepSkipped': return p.stepName;
    case 'priorityGranted': return `→ ${who(p.playerId)}`;
    case 'priorityPassed': return `${who(p.playerId)} passed`;
    case 'actionAccepted': return `${p.action.type} by ${who(p.action.playerId)}`;
    case 'actionRejected': return p.reason;
    case 'state': return `v${p.version} · priority: ${who(p.priorityPlayerId)} · ${p.validActions.length} valid action(s)`;
    default: return '';
  }
}

// -----------------------------------------------------------------------------
// Wiring

ui.setup.addEventListener('submit', (event) => {
  event.preventDefault();
  newGame();
});

ui.aiDelay.addEventListener('change', () => {
  for (const controller of controllers.values()) controller.delayMs = aiDelay();
});

ui.showState.addEventListener('change', () => {
  for (const entry of ui.log.querySelectorAll('.ev-state')) entry.hidden = !ui.showState.checked;
});

ui.clearLog.addEventListener('click', () => ui.log.replaceChildren());

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.target.closest('input, select, button, textarea, summary')) return;
  const action = latestState?.validActions.find((a) => controllerKinds.get(a.playerId) === 'human');
  if (!action) return;
  event.preventDefault();
  dispatch(action);
});

newGame();
