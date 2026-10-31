import {
  Game, BasicAIController, TURN_STRUCTURE, PHASE_NAMES, STEP_NAMES, ACTION, GAME_STATUS,
  LAND_PLAYS_PER_TURN, formatMana, manaPoolTotal, AI_STRATEGY, DECISION, isCreature, hasKeyword, KEYWORD,
  DEFAULT_DECK, SAMPLE_CARDS, SAMPLE_DECK, SAMPLE_PERMANENTS, SAMPLE_PERMANENTS_DECK, SAMPLE_SPELLS,
  SAMPLE_SPELLS_DECK, SAMPLE_EFFECTS, SAMPLE_EFFECTS_DECK, SAMPLE_TRIGGERS, SAMPLE_TRIGGERS_DECK, REAL_DECKS, isAura,
  LTR_DECKS, CHOICE,
} from '../src/index.js';
import { SearchAIController } from '../src/ai/SearchAIController.js';

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
  deck: $('deck'),
  seed: $('seed'),
  aiDelay: $('ai-delay'),
  status: $('status'),
  tracker: $('tracker'),
  players: $('players'),
  log: $('log'),
  showState: $('show-state'),
  clearLog: $('clear-log'),
  stateJson: $('state-json'),
  stack: $('stack'),
  combat: $('combat'),
};

const DECKS = {
  standard: DEFAULT_DECK,
  keywords: SAMPLE_DECK,
  permanents: SAMPLE_PERMANENTS_DECK,
  spells: SAMPLE_SPELLS_DECK,
  effects: SAMPLE_EFFECTS_DECK,
  triggers: SAMPLE_TRIGGERS_DECK,
  white: REAL_DECKS.whiteWeenie,
  blue: REAL_DECKS.blueSkies,
  black: REAL_DECKS.blackRemoval,
  red: REAL_DECKS.redBurn,
  green: REAL_DECKS.greenStompy,
  fellowship: LTR_DECKS.fellowship,
  mordor: LTR_DECKS.mordor,
  // A deck per player.
  fellowshipVsMordor: { p1: LTR_DECKS.fellowship, p2: LTR_DECKS.mordor },
};

const CONTROLLER_KINDS = {
  human: { label: 'Human (buttons)' },
  ai: { label: 'AI: basic', strategy: AI_STRATEGY.BASIC },
  pass: { label: 'AI: passive', strategy: AI_STRATEGY.PASSIVE },
  search: { label: 'AI: search (thinks ~2s)', search: true },
};

