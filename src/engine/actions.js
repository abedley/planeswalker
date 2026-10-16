/** Player action types. PASS_PRIORITY is the only action supported so far. */
export const ACTION = Object.freeze({
  PASS_PRIORITY: 'PASS_PRIORITY',
});

export const passPriority = (playerId) => ({ type: ACTION.PASS_PRIORITY, playerId });
