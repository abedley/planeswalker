/** Player action types. */
export const ACTION = Object.freeze({
  PASS_PRIORITY: 'PASS_PRIORITY',
  PLAY_LAND: 'PLAY_LAND',
  ACTIVATE_ABILITY: 'ACTIVATE_ABILITY',
  DISCARD: 'DISCARD',
});

export const passPriority = (playerId) => ({ type: ACTION.PASS_PRIORITY, playerId });
export const playLand = (playerId, cardId) => ({ type: ACTION.PLAY_LAND, playerId, cardId });
export const activateAbility = (playerId, cardId, abilityId) => (
  { type: ACTION.ACTIVATE_ABILITY, playerId, cardId, abilityId }
);
export const discard = (playerId, cardId) => ({ type: ACTION.DISCARD, playerId, cardId });
