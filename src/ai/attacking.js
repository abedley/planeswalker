/**
 * Attacks that look ahead. Each side can follow one of three strategies on its turns
 * (ATTACK_STRATEGY):
 * - `aggressive`: attack with everything that can, to race.
 * - `value`: attack for value: add attackers one at a time while the trade gets
 *   better against the defender's blocks (creature value killed minus value lost,
 *   plus a little for damage: chip damage counts, but more when the defender is low).
 * - `hold`: the `value` attack, minus the creatures it will want as blockers when
 *   the opponent attacks with everything next turn.
 *
 * planLookaheadAttack plays each of our strategies out for a few turns against each
 * of the opponent's, with the creatures in play now (nobody casts another), and
 * takes the strategy whose worst case is best. Defenders block as the basic AI does
 * (blockingPlans' `value` plan), so a crack-back that kills us shows up, and so does
 * a race we win. A win scores more the sooner it comes; otherwise the score is board
 * value plus life, which counts for more when it's low.
 */
import { hasKeyword, isCreature, KEYWORD } from '../cards/cards.js';
import { creatureValue, damageWeight } from './combat.js';
import { blockingPlans, BLOCK_PLAN, fight, record } from './blocking.js';

export const ATTACK_STRATEGY = Object.freeze({
  AGGRESSIVE: 'aggressive',
  VALUE: 'value',
  HOLD: 'hold',
});

/** The score of a win (less the turns it takes), and minus it, of a loss. */
const WIN = 10000;
/** How much a point of chip damage counts in a `value` attack, times damageWeight. */
const CHIP = 0.5;

const has = hasKeyword;

/**
 * A side in the lookahead: `{ life, creatures }`, where creatures are copies of
 * permanents, with `sick` on those that can't attack this turn.
 */
const ready = (c) => !c.tapped && !c.sick && c.power > 0 && !has(c, KEYWORD.DEFENDER);

/** How `defending` blocks `attackers`: the basic AI's blocks (the `value` plan). */
const blocksAgainst = (attackers, defending) => blockingPlans(attackers, defending.creatures.filter((c) => !c.tapped),
  defending.life, { plans: [BLOCK_PLAN.VALUE] })[BLOCK_PLAN.VALUE];

/** How good attacking with `attackers` is for the attacker: the trade, plus a little for damage. */
function trade(attackers, defending) {
  if (attackers.length === 0) return 0;
  const plan = blocksAgainst(attackers, defending);
  if (!plan.survives) return WIN;
  return plan.lostValue - plan.killedValue + CHIP * damageWeight(defending.life) * (defending.life - plan.lifeAfter);
}

/** The sides after `attacking` attacks `defending` with `attackers`. */
function combat(attacking, defending, attackers) {
  if (attackers.length === 0) return [attacking, defending];
  const plan = blocksAgainst(attackers, defending);
  const dead = new Set([...plan.deadAttackers, ...plan.deadBlockers]);
  // 702.15b: an attacker with lifelink gains its controller the damage it deals.
  let gain = 0;
  for (const attacker of attackers) {
    if (!has(attacker, KEYWORD.LIFELINK)) continue;
    const group = defending.creatures.filter((b) => plan.blocks[b.id] === attacker.id);
    gain += fight(record(attacker), group.map((b) => record(b))).dealt;
  }
  const attacked = new Set(attackers.map((c) => c.id));
  return [{
    life: attacking.life + gain,
    creatures: attacking.creatures.filter((c) => !dead.has(c.id))
      .map((c) => (attacked.has(c.id) && !has(c, KEYWORD.VIGILANCE) ? { ...c, tapped: true } : c)),
  }, {
    life: plan.lifeAfter,
    creatures: defending.creatures.filter((c) => !dead.has(c.id)),
  }];
}

/** The `value` attack: attackers added one at a time, the best first, while the trade improves. */
function valueAttack(attacking, defending, able) {
  const chosen = [];
  let best = 0;
  for (;;) {
    let pick = null;
    let pickScore = best;
    for (const attacker of able) {
      if (chosen.includes(attacker)) continue;
      const score = trade([...chosen, attacker], defending);
      if (score > pickScore + 1e-9) [pick, pickScore] = [attacker, score];
    }
    if (!pick) return chosen;
    chosen.push(pick);
    best = pickScore;
  }
}

