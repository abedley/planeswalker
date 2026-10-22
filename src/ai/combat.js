/**
 * Combat maths for the AIs: how much a creature is worth, what happens when an
 * attacker meets its blockers, and which attacks and blocks to make.
 *
 * Everything works on plain permanents from a game state (power, toughness,
 * damage, keywords, tapped, ...). The predictions follow the engine's combat
 * rules (510, first strike and double strike, deathtouch, trample, lifelink);
 * test/combat.test.js checks them against real games. They're written out here
 * rather than run through a game copy because the AI's rollouts call them
 * thousands of times a second.
 */
import { isCreature, hasKeyword, KEYWORD } from '../cards/cards.js';

const has = hasKeyword;

/** A rough worth of a creature, in "points": a 2/2 vanilla is about 6. */
export function creatureValue(creature) {
  if (!isCreature(creature)) return 0;
  const power = Math.max(0, creature.power) * (has(creature, KEYWORD.DOUBLE_STRIKE) ? 2 : 1);
  const toughness = Math.max(0, creature.toughness);
  let value = 1 + 1.5 * power + toughness;
  if (has(creature, KEYWORD.FLYING)) value += 0.5 + 0.6 * power;
  if (has(creature, KEYWORD.MENACE)) value += 0.5 + 0.3 * power;
  if (has(creature, KEYWORD.TRAMPLE)) value += 0.3 * power;
  if (has(creature, KEYWORD.FIRST_STRIKE)) value += 0.5 + 0.4 * power;
  if (has(creature, KEYWORD.DEATHTOUCH)) value += 2.5;
  if (has(creature, KEYWORD.LIFELINK)) value += 0.5 * power;
  if (has(creature, KEYWORD.VIGILANCE)) value += 0.5;
  if (has(creature, KEYWORD.REACH)) value += 0.5;
  if (has(creature, KEYWORD.HASTE)) value += 0.2;
  if (has(creature, KEYWORD.DEFENDER)) value -= 1.5 * power;
  return value;
}

/** Whether `blocker` may block `attacker` (702.9b, 702.17b); menace is a rule about the whole block. */
export function canBlock(blocker, attacker) {
  if (!isCreature(blocker) || blocker.tapped) return false;
  if (has(attacker, KEYWORD.FLYING)) return has(blocker, KEYWORD.FLYING) || has(blocker, KEYWORD.REACH);
  return true;
}

/** How much damage one combat damage event from this creature is (double strike hits twice). */
export const strikes = (creature) => (has(creature, KEYWORD.DOUBLE_STRIKE) ? 2 : 1);

/** The damage an unblocked attacker deals to the player. */
export const unblockedDamage = (creature) => Math.max(0, creature.power) * strikes(creature);

/** All orderings of a short list. */
const permutations = (items) => (items.length <= 1 ? [items]
  : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])));

/**
 * The order to assign lethal damage to blockers in, to kill the most valuable set
 * the attacker can (510.1c lets it divide damage as it likes). Up to four blockers
 * are tried in every order; more are taken cheapest first.
 */
function bestKillOrder(blockers, power, lethal) {
  const byLethal = [...blockers].sort((x, y) => lethal(x) - lethal(y));
  if (blockers.length < 2 || blockers.length > 4) return byLethal;
  let best = byLethal;
  let bestValue = -1;
  for (const order of permutations(byLethal)) {
    let left = power;
    let value = 0;
    for (const b of order) {
      if (lethal(b) > left) break;
      left -= lethal(b);
      value += creatureValue(b);
    }
    if (value > bestValue) [best, bestValue] = [order, value];
  }
  return best;
}

/**
 * Predicts one attacker's combat with its blockers (none means unblocked). The
 * attacker divides its damage to kill as many blockers as it can, cheapest
 * first, and with trample sends the rest to the player.
 *
 * @returns {{ attackerDies: boolean, deadBlockers: string[], playerDamage: number,
 *   attackerLifelink: number, blockerLifelink: number }}
 */
