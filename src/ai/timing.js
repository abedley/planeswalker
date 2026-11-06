/**
 * When the AIs act at instant speed. Instants and permanents with flash wait for the last moment
 * they're needed, never the AI's own main phase:
 * - removal on the opponent's creatures, and "can't block" effects: at the start of the AI's combat
 *   (clearing the way), or on attackers once the opponent attacks, or on combatants after blocks;
 * - combat tricks: after blockers are declared;
 * - creatures with flash: as surprise blockers when the opponent attacks, otherwise at the end of the
 *   opponent's turn, like the other instants (card draw, life gain, ...);
 * - counterspells: in response to the opponent's spell.
 * A spell that wins on the spot (burn for the opponent's last life points) is cast at any time.
 * The basic AI follows this (BasicAIController), and the search AI only considers instant-speed
 * casts that fit it (macroActions.js).
 */
import { STEP, PHASE } from '../engine/turnStructure.js';
import {
  isCreature, isHarmfulEffect, flattenEffects, EFFECT, KEYWORD, castsAtInstantSpeed,
} from '../cards/cards.js';

/** Moments when the AI considers acting (anything else it passes). */
export const WINDOW = Object.freeze({
  /** Its own main phase with an empty stack: lands, creatures, sorceries, abilities. */
  MAIN: 'main',
  /** Its own beginning of combat: removal and "can't block" on the opponent's creatures. */
  BEGIN_COMBAT: 'beginCombat',
  /** After blockers are declared, in anyone's combat: tricks and removal on combatants. */
  COMBAT: 'combat',
  /** The opponent has attacked: removal on attackers, flash blockers. */
  ATTACKED: 'attacked',
  /** The opponent's spell is on top of the stack: counterspells. */
  RESPONSE: 'response',
  /** The opponent's end step: instants held up for this. */
  END: 'end',
});

/** The window `me` is in, or null when the AI just passes. */
export function windowOf(state, me) {
  const myTurn = state.activePlayerId === me;
  const top = state.stack[state.stack.length - 1];
  if (top) return top.kind === 'spell' && top.controllerId !== me ? WINDOW.RESPONSE : null;
  if (myTurn && (state.phase === PHASE.PRECOMBAT_MAIN || state.phase === PHASE.POSTCOMBAT_MAIN)) return WINDOW.MAIN;
  if (myTurn && state.step === STEP.BEGINNING_OF_COMBAT) return WINDOW.BEGIN_COMBAT;
  if (state.step === STEP.DECLARE_BLOCKERS) return WINDOW.COMBAT;
  if (!myTurn && state.step === STEP.DECLARE_ATTACKERS) return state.combat.attackers.length ? WINDOW.ATTACKED : null;
  if (!myTurn && state.step === STEP.END) return WINDOW.END;
  return null;
}

/** Whether `id` is an opponent of `me`, or a permanent one controls. */
export const isTheirs = (state, me, id) => state.battlefield.some((p) => p.id === id && p.controllerId !== me)
  || (state.players.some((p) => p.id === id) && id !== me);

/** Whether these effects, aimed at `targetId`, win the game now: damage to an opponent at least their life. */
export function winsNow(given, targetId, state, me) {
  const player = state.players.find((p) => p.id === targetId && p.id !== me);
  if (!player) return false;
  const damage = flattenEffects(given).filter((e) => e.type === EFFECT.DEAL_DAMAGE && typeof e.amount === 'number')
    .reduce((sum, e) => sum + e.amount, 0);
  return damage >= player.life;
}

/**
 * Whether these effects (of a spell, or an ability with `instantSpeed`) are worth using in this
 * window, rather than waiting for a better one.
 */
export function windowAllows(window, given, instantSpeed, targetId, state, me) {
  const effects = flattenEffects(given);
  const counters = effects.some((e) => e.type === EFFECT.COUNTER_SPELL);
  if (window === WINDOW.RESPONSE) return counters;
  if (counters) return false;
  if (winsNow(effects, targetId, state, me)) return true;
  const harmful = effects.some(isHarmfulEffect);
  const trick = effects.some((e) => e.type === EFFECT.PUMP && (e.power ?? 0) + (e.toughness ?? 0) > 0);
  const onCreature = targetId && state.battlefield.some((p) => p.id === targetId && isCreature(p));
  const onTheirCreature = onCreature && isTheirs(state, me, targetId);
  // Blocking restrictions only matter if they're in place before blockers are declared.
  const restricts = effects.some((e) => e.type === EFFECT.PUMP
    && (e.keywords ?? []).some((k) => k === KEYWORD.CANT_BLOCK || k === KEYWORD.CANT_BE_BLOCKED));
  switch (window) {
    case WINDOW.MAIN:
      // Sorcery-speed things now; instant-speed ones wait for when they're needed.
      return !instantSpeed;
    case WINDOW.BEGIN_COMBAT:
      // Clearing the way for the attack: removal on their creatures, blocking restrictions.
      return restricts || (harmful && onTheirCreature);
    case WINDOW.COMBAT:
      return trick || (harmful && onCreature);
    case WINDOW.ATTACKED:
      return harmful && onCreature && state.combat.attackers.some((a) => a.cardId === targetId);
    case WINDOW.END:
      // The last moment before our turn: anything but tricks, and removal on their creatures (which
      // waits for our attack or theirs).
      return !trick && !(harmful && onTheirCreature);
    default:
      return false;
  }
}

/**
 * When a permanent spell with flash is worth casting: as a blocker once the opponent attacks (a
 * creature), or at the end of the opponent's turn. Sorcery-speed permanents only in the main phase.
 */
export function permanentWindowAllows(window, card) {
  if (!castsAtInstantSpeed(card)) return window === WINDOW.MAIN;
  if (window === WINDOW.ATTACKED) return isCreature(card);
  return window === WINDOW.END;
}
