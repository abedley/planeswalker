/** Player action types. */
export const ACTION = Object.freeze({
  PASS_PRIORITY: 'PASS_PRIORITY',
  PLAY_LAND: 'PLAY_LAND',
  CAST_SPELL: 'CAST_SPELL',
  ACTIVATE_ABILITY: 'ACTIVATE_ABILITY',
  // Declaring attackers: toggle creatures in or out of the attack, then confirm.
  TOGGLE_ATTACKER: 'TOGGLE_ATTACKER',
  CONFIRM_ATTACKERS: 'CONFIRM_ATTACKERS',
  // Declaring blockers: set which attacker each creature blocks (or null), then confirm.
  SET_BLOCKER: 'SET_BLOCKER',
  CONFIRM_BLOCKERS: 'CONFIRM_BLOCKERS',
  ASSIGN_COMBAT_DAMAGE: 'ASSIGN_COMBAT_DAMAGE',
  DISCARD: 'DISCARD',
  // Choosing the target of a triggered ability as it's put on the stack (603.3d).
  CHOOSE_TARGETS: 'CHOOSE_TARGETS',
  // Choosing the mode of a modal triggered ability ("choose one —", 700.2) and its target.
  CHOOSE_MODE: 'CHOOSE_MODE',
  // The legend rule (704.5j): which of the legendary permanents with the same name to keep.
  KEEP_LEGEND: 'KEEP_LEGEND',
  // Mulligans (103.5): keep the opening hand or draw a new one, then put cards on the bottom.
  KEEP_HAND: 'KEEP_HAND',
  MULLIGAN: 'MULLIGAN',
  PUT_ON_BOTTOM: 'PUT_ON_BOTTOM',
});

export const passPriority = (playerId) => ({ type: ACTION.PASS_PRIORITY, playerId });
export const playLand = (playerId, cardId) => ({ type: ACTION.PLAY_LAND, playerId, cardId });
/**
 * `targets` (an array of ids) is only for spells that target, such as Auras.
 * `costChoices` (`{ sacrifice?: [id], discard?: [id] }`) is only for spells with
 * additional costs that need choices, such as "sacrifice a creature".
 * `manaColor` ('W', 'U', 'B', 'R' or 'G') is only for effects that add one mana of any color.
 */
export const castSpell = (playerId, cardId, targets, costChoices, manaColor) => ({
  type: ACTION.CAST_SPELL,
  playerId,
  cardId,
  ...(targets ? { targets } : {}),
  ...(costChoices ? { costChoices } : {}),
  ...(manaColor ? { manaColor } : {}),
});
/**
 * `targets`, `costChoices` and `manaColor` work as for castSpell, for abilities that
 * need them, such as a Treasure's "Add one mana of any color".
 */
export const activateAbility = (playerId, cardId, abilityId, targets, costChoices, manaColor) => ({
  type: ACTION.ACTIVATE_ABILITY,
  playerId,
  cardId,
  abilityId,
  ...(targets ? { targets } : {}),
  ...(costChoices ? { costChoices } : {}),
  ...(manaColor ? { manaColor } : {}),
});
export const toggleAttacker = (playerId, cardId) => ({ type: ACTION.TOGGLE_ATTACKER, playerId, cardId });
export const confirmAttackers = (playerId) => ({ type: ACTION.CONFIRM_ATTACKERS, playerId });
export const setBlocker = (playerId, cardId, attackerId) => (
  { type: ACTION.SET_BLOCKER, playerId, cardId, attackerId }
);
export const confirmBlockers = (playerId) => ({ type: ACTION.CONFIRM_BLOCKERS, playerId });
export const assignCombatDamage = (playerId, attackerId, assignment) => (
  { type: ACTION.ASSIGN_COMBAT_DAMAGE, playerId, attackerId, assignment }
);
export const discard = (playerId, cardId) => ({ type: ACTION.DISCARD, playerId, cardId });
export const chooseTargets = (playerId, targets) => ({ type: ACTION.CHOOSE_TARGETS, playerId, targets });
export const chooseMode = (playerId, mode, targets) => ({ type: ACTION.CHOOSE_MODE, playerId, mode, ...(targets ? { targets } : {}) });
export const keepLegend = (playerId, cardId) => ({ type: ACTION.KEEP_LEGEND, playerId, cardId });
export const keepHand = (playerId) => ({ type: ACTION.KEEP_HAND, playerId });
export const mulligan = (playerId) => ({ type: ACTION.MULLIGAN, playerId });
export const putOnBottom = (playerId, cardId) => ({ type: ACTION.PUT_ON_BOTTOM, playerId, cardId });
