/**
 * Turn structure (Comprehensive Rules 500–514).
 *
 * The turn is modelled as an ordered list of segments. Each segment is a step,
 * or a main phase (which has no steps, so `step` is null).
 *
 * - `priority`: whether players receive priority during the segment.
 *   No player receives priority in the untap step (502.4) and normally not in
 *   the cleanup step (514.3).
 * - `skip(game)`: optional predicate; the segment is skipped entirely when true.
 */

export const PHASE = Object.freeze({
  BEGINNING: 'beginning',
  PRECOMBAT_MAIN: 'precombatMain',
  COMBAT: 'combat',
  POSTCOMBAT_MAIN: 'postcombatMain',
  ENDING: 'ending',
});

export const STEP = Object.freeze({
  UNTAP: 'untap',
  UPKEEP: 'upkeep',
  DRAW: 'draw',
  BEGINNING_OF_COMBAT: 'beginningOfCombat',
  DECLARE_ATTACKERS: 'declareAttackers',
  DECLARE_BLOCKERS: 'declareBlockers',
  COMBAT_DAMAGE: 'combatDamage',
  END_OF_COMBAT: 'endOfCombat',
  END: 'end',
  CLEANUP: 'cleanup',
});

export const PHASE_NAMES = Object.freeze({
  [PHASE.BEGINNING]: 'Beginning Phase',
  [PHASE.PRECOMBAT_MAIN]: 'Precombat Main Phase',
  [PHASE.COMBAT]: 'Combat Phase',
  [PHASE.POSTCOMBAT_MAIN]: 'Postcombat Main Phase',
  [PHASE.ENDING]: 'Ending Phase',
});

export const STEP_NAMES = Object.freeze({
  [STEP.UNTAP]: 'Untap Step',
  [STEP.UPKEEP]: 'Upkeep Step',
  [STEP.DRAW]: 'Draw Step',
  [STEP.BEGINNING_OF_COMBAT]: 'Beginning of Combat Step',
  [STEP.DECLARE_ATTACKERS]: 'Declare Attackers Step',
  [STEP.DECLARE_BLOCKERS]: 'Declare Blockers Step',
  [STEP.COMBAT_DAMAGE]: 'Combat Damage Step',
  [STEP.END_OF_COMBAT]: 'End of Combat Step',
  [STEP.END]: 'End Step',
  [STEP.CLEANUP]: 'Cleanup Step',
});

// 508.8: if no creatures are declared as attackers, the declare blockers and
// combat damage steps are skipped.
const noAttackers = (game) => game.combat.attackers.length === 0;

export const TURN_STRUCTURE = Object.freeze([
  { phase: PHASE.BEGINNING, step: STEP.UNTAP, priority: false },
  { phase: PHASE.BEGINNING, step: STEP.UPKEEP, priority: true },
  {
    phase: PHASE.BEGINNING,
    step: STEP.DRAW,
    priority: true,
    // 103.8a: the player who plays first skips the draw step of their first turn.
    skip: (game) => game.turn === 1,
  },
  { phase: PHASE.PRECOMBAT_MAIN, step: null, priority: true },
  { phase: PHASE.COMBAT, step: STEP.BEGINNING_OF_COMBAT, priority: true },
  { phase: PHASE.COMBAT, step: STEP.DECLARE_ATTACKERS, priority: true },
  { phase: PHASE.COMBAT, step: STEP.DECLARE_BLOCKERS, priority: true, skip: noAttackers },
  { phase: PHASE.COMBAT, step: STEP.COMBAT_DAMAGE, priority: true, skip: noAttackers },
  { phase: PHASE.COMBAT, step: STEP.END_OF_COMBAT, priority: true },
  { phase: PHASE.POSTCOMBAT_MAIN, step: null, priority: true },
  { phase: PHASE.ENDING, step: STEP.END, priority: true },
  { phase: PHASE.ENDING, step: STEP.CLEANUP, priority: false },
].map(Object.freeze));