/** Each strategy's attack for `attacking` this turn, from the creatures `able` to attack. */
const STRATEGIES = {
  [ATTACK_STRATEGY.AGGRESSIVE]: (attacking, defending, able) => able,
  [ATTACK_STRATEGY.VALUE]: valueAttack,
  [ATTACK_STRATEGY.HOLD]: (attacking, defending, able) => {
    // The blockers we'd use if they attacked with everything, with all of ours untapped.
    const theirs = defending.creatures.filter((c) => c.power > 0 && !has(c, KEYWORD.DEFENDER));
    const ours = { life: attacking.life, creatures: attacking.creatures.map((c) => ({ ...c, tapped: false })) };
    const needed = theirs.length ? blocksAgainst(theirs, ours).blocks : {};
    return valueAttack(attacking, defending, able).filter((c) => !needed[c.id] || has(c, KEYWORD.VIGILANCE));
  },
};

/** A side's creatures at the start of its turn: untapped, able to attack, undamaged. */
const startTurn = (side) => ({ life: side.life, creatures: side.creatures.map((c) => ({ ...c, tapped: false, sick: false, damage: 0 })) });
/** The other side's creatures then: damage wears off at end of turn (514.2). */
const healed = (side) => ({ life: side.life, creatures: side.creatures.map((c) => (c.damage ? { ...c, damage: 0 } : c)) });

/** A side's worth: its creatures' value, plus its life (each point worth more when life is low). */
const worth = (side) => side.creatures.reduce((sum, c) => sum + creatureValue(c), 0) + 8 * Math.sqrt(Math.max(0, side.life));

/**
 * Plays our `first` attack, then `halfTurns - 1` more turns, us following strategy
 * `ours` and them `theirs`. Our score at the end: ±WIN (less the turns taken) for a
 * win or loss, otherwise our worth minus theirs.
 */
function playOut(us, them, first, ours, theirs, halfTurns) {
  [us, them] = combat(us, them, first);
  for (let turn = 1; ; turn++) {
    if (them.life <= 0) return WIN - turn;
    if (us.life <= 0) return -WIN + turn;
    if (turn === halfTurns) return worth(us) - worth(them);
    if (turn % 2 === 1) {
      them = startTurn(them);
      us = healed(us);
      [them, us] = combat(them, us, STRATEGIES[theirs](them, us, them.creatures.filter(ready)));
    } else {
      us = startTurn(us);
      them = healed(them);
      [us, them] = combat(us, them, STRATEGIES[ours](us, them, us.creatures.filter(ready)));
    }
  }
}

/**
 * Which of `candidates` (creatures that may attack) should attack, for the player
 * `me` in `state`, looking `turns` of ours ahead (and theirs after each).
 *
 * @returns {{ attackers: string[], strategy: string, scores: Object<string, number> }}
 *   the attackers' ids, the strategy chosen, and each strategy's worst-case score.
 */
export function planLookaheadAttack(state, me, candidates, { turns = 3 } = {}) {
  const able = new Set(candidates.filter((c) => c.power > 0).map((c) => c.id));
  const side = (id) => ({
    life: state.players.find((p) => p.id === id).life,
    creatures: state.battlefield.filter((p) => p.controllerId === id && isCreature(p))
      .map((c) => ({ ...c, damage: c.damage ?? 0, sick: id === me && !able.has(c.id) })),
  });
  const us = side(me);
  const them = side(state.players.find((p) => p.id !== me).id);
  const attackers = us.creatures.filter((c) => able.has(c.id));

  const scores = {};
  let best = null;
  // On a tie, attacking for value comes first, then holding back.
  for (const strategy of [ATTACK_STRATEGY.VALUE, ATTACK_STRATEGY.HOLD, ATTACK_STRATEGY.AGGRESSIVE]) {
    const first = STRATEGIES[strategy](us, them, attackers);
    let worst = Infinity;
    for (const reply of Object.values(ATTACK_STRATEGY)) {
      worst = Math.min(worst, playOut(us, them, first, strategy, reply, 2 * turns));
    }
    scores[strategy] = worst;
    if (!best || worst > best.score + 1e-9) best = { strategy, score: worst, attackers: first.map((c) => c.id) };
  }
  return { attackers: best.attackers, strategy: best.strategy, scores };
}
