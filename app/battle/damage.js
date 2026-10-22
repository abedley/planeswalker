/**
 * Combat damage assignment as the player sees it: which blockers die.
 *
 * The engine lists every legal split of an attacker's damage among its blockers
 * (and, with trample, the defending player). Most splits differ only in where
 * damage that changes nothing goes, so they are reduced to outcomes: the blockers
 * that receive lethal damage, and the damage that tramples over.
 */
import { DECISION } from '../../src/engine/Game.js';
import { ACTION } from '../../src/engine/actions.js';
import { hasKeyword } from '../../src/cards/cards.js';

/** The damage `blocker` needs to die from `attacker` (702.2c: any deathtouch damage is lethal). */
export function lethalDamage(blocker, attacker) {
  const remaining = Math.max(0, blocker.toughness - (blocker.damage ?? 0));
  return hasKeyword(attacker, 'deathtouch') ? Math.min(1, remaining) : remaining;
}

/**
 * The distinct outcomes of `me`'s pending damage assignment, best first:
 * `[{ action, kills: [blockerId], toPlayer, assignment }]`. Splits with the same
 * kills keep the one that tramples over the most, then the one that leaves spare
 * damage on the survivors; an outcome is dropped when
 * another kills the same creatures and more, and tramples over at least as much.
 */
export function damagePlans(state, me) {
  const decision = state.pendingDecision;
  if (decision?.type !== DECISION.ASSIGN_COMBAT_DAMAGE || decision.playerId !== me) return [];
  const attacker = state.battlefield.find((p) => p.id === decision.attackerId);
  const blockers = decision.blockerIds.map((id) => state.battlefield.find((p) => p.id === id)).filter(Boolean);
  const lethal = new Map(blockers.map((b) => [b.id, lethalDamage(b, attacker)]));
  const byKills = new Map();
  for (const action of state.validActions) {
    if (action.playerId !== me || action.type !== ACTION.ASSIGN_COMBAT_DAMAGE) continue;
    const { assignment } = action;
    const kills = blockers.filter((b) => lethal.get(b.id) > 0 && (assignment[b.id] ?? 0) >= lethal.get(b.id)).map((b) => b.id);
    const toPlayer = Object.entries(assignment).filter(([id]) => !lethal.has(id)).reduce((sum, [, n]) => sum + n, 0);
    // Damage beyond lethal on a creature that dies anyway is wasted; on a survivor it stays
    // marked for the rest of the turn.
    const overkill = kills.reduce((sum, id) => sum + assignment[id] - lethal.get(id), 0);
    const key = kills.join();
    const known = byKills.get(key);
    if (!known || toPlayer > known.toPlayer || (toPlayer === known.toPlayer && overkill < known.overkill)) {
      byKills.set(key, { action, kills, toPlayer, assignment, overkill });
    }
  }
  const plans = [...byKills.values()];
  const covers = (a, b) => b.kills.every((id) => a.kills.includes(id)) && a.toPlayer >= b.toPlayer;
  // Ties: kill the bigger creatures, then follow the blockers' order.
  const order = new Map(blockers.map((b, i) => [b.id, i]));
  const worth = (plan) => plan.kills.reduce((sum, id) => {
    const b = blockers[order.get(id)];
    return sum + b.power + b.toughness;
  }, 0);
  const first = (plan) => Math.min(...plan.kills.map((id) => order.get(id)));
  return plans
    .filter((p) => !plans.some((q) => q !== p && covers(q, p)))
    .sort((a, b) => b.kills.length - a.kills.length || b.toPlayer - a.toPlayer || worth(b) - worth(a) || first(a) - first(b));
}