// What each search AI is thinking about: { active, candidates, iterations }.
const thinking = new Map();

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
  const deck = DECKS[ui.deck.value];
  game = new Game({
    players: PLAYERS,
    startingPlayerId: ui.startingPlayer.value,
    seed,
    cards: { ...SAMPLE_CARDS, ...SAMPLE_PERMANENTS, ...SAMPLE_SPELLS, ...SAMPLE_EFFECTS, ...SAMPLE_TRIGGERS },
    decks: Object.fromEntries(PLAYERS.map(({ id }) => [id, Array.isArray(deck) ? deck : deck[id]])),
  });
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
  thinking.delete(playerId);
  if (CONTROLLER_KINDS[kind].search) {
    // Each deck can have its own evaluation weights (DECK_WEIGHTS, by deck name); others get the defaults.
    const controller = new SearchAIController({
      game, playerId, responseMs: Math.max(200, aiDelay()), weights: ui.deck.value,
    });
    controller.on('thinking', (info) => {
      thinking.set(playerId, { ...thinking.get(playerId), ...info });
      if (latestState) renderPlayers(latestState);
    });
    controllers.set(playerId, controller);
  } else if (kind !== 'human') {
    const { strategy } = CONTROLLER_KINDS[kind];
    controllers.set(playerId, new BasicAIController({ game, playerId, delayMs: aiDelay(), strategy }));
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
  renderStack(state);
  renderCombat(state);
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
    if (thinking.get(player.id)?.active) badges.push(badge('Thinking…', 'priority'));

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
    const general = actions.filter((a) => !a.cardId).map((a) => actionButton(a, actionLabel(a, null, state)));
    const cardActions = (card) => actions
      .filter((a) => a.cardId === card.id)
      .map((a) => actionButton(a, actionLabel(a, card, state)));

    let prompt = null;
    if (state.pendingDecision?.playerId === player.id) {
      prompt = decisionPrompt(state.pendingDecision);
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
        el('span', { className: 'life' }, ['Life ', el('strong', { textContent: String(player.life) })]),
        zoneCount('Library', player.library.length),
        zoneCount('Hand', player.hand.length),
        zoneCount('Graveyard', player.graveyard.length),
        zoneCount('Exile', player.exile.length),
        zoneCount('Lands played', `${player.landsPlayedThisTurn}/${LAND_PLAYS_PER_TURN}`),
        zoneCount('Mana pool', manaPoolTotal(player.manaPool) || player.specialMana?.length ? manaText(player) : 'empty'),
        ...(player.ring?.level ? [zoneCount('The Ring', `level ${player.ring.level}${player.ring.bearerId ? `, bearer ${describeId(player.ring.bearerId, state)}` : ''}`)] : []),
      ]),
      el('div', { className: 'actions' }, [
        ...(prompt ? [el('p', { className: 'muted', textContent: prompt })] : []),
        ...general,
      ]),
      // The cards a choice is about (a scry, a search, a revealed hand), to the chooser.
      ...(state.pendingDecision?.playerId === player.id && state.pendingDecision.cards ? [
        el('h3', { textContent: 'Looking at' }),
        cardRow(state.pendingDecision.cards, () => [], 'Nothing', (card) => (state.pendingDecision.selected?.includes(card.id)
          ? [`chosen #${state.pendingDecision.selected.indexOf(card.id) + 1}`] : [])),
      ] : []),
      ...searchSummary(player.id, state),
      el('h3', { textContent: `Emblems (${player.emblems.length})` }),
      emblemRow(player.emblems, cardActions),
      el('h3', { textContent: `Hand (${player.hand.length})` }),
      cardRow(player.hand, cardActions, 'Empty'),
      el('h3', { textContent: `Battlefield (${permanents.length})` }),
      cardRow(permanents, cardActions, 'No permanents', (card) => combatTags(card, state)),
      el('h3', { textContent: `Graveyard (${player.graveyard.length})` }),
      cardRow(player.graveyard, cardActions, 'Empty'),
      ...(player.exile.length ? [
        el('h3', { textContent: `Exile (${player.exile.length})` }),
        cardRow(player.exile, cardActions, 'Empty', (card) => (card.mayPlay ? [`playable by ${card.mayPlay.playerId}`] : [])),
      ] : []),
      // Cards this player may play from elsewhere: an opponent's exile (Shadow of the Enemy), the top of their library (Elven Chorus).
      ...((() => {
        const ids = new Set(actions.filter((a) => a.zone).map((a) => a.cardId));
        const cards = [...state.players.filter((p) => p.id !== player.id).flatMap((p) => p.exile), ...player.library.slice(0, 1)].filter((c) => ids.has(c.id));
        return cards.length ? [el('h3', { textContent: 'Playable from elsewhere' }), cardRow(cards, cardActions, 'None')] : [];
      })()),
    ]);
  }));
}

/** The search AI's latest candidates and their average scores. */
function searchSummary(playerId, state) {
  const info = thinking.get(playerId);
  if (!info?.candidates?.length) return [];
  return [
    el('h3', { textContent: `Search (${info.iterations} simulations)` }),
    el('ol', { className: 'search-candidates' }, info.candidates.map(({ macro, average, visits }) => el('li', {
      textContent: `${describeMacro(macro, state)}: ${Number.isFinite(average) ? average.toFixed(1) : '—'} (${visits})`,
    }))),
  ];
}

function describeMacro(macro, state) {
  const name = (id) => describeId(id, state);
  const target = macro.targetId ? ` → ${name(macro.targetId)}` : '';
  switch (macro.kind) {
    case 'pass': return 'Pass';
    case 'land': return `Play ${macro.cardId}`;
    case 'cast': return `Cast ${name(macro.cardId)}${target}`;
    case 'activate': return `${name(macro.cardId)}: ${macro.abilityId}${target}`;
    case 'attack': return macro.attackers.length ? `Attack with ${macro.attackers.map(name).join(', ')}` : 'No attack';
    case 'block': {
      const blocks = Object.entries(macro.blocks);
      return blocks.length ? `Block: ${blocks.map(([b, a]) => `${name(b)} → ${name(a)}`).join(', ')}` : 'No blocks';
    }
    default: return actionLabel(macro.action, null, state);
  }
}

