import {
  Game, BasicAIController, TURN_STRUCTURE, PHASE_NAMES, STEP_NAMES, ACTION, GAME_STATUS,
  LAND_PLAYS_PER_TURN,
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
  seed: $('seed'),
  aiDelay: $('ai-delay'),
  status: $('status'),
  tracker: $('tracker'),
  players: $('players'),
  log: $('log'),
  showState: $('show-state'),
  clearLog: $('clear-log'),
  stateJson: $('state-json'),
};

const CONTROLLER_KINDS = {
  human: { label: 'Human (buttons)' },
  ai: { label: 'AI: play lands, pass', playLands: true },
  pass: { label: 'AI: always pass', playLands: false },
};

// How each player is controlled. The opponent is an AI by default.
const controllerKinds = new Map([['p1', 'human'], ['p2', 'ai']]);
const controllers = new Map();
let game = null;
let seed = null;
let latestState = null;
let skippedThisTurn = new Set();

// -----------------------------------------------------------------------------
// Game lifecycle

function newGame() {
  for (const controller of controllers.values()) controller.detach();
  controllers.clear();
  ui.log.replaceChildren();
  skippedThisTurn = new Set();

  seed = ui.seed.value.trim() === '' ? Math.floor(Math.random() * 1e9) : Number(ui.seed.value);
  game = new Game({ players: PLAYERS, startingPlayerId: ui.startingPlayer.value, seed });
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
  if (kind !== 'human') {
    const { playLands } = CONTROLLER_KINDS[kind];
    controllers.set(playerId, new BasicAIController({ game, playerId, delayMs: aiDelay(), playLands }));
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

const isHuman = (playerId) => controllerKinds.get(playerId) === 'human';

// -----------------------------------------------------------------------------
// Rendering

function render(state) {
  latestState = state;
  renderStatus(state);
  renderTracker(state);
  renderPlayers(state);
  ui.stateJson.textContent = JSON.stringify(state, null, 2);
}

function playerName(id) {
  return PLAYERS.find((p) => p.id === id)?.name ?? id ?? '—';
}

function renderStatus(state) {
  const where = state.stepName ? `${state.phaseName} › ${state.stepName}` : state.phaseName;
  const item = (label, value, className = '') => el('div', { className }, [
    el('span', { textContent: label }), el('strong', { textContent: value }),
  ]);
  const items = [
    item('Turn', String(state.turn)),
    item('Active player', playerName(state.activePlayerId)),
    item('Priority', playerName(state.priorityPlayerId)),
    item('Now', where ?? '—'),
    item('State version', String(state.version)),
    item('Seed', String(seed)),
  ];
  if (state.status === GAME_STATUS.GAME_OVER) {
    const result = state.winnerId ? `${playerName(state.winnerId)} won` : 'Draw';
    items.unshift(item('Game over', result, 'game-over'));
  }
  ui.status.replaceChildren(...items);
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
    if (player.hasLost) badges.push(badge('Lost', 'lost'));
    if (player.id === state.winnerId) badges.push(badge('Winner', 'active'));
    if (player.id === state.activePlayerId) badges.push(badge('Active player', 'active'));
    if (player.id === state.priorityPlayerId) badges.push(badge('Has priority', 'priority'));
    if (state.playersPassed.includes(player.id)) badges.push(badge('Passed', 'passed'));
    if (state.pendingDecision?.playerId === player.id) badges.push(badge('Deciding', 'priority'));

    const select = el('select', { ariaLabel: `${player.name} controller` },
      Object.entries(CONTROLLER_KINDS).map(([value, { label }]) => el('option', { value, textContent: label })));
    select.value = controllerKinds.get(player.id);
    select.addEventListener('change', () => {
      setController(player.id, select.value);
      controllers.get(player.id)?.actNow();
      renderPlayers(latestState);
    });

    // Every button below comes straight from the validActions in the emitted state.
    const human = isHuman(player.id);
    const actions = state.validActions.filter((a) => a.playerId === player.id);
    const actionButton = (action, label) => {
      const button = el('button', { type: 'button', textContent: label, disabled: !human });
      button.addEventListener('click', () => dispatch(action));
      return button;
    };
    const general = actions.filter((a) => !a.cardId).map((a) => actionButton(a, actionLabel(a)));
    const cardActions = (card) => actions
      .filter((a) => a.cardId === card.id)
      .map((a) => actionButton(a, actionLabel(a)));

    let prompt = null;
    if (state.pendingDecision?.playerId === player.id) {
      const { count } = state.pendingDecision;
      prompt = `Hand size limit: discard ${count} card${count === 1 ? '' : 's'}.`;
    } else if (actions.length === 0) {
      prompt = 'No valid actions — waiting.';
    } else if (!human) {
      prompt = 'AI is thinking…';
    }

    const permanents = state.battlefield.filter((p) => p.controllerId === player.id);
    const zoneCount = (label, value) => el('span', {}, [`${label} `, el('strong', { textContent: String(value) })]);

    return el('article', {
      className: `player panel${player.id === state.priorityPlayerId ? ' has-priority' : ''}`,
    }, [
      el('div', { className: 'panel-head' }, [
        el('h2', {}, [player.name, el('small', { textContent: ` ${player.id}` })]),
        select,
      ]),
      el('div', { className: 'badges' }, badges),
      el('div', { className: 'zones' }, [
        zoneCount('Library', player.library.length),
        zoneCount('Hand', player.hand.length),
        zoneCount('Graveyard', player.graveyard.length),
        zoneCount('Lands played', `${player.landsPlayedThisTurn}/${LAND_PLAYS_PER_TURN}`),
      ]),
      el('div', { className: 'actions' }, [
        ...general,
        ...(prompt ? [el('p', { className: 'muted', textContent: prompt })] : []),
      ]),
      el('h3', { textContent: `Hand (${player.hand.length})` }),
      cardRow(player.hand, cardActions, 'Empty'),
      el('h3', { textContent: `Battlefield (${permanents.length})` }),
      cardRow(permanents, () => [], 'No permanents'),
    ]);
  }));
}

