/**
 * Rules for a whole declaration of blockers, shared by the engine and the AI:
 * - restrictions on how many creatures block an attacker (509.1b): menace (702.111b,
 *   not exactly one) and "can't be blocked by more than one creature";
 * - requirements (509.1c): "must be blocked if able" (one requirement: that it's
 *   blocked) and "all creatures able to block this creature do so" (a requirement
 *   on each creature able to block it). The blocks must obey as many requirements as
 *   possible without breaking a restriction.
 *
 * Attackers and blockers are permanents (with `id` and `keywords`); `blocks` maps
 * blocker ids to attacker ids; `canBlock(blocker, attacker)` is the pairwise check.
 */
import { KEYWORD, hasKeyword } from '../cards/cards.js';

const isLure = (attacker) => hasKeyword(attacker, KEYWORD.LURE);
const mustBeBlocked = (attacker) => hasKeyword(attacker, KEYWORD.MUST_BE_BLOCKED);
const isRequired = (attacker) => isLure(attacker) || mustBeBlocked(attacker);

/** Whether `count` blockers on `attacker` break a restriction. */
export function groupAllowed(attacker, count) {
  if (count === 1 && hasKeyword(attacker, KEYWORD.MENACE)) return false;
  if (count > 1 && hasKeyword(attacker, KEYWORD.MAX_ONE_BLOCKER)) return false;
  return true;
}

/** Whether every attacker's group of blockers is allowed. */
export function groupsAllowed(attackers, blocks) {
  const counts = new Map();
  for (const attackerId of Object.values(blocks)) counts.set(attackerId, (counts.get(attackerId) ?? 0) + 1);
  return attackers.every((a) => groupAllowed(a, counts.get(a.id) ?? 0));
}

/**
 * The most requirements any legal blocks obey, and blocks that do so, staying as
 * close to `preferred` as they can: a search over the creatures able to block an
 * attacker with a requirement, each blocking one of those or keeping its preferred
 * block. Counts per attacker only matter up to 2, which keeps the search small.
 */
function bestRequiredBlocks(required, blockers, canBlock, preferred, worth = () => 0) {
  const requiredIds = new Set(required.map((a) => a.id));
  const relevant = blockers
    .map((b) => ({ blocker: b, options: required.map((a, i) => (canBlock(b, a) ? i : -1)).filter((i) => i >= 0) }))
    .filter((r) => r.options.length > 0);
  const memo = new Map();
  // Returns [obeyed, -changes, choices] for blockers from `index` on, given counts so far.
  const search = (index, counts) => {
    if (index === relevant.length) {
      return required.every((a, i) => groupAllowed(a, counts[i])) ? [0, 0, []] : null;
    }
    const key = `${index}:${counts.join('')}`;
    if (memo.has(key)) return memo.get(key);
    const { blocker, options } = relevant[index];
    const wanted = preferred[blocker.id];
    // Changing a cheaper blocker's block costs less.
    const change = 1 + worth(blocker) / 1000;
    let best = null;
    const consider = (choice, gain, cost, nextCounts) => {
      const rest = search(index + 1, nextCounts);
      if (!rest) return;
      const candidate = [rest[0] + gain, rest[1] - cost, [choice, ...rest[2]]];
      if (!best || candidate[0] > best[0] || (candidate[0] === best[0] && candidate[1] > best[1])) best = candidate;
    };
    // Not blocking an attacker with a requirement: its preferred block, unless that was one.
    consider(null, 0, requiredIds.has(wanted) ? change : 0, counts);
    for (const i of options) {
      const attacker = required[i];
      const gain = (isLure(attacker) ? 1 : 0) + (mustBeBlocked(attacker) && counts[i] === 0 ? 1 : 0);
      const next = [...counts];
      next[i] = Math.min(2, next[i] + 1);
      consider(attacker.id, gain, wanted === attacker.id ? 0 : change, next);
    }
    memo.set(key, best);
    return best;
  };
  const best = search(0, required.map(() => 0)) ?? [0, 0, relevant.map(() => null)];
  return { maximum: best[0], relevant: relevant.map((r) => r.blocker), choices: best[2] };
}

/** How many requirements `blocks` obeys. */
function obeyed(required, blockers, blocks) {
  let count = 0;
  for (const attacker of required) {
    const blocking = blockers.filter((b) => blocks[b.id] === attacker.id).length;
    if (isLure(attacker)) count += blocking;
    if (mustBeBlocked(attacker) && blocking > 0) count += 1;
  }
  return count;
}

/** Whether `blocks` obeys as many requirements as possible (509.1c). */
export function requirementsMet(attackers, blockers, blocks, canBlock) {
  const required = attackers.filter(isRequired);
  if (required.length === 0) return true;
  return obeyed(required, blockers, blocks) >= bestRequiredBlocks(required, blockers, canBlock, blocks).maximum;
}

/** Whether a whole declaration of blocks is legal: restrictions on groups, and requirements. */
export function blocksLegal(attackers, blockers, blocks, canBlock) {
  return groupsAllowed(attackers, blocks) && requirementsMet(attackers, blockers, blocks, canBlock);
}

/**
 * `blocks` changed as little as possible to be legal: the requirements met (for the
 * AI, whose block plans don't know them), moving the blockers with the least `worth`,
 * then any group left too small for menace or too big for "more than one creature"
 * broken up.
 */
export function legalizeBlocks(attackers, blockers, blocks, canBlock, worth) {
  const result = { ...blocks };
  const required = attackers.filter(isRequired);
  if (required.length > 0) {
    const requiredIds = new Set(required.map((a) => a.id));
    const { relevant, choices } = bestRequiredBlocks(required, blockers, canBlock, blocks, worth);
    relevant.forEach((blocker, i) => {
      if (choices[i]) result[blocker.id] = choices[i];
      else if (requiredIds.has(result[blocker.id])) delete result[blocker.id];
    });
  }
  for (const attacker of attackers) {
    const on = Object.keys(result).filter((id) => result[id] === attacker.id);
    if (groupAllowed(attacker, on.length)) continue;
    const keep = on.length === 1 ? 0 : 1;
    for (const id of on.slice(keep)) delete result[id];
  }
  return result;
}