function decisionPrompt(decision) {
  switch (decision.type) {
    case DECISION.DISCARD_TO_HAND_SIZE:
      return `Hand size limit: discard ${decision.count} card${decision.count === 1 ? '' : 's'}.`;
    case DECISION.DECLARE_ATTACKERS:
      return 'Declare attackers: choose creatures, then confirm.';
    case DECISION.DECLARE_BLOCKERS: {
      const menace = latestState.combat.attackers
        .some(({ cardId }) => hasKeyword(latestState.battlefield.find((p) => p.id === cardId), KEYWORD.MENACE));
      return `Declare blockers: choose a blocker for each attacker, then confirm.${
        menace ? ' A creature with menace needs two or more blockers, or none.' : ''}`;
    }
    case DECISION.CHOOSE_TARGETS:
      return `${decision.sourceName}: choose a target for "${decision.text}"`;
    case DECISION.ASSIGN_COMBAT_DAMAGE:
      return `Divide ${decision.attackerId}'s ${decision.power} damage among its blockers.`;
    case DECISION.CHOOSE_MODE:
      return `${decision.sourceName}: choose one.`;
    case DECISION.CHOOSE:
      return `${decision.sourceName ?? 'Choose'}: ${CHOICE_PROMPTS[decision.kind] ?? decision.kind}`;
    case DECISION.CHOOSE_MANY:
      return `${decision.sourceName ?? 'Choose'}: ${CHOICE_PROMPTS[decision.kind] ?? decision.kind} (${decision.min}–${decision.max}), then confirm.`;
    default:
      return decision.type;
  }
}

const CHOICE_PROMPTS = {
  [CHOICE.RING_BEARER]: 'the Ring tempts you: choose your Ring-bearer.',
  [CHOICE.ARMY]: 'choose the Army to amass onto.',
  [CHOICE.SACRIFICE]: 'choose a permanent to sacrifice.',
  [CHOICE.DISCARD]: 'choose a card to discard.',
  [CHOICE.REVEALED_CARD]: 'choose a card from the revealed hand for its owner to discard.',
  [CHOICE.SEARCH]: 'choose the cards to take from your library',
  [CHOICE.BOTTOM_FROM_HAND]: 'choose a card to put on the bottom of your library.',
  [CHOICE.KEYWORD]: 'choose the ability to grant.',
  [CHOICE.MAY]: 'do it?',
  [CHOICE.OPTIONAL_COST]: 'pay the optional cost?',
  [CHOICE.PAY]: 'pay, or else?',
  [CHOICE.CREATURE_TYPE]: 'note a creature type.',
  [CHOICE.GRAVEYARD_CARD]: 'choose a card from your graveyard.',
  [CHOICE.HAND_CARD]: 'choose a card from your hand.',
  [CHOICE.SCRY]: 'choose the cards to keep on top, in order (the rest go to the bottom)',
  [CHOICE.GRAVEYARD_CARDS]: 'choose cards from your graveyard',
  [CHOICE.LOOK]: 'choose cards to take (the rest go to the bottom in a random order)',
  [CHOICE.EXILE_FROM_HAND]: 'choose cards to exile from your hand',
  [CHOICE.KEEP]: 'choose creatures to keep (the rest are destroyed)',
  [CHOICE.HAND_CARDS]: 'choose creature cards to put onto the battlefield',
  [CHOICE.EXILE_COST]: 'choose cards to exile from your graveyard (a cost)',
  [CHOICE.COUNTER]: 'choose a kind of counter.',
  [CHOICE.COUNTERS]: 'choose counters to move',
  [CHOICE.SACRIFICE_ANY]: 'choose permanents to sacrifice',
  [CHOICE.CARD_TYPE]: 'choose a card type to gain protection from.',
  [CHOICE.CAST_FREE]: 'cast a spell without paying its mana cost?',
  [CHOICE.CAST_FREE_VARIANT]: 'choose how to cast it.',
};

/** A pool, with mana that can be any color (or only some spells') after it. */
function manaText(player) {
  const any = (player.specialMana ?? []).map((m) => `${m.amount} any${m.restriction ? ` (${m.restriction} only)` : ''}`);
  return [manaPoolTotal(player.manaPool) ? formatMana(player.manaPool) : '', ...any].filter(Boolean).join(' + ');
}