function cardRow(cards, actionsFor, emptyText) {
  if (cards.length === 0) return el('p', { className: 'muted cards-empty', textContent: emptyText });
  return el('ul', { className: 'cards' }, cards.map((card) => {
    const buttons = actionsFor(card);
    return el('li', {
      className: `card${card.tapped ? ' tapped' : ''}${buttons.length ? ' playable' : ''}`,
      title: `${card.name} (${card.id})${card.tapped ? ' · tapped' : ''}`,
    }, [
      el('span', { className: 'card-name', textContent: card.name }),
      el('span', { className: 'card-id', textContent: card.id }),
      ...buttons,
    ]);
  }));
}

function badge(text, kind) {
  return el('span', { className: `badge ${kind}`, textContent: text });
}

function actionLabel(action) {
  switch (action.type) {
    case ACTION.PASS_PRIORITY: return 'Pass priority';
    case ACTION.PLAY_LAND: return 'Play';
    case ACTION.DISCARD: return 'Discard';
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
  const who = playerName;
  switch (name) {
    case 'gameStarted': return `${who(p.startingPlayerId)} plays first`;
    case 'libraryShuffled': return `${who(p.playerId)} shuffled their library`;
    case 'cardsDrawn': return `${who(p.playerId)} drew ${p.cardIds.length} (${p.librarySize} left in library)`;
    case 'drawFromEmptyLibrary': return `${who(p.playerId)} tried to draw from an empty library`;
    case 'turnStarted':
    case 'turnEnded': return `turn ${p.turn} (${who(p.activePlayerId)})`;
    case 'phaseStarted':
    case 'phaseEnded': return p.phaseName;
    case 'stepStarted':
    case 'stepEnded':
    case 'stepSkipped': return p.stepName;
    case 'priorityGranted': return `→ ${who(p.playerId)}`;
    case 'priorityPassed': return `${who(p.playerId)} passed`;
    case 'landPlayed': return `${who(p.playerId)} played ${p.card.name} (${p.card.id})`;
    case 'decisionRequired': return `${who(p.playerId)} must discard ${p.count}`;
    case 'cardDiscarded': return `${who(p.playerId)} discarded ${p.cardId}`;
    case 'permanentsUntapped': return `${who(p.playerId)} untapped ${p.cardIds.length}`;
    case 'playerLost': return `${who(p.playerId)}: ${p.reason}`;
    case 'gameEnded': return p.winnerId ? `${who(p.winnerId)} won` : 'draw';
    case 'actionAccepted': return `${p.action.type}${p.action.cardId ? ` ${p.action.cardId}` : ''} by ${who(p.action.playerId)}`;
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
  const action = latestState?.validActions.find(
    (a) => a.type === ACTION.PASS_PRIORITY && isHuman(a.playerId),
  );
  if (!action) return;
  event.preventDefault();
  dispatch(action);
});

newGame();
