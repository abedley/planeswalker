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
});

export const passPriority = (playerId) => ({ type: ACTION.PASS_PRIORITY, playerId });
export const playLand = (playerId, cardId) => ({ type: ACTION.PLAY_LAND, playerId, cardId });
/**
 * `targets` (an array of ids) is only for spells that target, such as Auras.
 * `costChoices` (`{ sacrifice?: [id], discard?: [id] }`) is only for spells with
 * additional costs that need choices, such as "sacrifice a creature".
 */
export const castSpell = (playerId, cardId, targets, costChoices) => ({
  type: ACTION.CAST_SPELL, playerId, cardId, ...(targets ? { targets } : {}), ...(costChoices ? { costChoices } : {}),
});
/** `targets` and `costChoices` work as for castSpell, for abilities that need them. */
export const activateAbility = (playerId, cardId, abilityId, targets, costChoices) => ({
  type: ACTION.ACTIVATE_ABILITY,
  playerId,
  cardId,
  abilityId,
  ...(targets ? { targets } : {}),
  ...(costChoices ? { costChoices } : {}),
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