/** Combat labels for a permanent, including choices still being made. */
function combatTags(card, state) {
  const tags = [];
  const decision = state.pendingDecision;
  const attacking = state.combat.attackers.find((a) => a.cardId === card.id);
  const blocking = state.combat.attackers.find((a) => a.blockerIds.includes(card.id));
  if (attacking) tags.push(attacking.blocked ? 'attacking (blocked)' : 'attacking');
  if (blocking) tags.push(`blocking ${blocking.cardId}`);
  if (decision?.type === DECISION.DECLARE_ATTACKERS && decision.attackers.includes(card.id)) tags.push('will attack');
  if (decision?.type === DECISION.DECLARE_BLOCKERS && decision.blocks[card.id]) tags.push(`will block ${decision.blocks[card.id]}`);
  // Attachments: what this is attached to, and what's attached to it.
  const nameOf = (id) => state.battlefield.find((p) => p.id === id)?.name ?? id;
  if (card.attachedTo) tags.push(`attached to ${nameOf(card.attachedTo)} (${card.attachedTo})`);
  for (const attachment of state.battlefield.filter((p) => p.attachedTo === card.id)) {
    tags.push(`${isAura(attachment) ? 'enchanted by' : 'equipped with'} ${attachment.name}`);
  }
  const signed = (n) => (n < 0 ? `${n}` : `+${n}`);
  for (const effect of state.temporaryEffects.filter((e) => e.targetId === card.id)) {
    const keywords = effect.keywords.length ? ` ${effect.keywords.join(', ')}` : '';
    tags.push(`${signed(effect.power)}/${signed(effect.toughness)}${keywords} until end of turn`);
  }
  for (const [counter, n] of Object.entries(card.counters ?? {})) tags.push(`${n} ${counter} counter${n === 1 ? '' : 's'}`);
  if (card.token) tags.push('token');
  // Collapse repeats, e.g. the same pump activated several times.
  const counts = new Map();
  for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, n]) => (n > 1 ? `${tag} ×${n}` : tag));
}

function cardRow(cards, actionsFor, emptyText, tagsFor = () => []) {
  if (cards.length === 0) return el('p', { className: 'muted cards-empty', textContent: emptyText });
  return el('ul', { className: 'cards' }, cards.map((card) => {
    const buttons = actionsFor(card);
    const details = [];
    if (card.manaCost) details.push(formatMana(card.manaCost));
    if (isCreature(card)) {
      const changed = card.base && (card.base.power !== card.power || card.base.toughness !== card.toughness);
      details.push(`${card.power}/${card.toughness}${changed ? ` (base ${card.base.power}/${card.base.toughness})` : ''}`);
    }
    const rulesText = card.text || (card.abilities ?? []).map((a) => a.text).join('\n');
    const textLines = rulesText ? [el('span', { className: 'card-text', textContent: rulesText })] : [];
    const keywords = card.keywords?.length ? [el('span', { className: 'card-keywords', textContent: card.keywords.join(', ') })] : [];
    const status = [];
    if (card.damage) status.push(`${card.damage} damage`);
    if (isCreature(card) && card.summoningSick && 'controllerId' in card) status.push('summoning sick');
    status.push(...tagsFor(card));
    return el('li', {
      className: `card${card.tapped ? ' tapped' : ''}${buttons.length ? ' playable' : ''}${isCreature(card) ? ' creature' : ''}`,
      title: `${card.name} (${card.id})${card.tapped ? ' · tapped' : ''}`,
    }, [
      el('span', { className: 'card-name', textContent: card.name }),
      el('span', { className: 'card-id', textContent: [card.id, ...details].join(' · ') }),
      ...keywords,
      ...textLines,
      ...status.map((text) => el('span', { className: 'card-status', textContent: text })),
      ...buttons,
    ]);
  }));
}

function emblemRow(emblems, actionsFor) {
  if (emblems.length === 0) return el('p', { className: 'muted cards-empty', textContent: 'None' });
  return el('ul', { className: 'cards' }, emblems.map((emblem) => {
    const buttons = actionsFor(emblem);
    const left = emblem.activationsPerTurn - emblem.activationsThisTurn;
    return el('li', { className: `card emblem${buttons.length ? ' playable' : ''}`, title: `${emblem.name} (${emblem.id})` }, [
      el('span', { className: 'card-name', textContent: emblem.name }),
      el('span', { className: 'card-id', textContent: `${emblem.id} · emblem` }),
      ...emblem.abilities.map((a) => el('span', {
        className: 'card-keywords',
        textContent: `${a.text}${a.timing === 'sorcery' ? ' (sorcery speed)' : ''}`,
      })),
      el('span', { className: 'card-status', textContent: left > 0 ? `${left} activation${left === 1 ? '' : 's'} left this turn` : 'used this turn' }),
      ...buttons,
    ]);
  }));
}

