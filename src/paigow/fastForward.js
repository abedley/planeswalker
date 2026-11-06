/**
 * Pai Gow's fast forward: once a player has nothing left to do, the round's result depends only on
 * the other player, so it can be played out at once, with good play from the side that still has
 * actions.
 */
import { GAME_STATUS } from '../engine/Game.js';
import { isCreature } from '../cards/cards.js';
import { BasicAIController } from '../ai/BasicAIController.js';
import { actingPlayerId } from '../ai/simulate.js';

const usable = (abilities) => (abilities ?? []).some((ability) => !ability.isManaAbility);

/**
 * Whether `playerId` has nothing left to do: no cards in hand, no creatures (to attack or block
 * with), no activated abilities but mana abilities (useless with infinite mana) on their permanents,
 * emblems or graveyard cards, and no exiled cards they may cast. `state`: getState() or peekState().
 */
export function outOfActions(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || (player.hand?.length ?? player.handSize ?? 0) > 0) return false;
  const mine = state.battlefield.filter((p) => p.controllerId === playerId);
  if (mine.some(isCreature) || mine.some((p) => usable(p.abilities))) return false;
  if ((player.emblems ?? []).some((e) => usable(e.abilities))) return false;
  if ((player.graveyard ?? []).some((c) => usable(c.graveyardAbilities))) return false;
  return !state.players.some((p) => (p.exile ?? []).some((c) => c.mayPlay?.playerId === playerId));
}

/** Whether the game can be fast-forwarded: it's going on, and a player is out of actions. */
export function canFastForward(state) {
  return state.status === GAME_STATUS.IN_PROGRESS && state.players.some((p) => outOfActions(state, p.id));
}

/** The lines tried for both sides: the basic AI's attack planners, swarming or not. */
const LINES = [
  { attacking: 'lookahead' },
  { attacking: 'basic' },
  { attacking: 'lookahead', swarm: false },
  { attacking: 'basic', swarm: false },
];

/** How good a finished game is for `playerId`: a win, then a draw, then a loss; sooner is better. */
function rank(state, playerId) {
  const result = state.winnerId === playerId ? 2 : state.winnerId === null ? 1 : 0;
  return result * 1000 - state.turn;
}

/**
 * Plays the rest of the game on silent copies, once per line in LINES, and picks the one that's best
 * for the side with actions (for a player out of actions, the lines play the same). Returns
 * `{ actions, winnerId, endReason, turns }`: replaying `actions` on `game` (with applyTrusted)
 * reaches the same end, since copies keep the random number generator's state.
 */
export function planFastForward(game, { maxSteps = 20000 } = {}) {
  const start = game.peekState();
  const ids = start.players.map((p) => p.id);
  const active = ids.find((id) => !outOfActions(start, id)) ?? ids[0];
  let best = null;
  for (const line of LINES) {
    const copy = game.clone();
    const ais = Object.fromEntries(ids.map((id) => [id, new BasicAIController({ game: null, playerId: id, ...line })]));
    const actions = [];
    for (let step = 0; step < maxSteps; step++) {
      const state = copy.peekState();
      if (state.status !== GAME_STATUS.IN_PROGRESS) break;
      const actor = actingPlayerId(state);
      const action = ais[actor].chooseAction(state) ?? state.validActions.find((a) => a.playerId === actor);
      actions.push(action);
      copy.applyTrusted(action);
    }
    const end = copy.peekState();
    if (end.status !== GAME_STATUS.GAME_OVER) continue;
    const plan = { actions, winnerId: end.winnerId, endReason: end.endReason, turns: end.turn, score: rank(end, active) };
    if (!best || plan.score > best.score) best = plan;
  }
  return best;
}