export function resolveCombat(attacker, blockers = [], { blocked = blockers.length > 0 } = {}) {
  const all = [attacker, ...blockers];
  const damage = new Map(all.map((c) => [c.id, c.damage ?? 0]));
  const deathtouched = new Set();
  const dead = new Set();
  const isDead = (c) => damage.get(c.id) >= c.toughness || (deathtouched.has(c.id) && damage.get(c.id) > 0) || c.toughness <= 0;
  let playerDamage = 0;
  let attackerDealt = 0;
  let blockerLifelink = 0;
  const firstStrikeStep = all.some((c) => has(c, KEYWORD.FIRST_STRIKE) || has(c, KEYWORD.DOUBLE_STRIKE));

  for (const first of firstStrikeStep ? [true, false] : [false]) {
    // 510.4 / 702.4b: who deals damage in this step.
    const deals = (c) => !dead.has(c.id) && c.power > 0
      && (has(c, KEYWORD.DOUBLE_STRIKE) || has(c, KEYWORD.FIRST_STRIKE) === first);
    const marks = [];
    if (deals(attacker)) {
      let remaining = attacker.power;
      const living = blockers.filter((b) => !dead.has(b.id));
      if (!blocked) {
        playerDamage += remaining;
        attackerDealt += remaining;
      } else if (living.length === 0) {
        // 702.19e: a trampler whose blockers are all gone hits the player.
        if (has(attacker, KEYWORD.TRAMPLE)) {
          playerDamage += remaining;
          attackerDealt += remaining;
        }
      } else {
        const lethal = (b) => {
          const left = Math.max(0, b.toughness - damage.get(b.id));
          return has(attacker, KEYWORD.DEATHTOUCH) ? Math.min(1, left) : left;
        };
        const ordered = bestKillOrder(living, remaining, lethal);
        for (const b of ordered) {
          const amount = Math.min(remaining, lethal(b));
          if (amount > 0) marks.push([attacker, b, amount]);
          remaining -= amount;
        }
        if (remaining > 0) {
          if (has(attacker, KEYWORD.TRAMPLE)) playerDamage += remaining;
          else marks.push([attacker, ordered[ordered.length - 1], remaining]);
        }
        attackerDealt += attacker.power;
      }
    }
    for (const b of blockers) {
      if (deals(b)) marks.push([b, attacker, b.power]);
    }
    // 510.2: all of the step's damage is dealt at once.
    for (const [source, target, amount] of marks) {
      damage.set(target.id, damage.get(target.id) + amount);
      if (has(source, KEYWORD.DEATHTOUCH)) deathtouched.add(target.id);
      if (source !== attacker) blockerLifelink += has(source, KEYWORD.LIFELINK) ? amount : 0;
    }
    for (const c of all) if (!dead.has(c.id) && isDead(c)) dead.add(c.id);
  }
  return {
    attackerDies: dead.has(attacker.id),
    deadBlockers: blockers.filter((b) => dead.has(b.id)).map((b) => b.id),
    playerDamage,
    attackerLifelink: has(attacker, KEYWORD.LIFELINK) ? attackerDealt : 0,
    blockerLifelink,
  };
}

/**
 * How valuable a combat is for the attacking side, given each attacker's blockers:
 * creature values killed minus lost, plus damage to the defending player weighted
 * by `damageWeight` (larger when the defender is low on life).
 */
export function combatValue(pairs, { damageWeight = 0.5 } = {}) {
  let value = 0;
  for (const { attacker, blockers, blocked } of pairs) {
    const result = resolveCombat(attacker, blockers, { blocked });
    if (result.attackerDies) value -= creatureValue(attacker);
    for (const id of result.deadBlockers) value += creatureValue(blockers.find((b) => b.id === id));
    value += result.playerDamage * damageWeight;
  }
  return value;
}

/** How much a point of damage to a player matters, by their life total. */
export const damageWeight = (life) => (life <= 5 ? 2 : life <= 10 ? 1 : life <= 15 ? 0.6 : 0.4);

/**
 * The damage `attackers` would get through if the defender blocked as well as it
 * could with `blockers` (each blocker stopping the biggest attacker it can block).
 * A quick estimate for lethal checks and races.
 */
