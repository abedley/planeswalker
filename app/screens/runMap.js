import { h } from '../dom.js';
import { icon } from '../icons.js';
import { crest } from '../art.js';
import { loadRun, saveRun } from '../../src/campaign/save.js';
import { RUN_PHASE, runProgress, retryFight, skipFight, canSkipFight } from '../../src/campaign/campaign.js';
import { header, personInfo, difficultyOf, difficultyPips, hearts } from './common.js';

/** The ladder of tiers up to the boss, the run's state, and the next fight. */
export function runMapScreen(app) {
  const { content } = app;
  let run = loadRun(app.storage, content);
  if (!run) {
    queueMicrotask(() => app.go('title'));
    return { el: h('div') };
  }
  if (run.phase === RUN_PHASE.REWARD) {
    queueMicrotask(() => app.go('reward'));
    return { el: h('div') };
  }
  if (run.phase === RUN_PHASE.VICTORY || run.phase === RUN_PHASE.OVER) {
    queueMicrotask(() => app.go('result', { kind: run.phase === RUN_PHASE.VICTORY ? 'runWon' : 'runOver' }));
    return { el: h('div') };
  }

  const walker = content.planeswalkers[run.planeswalkerId];
  const progress = runProgress(run, content);
  const opponent = content.opponents[run.encounter.opponentId];
  const tier = progress.tier;
  const abilities = run.emblems.flatMap((id) => content.emblems?.[id]?.abilities ?? []);

  const ladder = h('div.ladder', [...content.ladder].map((t, i) => ({ t, i })).reverse().map(({ t, i }) => {
    const state = i < run.tierIndex ? 'done' : i === run.tierIndex ? 'now' : 'later';
    const dots = Array.from({ length: t.fights }, (_, f) => h(`span.fdot${i < run.tierIndex || (i === run.tierIndex && f < run.fightIndex) ? '.done' : i === run.tierIndex && f === run.fightIndex ? '.now' : ''}`));
    return h(`div.rung.${state}${t.boss ? '.boss' : ''}`,
      h('div.node', t.boss ? icon('crown') : i < run.tierIndex ? icon('check') : String(i + 1)),
      h('div.rung-info', h('div.rung-name', t.name), h('div.fdots', dots)));
  }));

  const fight = () => {
    app.go('battle', { mode: 'run' });
  };
  const defeated = run.phase === RUN_PHASE.DEFEATED;
  const retry = () => {
    run = retryFight(run);
    saveRun(app.storage, run);
    app.go('battle', { mode: 'run' });
  };
  const skip = async () => {
    if (!(await app.overlays.confirm({ title: 'Skip this fight?', text: 'You move on without a reward.', yes: 'Skip' }))) return;
    run = skipFight(run, content);
    saveRun(app.storage, run);
    app.go('runMap');
  };

  const next = h(`div.next-fight${tier.boss ? '.boss' : ''}`,
    h('div.next-label', defeated ? 'Defeated by' : tier.boss ? 'The final battle' : `${tier.name} · fight ${progress.fight + 1} of ${progress.fights}`),
    h('div.next-who', crest(personInfo(opponent), { size: 'lg' }),
      h('div.next-text', h('div.next-name', opponent.name), difficultyPips(difficultyOf(opponent, tier.boss)),
        opponent.startingLife ? h('div.next-life', icon('heart'), ` ${opponent.startingLife} life`) : null)),
    defeated
      ? h('div.row', canSkipFight(run, content) ? h('button.btn.big', { onclick: skip }, 'Skip') : null, h('button.btn.primary.big', { onclick: retry }, 'Retry'))
      : h('button.btn.primary.big.fight-btn', { onclick: fight }, icon('sword'), tier.boss ? ' Face the boss' : ' Fight'));

  const el = h('div',
    header({
      title: walker.name,
      onBack: () => app.go('title'),
      right: h('button.icon-btn', { onclick: () => app.overlays.settings({ extra: [{ label: 'Abandon run', danger: true, onPick: () => abandon() }] }), 'aria-label': 'Settings' }, icon('gear')),
    }),
    h('div.run-status',
      crest(personInfo(walker), { size: 'md' }),
      h('div.run-facts',
        hearts(run.lives),
        h('button.chip-btn', { onclick: () => app.overlays.deck(run.deck, { title: 'Your deck' }) }, icon('cards'), ` ${run.deck.length} cards`),
        h('span.chip-btn', icon('heart'), ` ${run.startingLife} life`)),
      h('div.run-abilities', abilities.map((a) => h('div.ability-line', a.text)))),
    ladder, next);

  async function abandon() {
    if (!(await app.overlays.confirm({ title: 'Abandon this run?', text: 'Your progress will be lost.', yes: 'Abandon', danger: true }))) return;
    app.storage.removeItem('planeswalker.campaign.run');
    app.go('title');
  }

  return {
    el,
    enter() {
      el.querySelector('.rung.now')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
  };
}