function renderCombat(state) {
  const { attackers } = state.combat;
  if (attackers.length === 0) {
    ui.combat.replaceChildren(el('p', { className: 'muted', textContent: 'No creatures are attacking.' }));
    return;
  }
  const name = (id) => state.battlefield.find((p) => p.id === id)?.name ?? id;
  ui.combat.replaceChildren(el('ul', { className: 'stack-list' }, attackers.map((a) => el('li', { className: 'stack-object' }, [
    el('strong', { textContent: `${name(a.cardId)} (${a.cardId})` }),
    el('span', { textContent: `→ ${playerName(a.defendingPlayerId)}` }),
    el('span', {
      className: 'muted',
      textContent: a.blocked
        ? `blocked by ${a.blockerIds.map((id) => `${name(id)} (${id})`).join(', ') || 'nothing left'}`
        : 'unblocked',
    }),
  ]))));
}

function badge(text, kind) {
  return el('span', { className: `badge ${kind}`, textContent: text });
}

function renderStack(state) {
  if (state.stack.length === 0) {
    ui.stack.replaceChildren(el('p', { className: 'muted', textContent: 'The stack is empty.' }));
    return;
  }
  // Last element is the top of the stack; show it first.
  ui.stack.replaceChildren(el('ol', { className: 'stack-list' }, [...state.stack].reverse().map((object, i) => (
    el('li', { className: 'stack-object' }, [
      el('span', { className: 'badge priority', textContent: i === 0 ? 'Top' : `#${state.stack.length - i}` }),
      el('strong', { textContent: object.sourceName }),
      el('span', { textContent: object.text }),
      el('span', { className: 'muted', textContent: `${playerName(object.controllerId)} · ${object.id}` }),
    ])
  ))));
}

/** A permanent, card in hand, player or spell on the stack, by id. */
function describeId(id, state) {
  const card = state.battlefield.find((p) => p.id === id)
    ?? state.players.flatMap((p) => [...p.hand, ...p.graveyard]).find((c) => c.id === id)
    ?? state.pendingDecision?.cards?.find((c) => c.id === id);
  if (card) return `${card.name} (${id})`;
  const spell = state.stack.find((s) => s.id === id);
  if (spell) return `${spell.sourceName} (${id}, on the stack)`;
  return state.players.some((p) => p.id === id) ? playerName(id) : id;
}

function targetLabel(action, state) {
  const parts = [];
  if (action.targets?.length) parts.push(` → ${action.targets.map((id) => (id ? describeId(id, state) : 'none')).join(', ')}`);
  const { sacrifice, discard, tap, alternative } = action.costChoices ?? {};
  if (alternative !== undefined) parts.push(` (paying the ${alternative === 0 ? 'first' : 'second'} additional cost)`);
  if (tap) parts.push(`, tapping ${tap.map((id) => describeId(id, state)).join(', ')}`);
  if (sacrifice) parts.push(`, sacrificing ${sacrifice.map((id) => describeId(id, state)).join(', ')}`);
  if (discard) parts.push(`, discarding ${discard.map((id) => describeId(id, state)).join(', ')}`);
  if (action.manaColor) parts.push(` → {${action.manaColor}}`);
  return parts.join('');
}

const capitalizeWord = (text) => text[0].toUpperCase() + text.slice(1);

/** A cost as text, for "you may pay" choices. */
function describeCost(cost) {
  const parts = [];
  if (cost.mana) parts.push(formatMana(cost.mana));
  if (cost.life) parts.push(`${cost.life} life`);
  if (cost.sacrifice) parts.push('sacrifice');
  return parts.join(', ');
}