export function damageThrough(attackers, blockers) {
  const sorted = [...attackers].sort((a, b) => unblockedDamage(b) - unblockedDamage(a));
  const free = [...blockers];
  let total = 0;
  for (const attacker of sorted) {
    const needed = has(attacker, KEYWORD.MENACE) ? 2 : 1;
    const able = free.filter((b) => canBlock(b, attacker));
    if (able.length >= needed) {
      // The cheapest blockers that can do it are used up.
      able.sort((x, y) => creatureValue(x) - creatureValue(y)).slice(0, needed)
        .forEach((b) => free.splice(free.indexOf(b), 1));
      if (has(attacker, KEYWORD.TRAMPLE)) {
        const toughness = able.slice(0, needed).reduce((sum, b) => sum + b.toughness, 0);
        total += Math.max(0, unblockedDamage(attacker) - toughness);
      }
    } else {
      total += unblockedDamage(attacker);
    }
  }
  return total;
}

/**
 * Which of `candidates` (creatures that may attack) should attack, for the player
 * `me` in `state`:
 * - each attacker the defender can't block profitably (no block kills it without
 *   losing at least as much), and
 * - everything when the attack is lethal through the best possible blocks,
 * - keeping enough creatures home to survive the opponent's next attack.
 */
export function planAttack(state, me, candidates, { swarm = true } = {}) {
  const opponent = state.players.find((p) => p.id !== me);
  const mine = state.battlefield.filter((p) => p.controllerId === me && isCreature(p));
  const theirs = state.battlefield.filter((p) => p.controllerId === opponent.id && isCreature(p));
  const blockers = theirs.filter((p) => !p.tapped);
  // Sorted by id so the plan doesn't depend on the order candidates come in (it's
  // recomputed after each creature is toggled, and must come out the same).
  const attackers = candidates.filter((c) => c.power > 0).sort((a, b) => (a.id < b.id ? -1 : 1));

  // Lethal through the best blocks: attack with everything.
  if (attackers.length && damageThrough(attackers, blockers) >= opponent.life) return attackers.map((c) => c.id);
  // Losing the race to deck out (we draw our last card first), with the end in sight:
  // everything attacks, since a stalled board loses anyway.
  const me_ = state.players.find((p) => p.id === me);
  if (me_.library.length < opponent.library.length && me_.library.length <= 6) return attackers.map((c) => c.id);

  const chosen = attackers.filter((attacker) => {
    const able = blockers.filter((b) => canBlock(b, attacker));
    const blocks = has(attacker, KEYWORD.MENACE)
      ? able.flatMap((b, i) => able.slice(i + 1).map((c) => [b, c]))
      : able.map((b) => [b]);
    // The defender's best block, from their point of view (positive is good for them).
    const worst = Math.max(0, ...blocks.map((group) => {
      const result = resolveCombat(attacker, group);
      return (result.attackerDies ? creatureValue(attacker) : 0)
        - result.deadBlockers.reduce((sum, id) => sum + creatureValue(group.find((b) => b.id === id)), 0);
    }));
    return worst <= 0;
  });

  // More attackers than they can block well: each blocker stops only one, so add an
  // attacker whenever it makes the whole attack better against their best blocks.
  if (swarm) {
    const extra = attackers.filter((c) => !chosen.includes(c)).sort((a, b) => b.power - a.power || (a.id < b.id ? -1 : 1));
    let best = attackOutcome(state, opponent, chosen);
    for (const attacker of extra) {
      const outcome = attackOutcome(state, opponent, [...chosen, attacker]);
      if (outcome > best + 0.25) {
        chosen.push(attacker);
        best = outcome;
      }
    }
  }

  // Hold back blockers if attacking would let the crack-back kill us (and staying home wouldn't).
  const crackBack = (attacking) => {
    const home = mine.filter((c) => !attacking.includes(c) || has(c, KEYWORD.VIGILANCE));
    // Next turn our creatures untap; theirs can all attack.
    const untapped = home.map((c) => ({ ...c, tapped: false }));
    return damageThrough(theirs.filter((c) => !has(c, KEYWORD.DEFENDER)), untapped);
  };
  if (crackBack(chosen) >= me_.life && crackBack([]) < me_.life) {
    // Keep the best blockers home first.
    const byBlocking = [...chosen].sort((a, b) => b.toughness - a.toughness || (a.id < b.id ? -1 : 1));
    while (byBlocking.length && crackBack(byBlocking) >= me_.life) byBlocking.shift();
    return byBlocking.map((c) => c.id);
  }
  return chosen.map((c) => c.id);
}

/**
 * How good attacking with `group` is (combatValue, from the attacker's side) if
 * `opponent` blocks as planBlocks would.
 */
