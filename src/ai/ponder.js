/**
 * What to think about ahead of time. From a private copy of the game, follow the
 * likeliest line and note the next positions where the AI will have a decision
 * worth searching, so its worker can search them while the opponent is still
 * deciding. If the game then reaches one of them, the search is already done
 * (searches are kept by position, see searchPool.js).
 *
 * The likeliest line:
 * - The opponent passes priority, and confirms the attackers or blocks they've
 *   picked so far (so blocks are ready the moment they confirm their attack).
 *   At any other decision of theirs the line stops.
 * - The AI carries on with the play it's making (`macro`), and otherwise does what
 *   the basic AI would.
 *
 * The copy is the real game, hidden cards included: walking it forward draws the
 * AI's real next card, but a search only ever gets the AI's view of each position,
 * and its result is only used once the AI is really there, knowing what it knows
 * then.
 */
import { GAME_STATUS, DECISION } from '../engine/Game.js';
import { ACTION } from '../engine/actions.js';
import { BasicAIController } from './BasicAIController.js';
import { listMacros, nextAction } from './macroActions.js';
import { worthSearching, defaultMacros } from './search.js';
import { actingPlayerId } from './simulate.js';

/** What the opponent most likely does next, or null if it can't be guessed. */
function likelyMove(state, playerId) {
  const mine = state.validActions.filter((a) => a.playerId === playerId);
  const find = (type) => mine.find((a) => a.type === type) ?? null;
  switch (state.pendingDecision?.type) {
    case undefined: return find(ACTION.PASS_PRIORITY);
    case DECISION.DECLARE_ATTACKERS: return find(ACTION.CONFIRM_ATTACKERS);
    case DECISION.DECLARE_BLOCKERS: return find(ACTION.CONFIRM_BLOCKERS);
    default: return null;
  }
}

const contextOf = (state) => `${state.turn}:${state.segmentIndex}:${state.pendingDecision?.type ?? 'priority'}`;

/**
 * Up to `limit` positions ahead of `game` (which this plays forward: pass a clone)
 * where `me` has a decision worth searching: `[{ view, macros, defaults }]`,
 * nearest first. `macro`: the play `me` is in the middle of, carried on first.
 * `skipCurrent`: don't count the current position (it's being searched already).
 * `attacking`: how `me` attacks (see searchPolicy).
 */
export function ponderTargets(game, me, {
  macro = null, limit = 3, maxSteps = 400, skipCurrent = false, attacking = 'basic',
} = {}) {
  const fallback = new BasicAIController({ game: null, playerId: me, attacking });
  const targets = [];
  let current = macro;
  const context = current ? contextOf(game.peekState()) : null;
  let first = true;
  for (let step = 0; step < maxSteps && targets.length < limit; step++) {
    const state = game.peekState();
    if (state.status !== GAME_STATUS.IN_PROGRESS) break;
    const acting = actingPlayerId(state);
    let action;
    if (acting === me) {
      const next = current && contextOf(state) === context ? nextAction(state, me, current) : null;
      if (next) {
        if (next.done) current = null;
        action = next.action;
      } else {
        current = null;
        if (!(first && skipCurrent) && worthSearching(state, me)) {
          const macros = listMacros(state, me, { attacking });
          if (macros.length > 1) {
            // `state` is the game's own (peekState), so everything is taken from it now.
            const defaults = defaultMacros(state, me, macros, new BasicAIController({ game: null, playerId: me, attacking }));
            targets.push({ view: game.getPlayerView(me), macros, defaults });
          }
        }
        action = fallback.chooseAction(state);
      }
    } else {
      action = likelyMove(state, acting);
    }
    first = false;
    if (!action) break;
    game.applyTrusted(action);
  }
  return targets;
}
