/** Words for things on the battlefield: names, choices, phases and prompts. */
import { DECISION, CHOICE, OPENING_HAND_SIZE } from '../../src/engine/Game.js';
import { PHASE } from '../../src/engine/turnStructure.js';
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

/** Choices made by tapping a permanent on the board. */
export const BOARD_CHOICES = new Set([CHOICE.RING_BEARER, CHOICE.ARMY, CHOICE.SACRIFICE]);
/** Choices made by tapping a card in your hand. */
export const HAND_CHOICES = new Set([CHOICE.DISCARD, CHOICE.BOTTOM_FROM_HAND]);

const capitalize = (text) => text[0].toUpperCase() + text.slice(1);

/** A cost as words, for "you may pay" choices: "Sacrifice a Food", "Pay {2}{W}", "Pay 2 life". */
function costWords(state, cost, ids, me) {
  const parts = [];
  if (ids.length) parts.push(`Sacrifice ${ids.map((id) => nameOf(state, id, me)).join(', ')}`);
  if (cost?.mana) parts.push(`Pay ${formatMana(cost.mana)}`);
  if (cost?.life) parts.push(`Pay ${cost.life} life`);
  return parts.join(', ') || 'Pay';
}

/** What one option of a DECISION.CHOOSE reads as. */
export function choiceLabel(state, decision, choice, me) {
  if (choice === 'decline') return decision.kind === CHOICE.OPTIONAL_COST ? 'Don\'t pay' : 'Don\'t';
  switch (decision.kind) {
    case CHOICE.MAY: return choice === 'yes' ? 'Yes' : 'No';
    case CHOICE.PAY: return choice === 'pay' ? costWords(state, decision.cost, [], me) : decision.counterId ? 'Don\'t pay (it\'s countered)' : 'Don\'t pay';
    case CHOICE.OPTIONAL_COST: {
      const [index, ids] = String(choice).split(':');
      return costWords(state, decision.costs[Number(index)], ids ? ids.split(',') : [], me);
    }
    case CHOICE.KEYWORD: return capitalize(choice);
    case CHOICE.CREATURE_TYPE: return choice;
    default: {
      const card = decision.cards?.find((c) => c.id === choice) ?? findCard(state, choice);
      return card?.name ?? String(choice);
    }
  }
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
      case DECISION.CHOOSE_TARGETS:
        return `${decision.optional ? 'You may choose' : 'Choose'} a target: ${decision.sourceName}`;
      case DECISION.CHOOSE_MODE: return `Choose one: ${decision.sourceName}`;
      case DECISION.LEGEND_RULE: return `Keep one ${decision.name}`;
      case DECISION.MULLIGAN: return 'Keep this hand?';
      case DECISION.PUT_ON_BOTTOM: return `Tap ${decision.count} card${decision.count > 1 ? 's' : ''} to put on the bottom`;
      case DECISION.CHOOSE: return choosePrompt(decision);
      case DECISION.CHOOSE_MANY:
        switch (decision.kind) {
          case CHOICE.SCRY: return `Scry ${decision.options.length}: tap the cards to keep on top, in order`;
          case CHOICE.SEARCH: return `Search your library: choose up to ${decision.max}`;
          default: return 'Choose any number of cards';
        }
      default: return '';
    }
  }
  if (decision?.type === DECISION.MULLIGAN || decision?.type === DECISION.PUT_ON_BOTTOM) {
    return decision.mulligans ? `Opponent mulligans to ${OPENING_HAND_SIZE - decision.mulligans}…` : 'Opponent is looking at their hand…';
  }
  if (decision) return decision.type === DECISION.DECLARE_BLOCKERS ? 'Opponent is blocking…' : 'Opponent is deciding…';
  // Only once the opponent has actually declared attackers (combat.attackers).
  const attackers = state.combat?.attackers ?? [];
  if (state.activePlayerId !== me && state.phase === PHASE.COMBAT && attackers.length) {
    return `${attackers.length} attacking`;
  }
  return '';
}

export const manaText = (mana) => formatMana(mana);

/** The prompt for a choice made while something resolves (DECISION.CHOOSE). */
function choosePrompt(decision) {
  const from = decision.sourceName ? `: ${decision.sourceName}` : '';
  switch (decision.kind) {
    case CHOICE.RING_BEARER: return 'The Ring tempts you: choose your Ring-bearer';
    case CHOICE.ARMY: return `Choose the Army to amass onto${from}`;
    case CHOICE.SACRIFICE: return `Choose a permanent to sacrifice${from}`;
    case CHOICE.DISCARD: return `Tap a card to discard${from}`;
    case CHOICE.BOTTOM_FROM_HAND: return `Tap a card to put on the bottom${from}`;
    case CHOICE.REVEALED_CARD: return 'Choose a card for them to discard';
    case CHOICE.KEYWORD: return `Choose the ability it gains${from}`;
    case CHOICE.MAY: return decision.text ?? `Do it?${from}`;
    case CHOICE.OPTIONAL_COST: return `Pay the cost?${from}`;
    case CHOICE.PAY: return decision.counterId ? `Pay for ward, or your spell is countered${from}` : `Pay, or else${from}`;
    case CHOICE.CREATURE_TYPE: return `Note a creature type${from}`;
    case CHOICE.GRAVEYARD_CARD: return `Choose a card from your graveyard${from}`;
    case CHOICE.HAND_CARD: return `Choose a card from your hand${from}`;
    default: return `Choose${from}`;
  }
}
