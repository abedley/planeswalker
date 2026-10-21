import { h } from '../dom.js';
import { icon } from '../icons.js';
import { crest } from '../art.js';
import { loadRun, saveRun, clearRun } from '../../src/campaign/save.js';
import { retryFight, skipFight, canSkipFight } from '../../src/campaign/campaign.js';
import { hearts, personInfo } from './common.js';

/**
 * After a fight that doesn't lead to a reward: a lost fight (retry or skip), the
 * run won or over, or a quick match's result.
 */
export function resultScreen(app, { kind }) {
  const { content } = app;
  const run = loadRun(app.storage, content);
  const walker = run ? content.planeswalkers[run.planeswalkerId] : null;
  const opponent = run?.encounter ? content.opponents[run.encounter.opponentId] : null;

  const stats = run ? h('div.run-summary',
    h('div', `${run.history.filter((x) => x.result === 'won').length} fights won`),
    h('div', `${run.deck.length} cards in deck`),
    h('div', `${run.powers.length} powers gained`)) : null;

  const views = {
    defeat: () => [
      h('div.result-title.defeat', 'Defeat'),
      opponent ? h('div.result-who', crest(personInfo(opponent), { size: 'lg' }), h('div', `${opponent.name} wins this time.`)) : null,
      h('div.result-lives', hearts(run.lives), h('div', `${run.lives} ${run.lives === 1 ? 'life' : 'lives'} left`)),
      h('div.cta',
        h('button.btn.primary.big', {
          onclick: () => {
            saveRun(app.storage, retryFight(run));
            app.go('battle', { mode: 'run' });
          },
        }, 'Retry'),
        canSkipFight(run, content) ? h('button.btn.big', {
          onclick: () => {
            saveRun(app.storage, skipFight(run, content));
            app.go('runMap');
          },
        }, 'Skip fight') : h('div.note', 'The boss can\'t be skipped.'),
        h('button.btn.ghost', { onclick: () => app.go('runMap') }, 'Back to map')),
    ],
    runWon: () => [
      h('div.result-title.victory', icon('crown'), 'Champion'),
      walker ? h('div.result-who', crest(personInfo(walker), { size: 'xl' }), h('div', `${walker.name} has conquered the planes.`)) : null,
      stats,
      h('div.cta', h('button.btn.primary.big', { onclick: () => { clearRun(app.storage); app.go('newRun'); } }, 'New run'),
        h('button.btn.ghost', { onclick: () => { clearRun(app.storage); app.go('title'); } }, 'Title')),
    ],
    runOver: () => [
      h('div.result-title.defeat', 'Run over'),
      walker ? h('div.result-who', crest(personInfo(walker), { size: 'xl' }), h('div', 'Out of lives.')) : null,
      stats,
      h('div.cta', h('button.btn.primary.big', { onclick: () => { clearRun(app.storage); app.go('newRun'); } }, 'Try again'),
        h('button.btn.ghost', { onclick: () => { clearRun(app.storage); app.go('title'); } }, 'Title')),
    ],
    quickWon: () => [h('div.result-title.victory', 'Victory'), h('div.cta', h('button.btn.primary.big', { onclick: () => app.go('quickMatch') }, 'Play again'), h('button.btn.ghost', { onclick: () => app.go('title') }, 'Title'))],
    quickLost: () => [h('div.result-title.defeat', 'Defeat'), h('div.cta', h('button.btn.primary.big', { onclick: () => app.go('quickMatch') }, 'Play again'), h('button.btn.ghost', { onclick: () => app.go('title') }, 'Title'))],
  };
  const el = h('div', h('div.result-body', (views[kind] ?? views.quickLost)()));
  return {
    el,
    enter() {
      const title = el.querySelector('.result-title');
      title?.animate([{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 500, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    },
  };
}
