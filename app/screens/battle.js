import { h } from '../dom.js';
import { Battle } from '../battle/Battle.js';
import { loadRun, saveRun } from '../../src/campaign/save.js';
import { matchSetup, recordResult, RUN_PHASE, currentTier } from '../../src/campaign/campaign.js';
import { personInfo } from './common.js';

/**
 * A fight. `mode: 'run'` plays the run's current encounter and records the
 * result; `mode: 'quick'` plays `quick: { run, game? }` without saving anything,
 * where `game` overrides the game's options (decks, cards, shuffling), for testing.
 */
export function battleScreen(app, { mode = 'run', quick = null }) {
  const { content } = app;
  let run = mode === 'run' ? loadRun(app.storage, content) : quick.run;
  if (!run) {
    queueMicrotask(() => app.go('title'));
    return { el: h('div') };
  }
  const base = matchSetup(run, content, { playerName: content.planeswalkers[run.planeswalkerId].name });
  const setup = quick?.game ? { ...base, game: { ...base.game, ...quick.game, cards: { ...base.game.cards, ...quick.game.cards } } } : base;
  const opponent = content.opponents[run.encounter.opponentId];
  const tier = currentTier(run, content);

  const onEnd = ({ won }) => {
    if (mode === 'quick') {
      app.go('result', { kind: won ? 'quickWon' : 'quickLost' });
      return;
    }
    run = recordResult(loadRun(app.storage, content) ?? run, content, { won });
    saveRun(app.storage, run);
    if (run.phase === RUN_PHASE.REWARD) app.go('reward');
    else if (run.phase === RUN_PHASE.VICTORY) app.go('result', { kind: 'runWon' });
    else if (run.phase === RUN_PHASE.OVER) app.go('result', { kind: 'runOver' });
    else app.go('result', { kind: 'defeat' });
  };

  const battle = new Battle(app, {
    setup,
    meInfo: personInfo(content.planeswalkers[run.planeswalkerId]),
    oppInfo: personInfo(opponent),
    subtitle: mode === 'quick' ? 'Quick match' : tier.boss ? 'Boss' : tier.name,
    onEnd,
  });
  window.planeswalker.battle = battle;
  return {
    el: battle.el,
    enter: () => battle.start(),
    destroy: () => battle.destroy(),
  };
}
