/**
 * A pruned lookahead over decisions, instead of one played-out game per candidate.
 *
 * From a guessed game (see determinize), play on until a key decision:
 * - ours: our main-phase plays, and declaring attackers or blockers;
 * - the opponent's: declaring attackers or blockers (their spells are played by the
 *   basic AI: their hand is only a guess).
 * Everything in between (instants, passes) is played by the basic AI.
 *
 * At a key decision every option is tried, played on to the next key decision, and
 * scored with the evaluation. Only the best `beam` go deeper (beam pruning): ours by
 * our score, the opponent's by how bad they are for us, since they play to beat us.
 * A node is worth its best child (ours) or its worst (theirs). When the depth runs
 * out, the basic AI plays on to the horizon and the result is evaluated.
 */
import { Game, GAME_STATUS, DECISION } from '../engine/Game.js';
import { PHASE } from '../engine/turnStructure.js';
import { BasicAIController } from './BasicAIController.js';
import { listMacros, applyMacro } from './macroActions.js';
import { actingPlayerId } from './simulate.js';

/** Basic-AI policies for both players. */
export function basicPolicies(players) {
  return Object.fromEntries(players.map(({ id }) => {
    const ai = new BasicAIController({ game: null, playerId: id });
    return [id, (state) => ai.chooseAction(state)];
  }));
}

/** Whether `state` is a key decision for its acting player (see above). */
function keyDecision(state, me) {
  const actor = actingPlayerId(state);
  const type = state.pendingDecision?.type;
  if (type === DECISION.DECLARE_ATTACKERS || type === DECISION.DECLARE_BLOCKERS) return true;
  if (actor !== me || state.pendingDecision) return false;
  return state.activePlayerId === me && state.stack.length === 0
    && (state.phase === PHASE.PRECOMBAT_MAIN || state.phase === PHASE.POSTCOMBAT_MAIN);
}

/**
 * Plays `game` on with the basic AI until a key decision with a real choice, the
 * horizon (`until(state)`), or the end. Returns the state reached and its macros.
 */
function advance(game, me, policies, until, maxSteps = 3000) {
  for (let step = 0; step < maxSteps; step++) {
    const state = game.peekState();
    if (state.status !== GAME_STATUS.IN_PROGRESS || until(state)) return { state, macros: [] };
    if (keyDecision(state, me)) {
      const macros = listMacros(state, actingPlayerId(state));
      if (macros.length > 1) return { state, macros };
    }
    const actor = actingPlayerId(state);
    game.applyTrusted(policies[actor](state) ?? state.validActions.find((a) => a.playerId === actor));
  }
  return { state: game.peekState(), macros: [] };
}

/**
 * A predicate: true once the game reaches the start of `me`'s `horizon`-th next
 * turn. By turn number, so every branch of a lookahead can share it.
 */
export function horizonOf(game, me, horizon) {
  const { turn, activePlayerId } = game.peekState();
  // Turns alternate: our next turn is two away if it's ours now, one if it's theirs.
  const target = turn + (activePlayerId === me ? 2 : 1) + 2 * (horizon - 1);
  return (state) => state.turn >= target;
}

const copy = (game) => game.clone();

/**
 * The value for `me` of `game` (silent, not shared: it's played on) by pruned
 * lookahead. `evaluate(state, me)`; `depth`: key decisions to branch at; `beam`:
 * children kept per node; `until`: the horizon.
 */
export function lookahead(game, me, { evaluate, policies, until, depth = 2, beam = 2, counter = { nodes: 0 } }) {
  const { state, macros } = advance(game, me, policies, until);
  if (macros.length === 0 || depth <= 0) {
    // Out of decisions or depth: the basic AI plays on to the horizon.
    return playOutAndEvaluate(game, me, policies, until, evaluate);
  }
  const actor = actingPlayerId(state);
  const ours = actor === me;
  // Every option, scored where it leads (the next key decision), cheaply.
  const children = [];
  for (const macro of macros) {
    const child = copy(game);
    if (!applyMacro(child, actor, macro)) continue;
    counter.nodes += 1;
    const next = advance(child, me, policies, until);
    children.push({ child, score: evaluate(next.state, me) });
  }
  if (children.length === 0) return playOutAndEvaluate(game, me, policies, until, evaluate);
  // Aggressive pruning: only the most promising (for whoever is choosing) go deeper.
  children.sort((a, b) => (ours ? b.score - a.score : a.score - b.score));
  const kept = children.slice(0, beam);
  const values = kept.map(({ child }) => lookahead(child, me, { evaluate, policies, until, depth: depth - 1, beam, counter }));
  return ours ? Math.max(...values) : Math.min(...values);
}

/** Plays on with the basic AI to the horizon and evaluates. */
function playOutAndEvaluate(game, me, policies, until, evaluate) {
  for (let step = 0; step < 5000; step++) {
    const state = game.peekState();
    if (state.status !== GAME_STATUS.IN_PROGRESS || until(state)) return evaluate(state, me);
    const actor = actingPlayerId(state);
    game.applyTrusted(policies[actor](state) ?? state.validActions.find((a) => a.playerId === actor));
  }
  return evaluate(game.peekState(), me);
}

/**
 * One simulation with lookahead: a determinization `snapshot`, `macro` applied by
 * `me`, then pruned lookahead to the horizon. Null if the macro can't be carried out.
 */
export function simulateLookahead(snapshot, me, macro, policies, { evaluate, depth, beam, horizon = 2, counter }) {
  const game = Game.deserialize(snapshot, { silent: true });
  const until = horizonOf(game, me, horizon);
  if (!applyMacro(game, me, macro)) return null;
  return lookahead(game, me, { evaluate, policies, until, depth, beam, counter });
}

/**
 * A quick score for each macro on one guess: applied, played on to the next key
 * decision, evaluated. For pruning candidates before the real search.
 */
export function quickScores(snapshot, me, macros, policies, { evaluate, horizon = 2 }) {
  return macros.map((macro) => {
    const game = Game.deserialize(snapshot, { silent: true });
    const until = horizonOf(game, me, horizon);
    if (!applyMacro(game, me, macro)) return -Infinity;
    return evaluate(advance(game, me, policies, until).state, me);
  });
}