function actionLabel(action, card, state) {
  switch (action.type) {
    case ACTION.PASS_PRIORITY: return 'Pass priority';
    case ACTION.PLAY_LAND: return action.zone ? `Play from ${action.zone}` : 'Play';
    case ACTION.CAST_SPELL: {
      const modes = [action.mode].flat().filter((m) => m !== undefined);
      const mode = modes.length ? ` (mode ${modes.map((m) => `${m + 1}: ${card?.spell?.modes?.[m]?.text ?? ''}`).join(' and ')})` : '';
      const x = action.x !== undefined ? ` with X=${action.x}` : '';
      const from = action.zone ? ` from ${action.zone}` : '';
      return `Cast${from} ${formatMana(card?.manaCost)}${x}${mode}${targetLabel(action, state)}`;
    }
    case ACTION.CHOOSE:
      if (state.pendingDecision.kind === CHOICE.CAST_FREE_VARIANT) {
        const variant = state.pendingDecision.variants[Number(action.choice)];
        return `Cast it${targetLabel(variant, state)}`;
      }
      if (state.pendingDecision.kind === CHOICE.PAY && String(action.choice).includes(':')) {
        return `Sacrifice ${String(action.choice).split(':')[1].split(',').map((id) => describeId(id, state)).join(', ')}`;
      }
      return typeof action.choice === 'string' && /^\d+(:|$)/.test(action.choice)
        ? `Pay: ${state.pendingDecision.costs?.[Number(action.choice.split(':')[0])] ? describeCost(state.pendingDecision.costs[Number(action.choice.split(':')[0])]) : action.choice}${action.choice.includes(':') ? ` (${action.choice.split(':')[1].split(',').map((id) => describeId(id, state)).join(', ')})` : ''}`
        : capitalizeWord(describeId(action.choice, state));
    case ACTION.TOGGLE_CHOICE:
      return `${state.pendingDecision.selected.includes(action.choice) ? 'Unchoose' : 'Choose'} ${describeId(action.choice, state)}`;
    case ACTION.CONFIRM_CHOICE: return `Confirm (${state.pendingDecision.selected.length} chosen)`;
    case ACTION.CHOOSE_MODE: return `Mode ${action.mode + 1}: ${state.pendingDecision.modes[action.mode].text}${targetLabel(action, state)}`;
    case ACTION.KEEP_LEGEND: return 'Keep this one';
    case ACTION.TOGGLE_ATTACKER:
      return state.pendingDecision.attackers.includes(action.cardId) ? 'Cancel attack' : 'Attack';
    case ACTION.CONFIRM_ATTACKERS: return `Confirm attackers (${state.pendingDecision.attackers.length})`;
    case ACTION.SET_BLOCKER: return action.attackerId ? `Block ${action.attackerId}` : 'Don\'t block';
    case ACTION.CONFIRM_BLOCKERS: return `Confirm blockers (${Object.keys(state.pendingDecision.blocks).length})`;
    case ACTION.ASSIGN_COMBAT_DAMAGE:
      return Object.entries(action.assignment)
        .map(([id, n]) => `${n} to ${PLAYERS.some((p) => p.id === id) ? playerName(id) : id}`).join(', ');
    case ACTION.ACTIVATE_ABILITY: {
      const ability = [...(card?.abilities ?? []), ...(card?.handAbilities ?? []), ...(card?.graveyardAbilities ?? [])].find((a) => a.id === action.abilityId);
      const x = action.x !== undefined ? ` with X=${action.x}` : '';
      return `${ability?.text ?? action.abilityId}${x}${targetLabel(action, state)}`;
    }
    case ACTION.DISCARD: return 'Discard';
    case ACTION.CHOOSE_TARGETS: return `Target${targetLabel(action, state)}`;
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
    case 'spellCast': return `${who(p.playerId)} cast ${p.cardName} (${p.cardId}) → stack`;
    case 'permanentEntered': return `${p.card.name} (${p.card.id}) entered under ${who(p.playerId)}'s control`;
    case 'attackersDeclared': return p.attackers.length ? `${who(p.playerId)} attacked with ${p.attackers.join(', ')}` : `${who(p.playerId)} didn't attack`;
    case 'blockersDeclared': return p.blocks.length ? p.blocks.map((b) => `${b.blockerId} blocks ${b.attackerId}`).join(', ') : `${who(p.playerId)} didn't block`;
    case 'combatDamageDealt': return (Object.keys(p.lifeGained ?? {}).length
      ? `${Object.entries(p.lifeGained).map(([id, n]) => `${who(id)} gained ${n}`).join(', ')}; ` : '') + p.damage.map((d) => `${d.sourceId} → ${d.targetPlayerId ? who(d.targetPlayerId) : d.targetCardId}: ${d.amount}`).join(', ') || 'no damage';
    case 'lifeGained': return `${who(p.playerId)} gained ${p.amount} (life ${p.life})`;
    case 'attached': return `${p.cardName} (${p.cardId}) attached to ${p.attachedTo}`;
    case 'unattached': return `${p.cardName} (${p.cardId}) unattached from ${p.from}`;
    case 'permanentToGraveyard': return `${p.cardName} (${p.cardId}) went to the graveyard (${p.reason})`;
    case 'abilityTriggered': return `${p.sourceName} (${p.sourceId}) triggered: ${p.text}`;
    case 'triggeredAbilityPutOnStack': return `${p.sourceId}'s ability → stack (${p.stackObjectId})${p.targets.length ? ` targeting ${p.targets.join(', ')}` : ''}`;
    case 'triggeredAbilityRemoved': return `${p.sourceId}'s ability was removed: ${p.reason}`;
    case 'stackObjectFizzled': return `${p.stackObjectId}: ${p.reason}`;
    case 'damageDealt': return `${p.sourceId} → ${p.targetPlayerId ? who(p.targetPlayerId) : p.targetCardId}: ${p.amount}`;
    case 'permanentDestroyed': return `${p.cardName} (${p.cardId}) destroyed by ${p.sourceId}`;
    case 'permanentExiled': return `${p.cardName} (${p.cardId}) exiled by ${p.sourceId}`;
    case 'permanentReturnedToHand': return `${p.cardName} (${p.cardId}) returned to ${who(p.ownerId)}'s hand`;
    case 'permanentSacrificed': return `${who(p.controllerId)} sacrificed ${p.cardName} (${p.cardId})`;
    case 'permanentTapped': return `${p.cardId} tapped by ${p.sourceId}`;
    case 'permanentUntapped': return `${p.cardId} untapped by ${p.sourceId}`;
    case 'countersAdded': return `${p.cardId} got ${p.count} ${p.counter} counter${p.count === 1 ? '' : 's'}`;
    case 'spellCountered': return `${p.cardName} (${p.stackObjectId}) countered by ${p.sourceId}`;
    case 'lifeLost': return `${who(p.playerId)} lost ${p.amount} (life ${p.life})`;
    case 'cardsMilled': return `${who(p.playerId)} milled ${p.cardIds.length} (${p.librarySize} left in library)`;
    case 'tokenCreated': return `${who(p.playerId)} created ${p.card.name} (${p.card.id})`;
    case 'temporaryEffectCreated': return `${p.targetId} gets ${p.power < 0 ? p.power : `+${p.power}`}/${p.toughness < 0 ? p.toughness : `+${p.toughness}`}${p.keywords.length ? ` and ${p.keywords.join(', ')}` : ''} until end of turn`;
    case 'temporaryEffectsEnded': return `${p.effectIds.length} "until end of turn" effect(s) ended`;
    case 'creatureDied': return `${p.cardName} (${p.cardId}) died`;
    case 'abilityActivated': return `${who(p.playerId)}: ${p.cardName} ${p.text}${p.usesStack ? ' → stack' : ''}`;
    case 'manaAdded': return `${who(p.playerId)} added ${formatMana(p.mana)} (pool ${formatMana(p.manaPool)})`;
    case 'manaPoolsEmptied': return p.pools.map((x) => `${who(x.playerId)} lost ${formatMana(x.lost)}`).join(', ');
    case 'stackObjectResolving': return `${p.stackObject.sourceName}: ${p.stackObject.text}`;
    case 'stackObjectResolved': return p.stackObjectId;
    case 'decisionRequired': return `${who(p.playerId)}: ${p.type}`;
    case 'cardDiscarded': return `${who(p.playerId)} discarded ${p.cardId}`;
    case 'permanentsUntapped': return `${who(p.playerId)} untapped ${p.cardIds.length}`;
    case 'playerLost': return `${who(p.playerId)}: ${p.reason}`;
    case 'gameEnded': return p.winnerId ? `${who(p.winnerId)} won` : 'draw';
    case 'actionAccepted': {
      const { type, cardId, abilityId, playerId } = p.action;
      return `${type}${cardId ? ` ${cardId}` : ''}${abilityId ? `:${abilityId}` : ''} by ${who(playerId)}`;
    }
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
