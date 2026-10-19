import { GAME_STATUS } from '../engine/Game.js';

/** The player the game is waiting on: the one making a decision, or the one with priority. */
export const actingPlayerId = (state) => state.pendingDecision?.playerId ?? state.priorityPlayerId;

/**
 * Plays a (usually silent) game forward with a policy per player until it ends,
 * `until(state)` says to stop, or `maxSteps` actions have been taken. Policies are
 * `(state) => action` functions over peekState() snapshots, such as
 * `(state) => basicAI.chooseAction(state)`; when one returns nothing, the player's
 * first valid action is taken. Returns the final peekState().
 */
export function playout(game, policies, { until = () => false, maxSteps = 20000 } = {}) {
  for (let step = 0; step < maxSteps; step++) {
    const state = game.peekState();
    if (state.status !== GAME_STATUS.IN_PROGRESS || until(state)) return state;
    const playerId = actingPlayerId(state);
    const action = policies[playerId](state) ?? state.validActions.find((a) => a.playerId === playerId);
    game.applyTrusted(action);
  }
  return game.peekState();
}
