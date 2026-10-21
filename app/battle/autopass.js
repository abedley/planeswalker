/**
 * When the app passes priority for the player, and what the main button says.
 * Magic gives priority many times a turn; like MTG Arena's "smart stops", the app
 * only stops when the player could sensibly act.
 */
import { DECISION } from '../../src/engine/Game.js';
import { PHASE, STEP } from '../../src/engine/turnStructure.js';
import { ACTION } from '../../src/engine/actions.js';
import { isCreature, hasKeyword } from '../../src/cards/cards.js';

const isMain = (state) => state.phase === PHASE.PRECOMBAT_MAIN || state.phase === PHASE.POSTCOMBAT_MAIN;

/**
 * Whether to pass priority for `me` without asking. `hasOptions`: whether they can
 * do anything but pass (see playOptions). `fullControl`: stop whenever they have
 * priority. `endingTurn`: they pressed "End turn" this turn, so only stop if the
 * opponent does something they could answer.
 */
export function shouldAutoPass(state, me, { hasOptions, fullControl = false, endingTurn = false }) {
  if (state.pendingDecision || state.priorityPlayerId !== me) return false;
  if (fullControl) return false;
  if (!hasOptions) return true;
  const top = state.stack.at(-1);
  // Something of the opponent's on the stack: a chance to respond.
  if (top && top.controllerId !== me) return false;
  const myTurn = state.activePlayerId === me;
  if (myTurn) {
    if (endingTurn) return true;
    return !(isMain(state) && !top);
  }
  // Their turn: stop when they attack, after blocks, and at their end step.
  return !(state.step === STEP.DECLARE_ATTACKERS || state.step === STEP.DECLARE_BLOCKERS || state.step === STEP.END);
}

/** Creatures of `me` that look able to attack (untapped, no defender, not summoning sick). */
export const readyAttackers = (state, me) => state.battlefield.filter((p) => p.controllerId === me && isCreature(p)
  && !p.tapped && !hasKeyword(p, 'defender') && (!p.summoningSick || hasKeyword(p, 'haste')));

/**
 * The main button: `{ label, action?, endTurn?, waiting? }`. `action` is the valid
 * action it takes; `endTurn` means it also starts passing until the turn ends;
 * `waiting` means it's the opponent's move (the button shows a spinner).
 */
export function primaryAction(state, me) {
  const mine = state.validActions.filter((a) => a.playerId === me);
  const find = (type) => mine.find((a) => a.type === type);
  const decision = state.pendingDecision;
  if (decision?.playerId === me) {
    switch (decision.type) {
      case DECISION.DECLARE_ATTACKERS: {
        const n = decision.attackers.length;
        return { label: n ? `Attack (${n})` : 'No attacks', action: find(ACTION.CONFIRM_ATTACKERS) };
      }
      case DECISION.DECLARE_BLOCKERS: {
        const n = Object.keys(decision.blocks).length;
        const action = find(ACTION.CONFIRM_BLOCKERS);
        return { label: n ? `Block (${n})` : 'No blocks', action, ...(action ? {} : { hint: 'Menace needs two blockers' }) };
      }
      case DECISION.DISCARD_TO_HAND_SIZE:
        return { label: `Discard ${decision.count}` };
      default:
        return { label: 'Choose' };
    }
  }
  if (state.status !== 'inProgress') return { label: 'Game over' };
  if (decision || state.priorityPlayerId !== me) return { label: 'Opponent', waiting: true };
  const pass = find(ACTION.PASS_PRIORITY);
  if (state.stack.length) return { label: 'Resolve', action: pass };
  if (state.activePlayerId !== me) return { label: 'Pass', action: pass };
  if (state.phase === PHASE.PRECOMBAT_MAIN && readyAttackers(state, me).length) return { label: 'Attack', action: pass };
  return { label: 'End turn', action: pass, endTurn: true };
}
