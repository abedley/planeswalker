/** Words for things on the battlefield: names, choices, phases and prompts. */
import { DECISION } from '../../src/engine/Game.js';
import { PHASE, STEP } from '../../src/engine/turnStructure.js';
import { formatMana } from '../../src/engine/mana.js';


/** Finds a card anywhere in a state (battlefield, hands, graveyards, exile, stack). */
export function findCard(state, id) {
  const permanent = state.battlefield.find((p) => p.id === id);
  if (permanent) return permanent;
  for (const player of state.players) {
    for (const zone of ['hand', 'graveyard', 'exile']) {
      const card = player[zone]?.find((c) => c.id === id);
      if (card) return card;
    }
    const emblem = player.emblems.find((e) => e.id === id);
    if (emblem) return emblem;
  }
  const object = state.stack.find((o) => o.id === id || o.card?.id === id);
  return object?.card ?? object ?? null;
}

export function nameOf(state, id, me) {
  if (id === me) return 'you';
  const player = state.players.find((p) => p.id === id);
  if (player) return player.name;
  const card = findCard(state, id);
  return card?.name ?? card?.sourceName ?? card?.text ?? 'it';
}

/** How a variant of a play differs from the others: what it sacrifices, discards or makes. */
export function variantLabel(state, variant, me) {
  const parts = [];
  const { sacrifice = [], discard = [] } = variant.costChoices ?? {};
  const withStats = (id) => {
    const card = findCard(state, id);
    if (card?.power === undefined) return nameOf(state, id, me);
    const hurt = card.damage ? `, ${card.damage} damage` : '';
    return `${card.name} (${card.power}/${card.toughness}${card.tapped ? ', tapped' : ''}${hurt})`;
  };
  if (sacrifice.length) parts.push(`Sacrifice ${sacrifice.map(withStats).join(', ')}`);
  if (discard.length) parts.push(`Discard ${discard.map((id) => nameOf(state, id, me)).join(', ')}`);
  if (variant.manaColor) parts.push(`Add {${variant.manaColor}}`);
  return parts.join(' · ') || 'Play';
}

/** A combat damage split: "Bear 2 · Wolf 1". */
export function assignmentLabel(state, assignment, me) {
  return Object.entries(assignment).map(([id, n]) => `${nameOf(state, id, me)} ${n}`).join(' · ');
}

/** The steps shown as pips in the middle of the board. */
export const TURN_PIPS = [
  { id: 'begin', label: 'Begin', match: (s) => s.phase === PHASE.BEGINNING },
  { id: 'main1', label: 'Main', match: (s) => s.phase === PHASE.PRECOMBAT_MAIN },
  { id: 'combat', label: 'Combat', match: (s) => s.phase === PHASE.COMBAT },
  { id: 'main2', label: 'Main 2', match: (s) => s.phase === PHASE.POSTCOMBAT_MAIN },
  { id: 'end', label: 'End', match: (s) => s.phase === PHASE.ENDING },
];

/** A short line saying what the game is waiting for. */
export function promptFor(state, me) {
  const decision = state.pendingDecision;
  if (decision?.playerId === me) {
    switch (decision.type) {
      case DECISION.DECLARE_ATTACKERS: return 'Tap creatures to attack';
      case DECISION.DECLARE_BLOCKERS: return 'Tap your creature, then an attacker';
      case DECISION.DISCARD_TO_HAND_SIZE: return `Discard ${decision.count} card${decision.count > 1 ? 's' : ''}`;
      case DECISION.ASSIGN_COMBAT_DAMAGE: return 'Assign combat damage';
      case DECISION.CHOOSE_TARGETS: return `Choose a target: ${decision.sourceName}`;
      default: return '';
    }
  }
  if (decision) return decision.type === DECISION.DECLARE_BLOCKERS ? 'Opponent is blocking…' : 'Opponent is deciding…';
  if (state.step === STEP.DECLARE_ATTACKERS && state.activePlayerId !== me) return 'You are being attacked';
  return '';
}

export const manaText = (mana) => formatMana(mana);