function attackOutcome(state, opponent, group) {
  if (group.length === 0) return 0;
  const hypothetical = { ...state, combat: { attackers: group.map((c) => ({ cardId: c.id, blockerIds: [] })) } };
  const byId = (id) => state.battlefield.find((p) => p.id === id);
  const blocks = planBlocks(hypothetical, opponent.id, (b, a) => canBlock(byId(b), byId(a)));
  return combatValue(group.map((attacker) => {
    const blockers = Object.entries(blocks).filter(([, a]) => a === attacker.id).map(([b]) => byId(b));
    return { attacker, blockers, blocked: blockers.length > 0 };
  }), { damageWeight: damageWeight(opponent.life) });
}

/**
 * Blocks for the defending player `me`: `{ blockerId: attackerId }`. Good blocks
 * (killing the attacker, or trading up) first, then double blocks that kill a big
 * attacker, then chump blocks only if the damage would otherwise be lethal.
 * `canBlockPair(blockerId, attackerId)` says which blocks the engine allows.
 */
export function planBlocks(state, me, canBlockPair) {
  const life = state.players.find((p) => p.id === me).life;
  const weight = damageWeight(life);
  const byId = (id) => state.battlefield.find((p) => p.id === id);
  const attackers = state.combat.attackers.map((a) => byId(a.cardId)).filter(Boolean);
  const available = new Set(state.battlefield
    .filter((p) => p.controllerId === me && isCreature(p) && !p.tapped && attackers.some((a) => canBlockPair(p.id, a.id)))
    .map((p) => p.id));
  const plan = {};
  const blockersOf = new Map(attackers.map((a) => [a.id, []]));
  const assign = (group, attacker) => group.forEach((b) => {
    plan[b.id] = attacker.id;
    blockersOf.get(attacker.id).push(b);
    available.delete(b.id);
  });
  // From the defender's side: attacker values killed minus blockers lost, plus damage prevented.
  const blockScore = (attacker, group) => {
    const result = resolveCombat(attacker, group);
    return (result.attackerDies ? creatureValue(attacker) : 0)
      - result.deadBlockers.reduce((sum, id) => sum + creatureValue(byId(id)), 0)
      + (unblockedDamage(attacker) - result.playerDamage) * weight;
  };
  const options = (attacker) => [...available].map(byId).filter((b) => canBlockPair(b.id, attacker.id));
  const threat = (a) => unblockedDamage(a) + creatureValue(a);
  const sorted = [...attackers].sort((x, y) => threat(y) - threat(x));

  // Single blocks (pairs for menace) that are good on their own.
  for (const attacker of sorted) {
    const able = options(attacker);
    const groups = has(attacker, KEYWORD.MENACE)
      ? able.flatMap((b, i) => able.slice(i + 1).map((c) => [b, c]))
      : able.map((b) => [b]);
    let best = null;
    let bestScore = 0;
    for (const group of groups) {
      const score = blockScore(attacker, group);
      if (score > bestScore) [best, bestScore] = [group, score];
    }
    if (best) assign(best, attacker);
  }
  // Double blocks on attackers still unblocked.
  for (const attacker of sorted.filter((a) => blockersOf.get(a.id).length === 0 && !has(a, KEYWORD.MENACE))) {
    const able = options(attacker);
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < able.length; i++) {
      for (let j = i + 1; j < able.length; j++) {
        const score = blockScore(attacker, [able[i], able[j]]);
        if (score > bestScore) [best, bestScore] = [[able[i], able[j]], score];
      }
    }
    if (best) assign(best, attacker);
  }
  // Chump blocks while the unblocked damage would kill us.
  const incoming = () => attackers.reduce((sum, a) => {
    const group = blockersOf.get(a.id);
    return sum + (group.length ? resolveCombat(a, group).playerDamage : unblockedDamage(a));
  }, 0);
  for (const attacker of sorted) {
    if (incoming() < life) break;
    if (blockersOf.get(attacker.id).length) continue;
    const needed = has(attacker, KEYWORD.MENACE) ? 2 : 1;
    const cheapest = options(attacker).sort((x, y) => creatureValue(x) - creatureValue(y)).slice(0, needed);
    if (cheapest.length === needed) assign(cheapest, attacker);
  }
  return plan;
}
