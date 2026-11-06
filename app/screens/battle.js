import { h } from '../dom.js';
import { Battle } from '../battle/Battle.js';
import { loadRun, saveRun } from '../../src/campaign/save.js';
import { matchSetup, recordResult, RUN_PHASE, currentTier } from '../../src/campaign/campaign.js';
import { personInfo } from './common.js';
import {
  roundSetup, recordRound, outcome, score, ROUND_RESULT, MATCH_OUTCOME,
} from '../../src/paigow/paigow.js';
import { paigowOpponent } from '../../src/paigow/personas.js';

/**
 * A fight. `mode: 'run'` plays the run's current encounter and records the
 * result; `mode: 'quick'` plays `quick: { run, game? }` without saving anything,
 * where `game` overrides the game's options (decks, cards, shuffling), for testing.
 */
export function battleScreen(app, { mode = 'run', quick = null, match = null }) {
  const { content } = app;
  if (mode === 'paigow') return paigowBattle(app, match);
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

/** A round of a Pai Gow match (src/paigow/paigow.js): `match` is the match so far, with the decks set. */
function paigowBattle(app, match) {
  const { content } = app;
  if (!match?.decks) {
    queueMicrotask(() => app.go('paigow'));
    return { el: h('div') };
  }
  const setup = roundSetup(match, content);
  const opponent = paigowOpponent(match.opponentId);
  const { won, lost } = score(match);
  const resultOf = ({ won: roundWon, drawn }) => (drawn ? ROUND_RESULT.DRAWN : roundWon ? ROUND_RESULT.WON : ROUND_RESULT.LOST);
  // "Victory" and "Defeat" are for the match; a round that doesn't decide it is only "Round won" and the like.
  const resultText = (end) => {
    const result = resultOf(end);
    const decided = outcome(recordRound(match, result));
    if (decided) return { [MATCH_OUTCOME.WON]: 'Victory', [MATCH_OUTCOME.LOST]: 'Defeat', [MATCH_OUTCOME.TIE]: 'Match tied' }[decided];
    return { [ROUND_RESULT.WON]: 'Round won', [ROUND_RESULT.LOST]: 'Round lost', [ROUND_RESULT.DRAWN]: 'Round drawn' }[result];
  };
  const onEnd = (end) => {
    const next = recordRound(match, resultOf(end));
    app.go('paigow', { match: next, view: outcome(next) ? 'final' : 'scoreboard' });
  };
  const battle = new Battle(app, {
    setup,
    meInfo: personInfo(null, 'You'),
    oppInfo: personInfo(opponent),
    subtitle: `Round ${setup.encounter.round + 1} · ${won}–${lost}`,
    onEnd,
    fastForward: true,
    resultText,
  });
  window.planeswalker.battle = battle;
  return {
    el: battle.el,
    enter: () => battle.start(),
    destroy: () => battle.destroy(),
  };
}
