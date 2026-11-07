import { h } from '../dom.js';
import { icon } from '../icons.js';
import { loadRun, clearRun } from '../../src/campaign/save.js';
import { RUN_PHASE } from '../../src/campaign/campaign.js';

export function titleScreen(app) {
  const run = loadRun(app.storage, app.content);
  const live = run && run.phase !== RUN_PHASE.VICTORY && run.phase !== RUN_PHASE.OVER;
  const newRun = async () => {
    if (live && !(await app.overlays.confirm({ title: 'Start a new run?', text: 'Your current run will be abandoned.', yes: 'New run', danger: true }))) return;
    clearRun(app.storage);
    app.go('newRun');
  };
  const el = h('div',
    h('div.title-sky', h('div.title-glow'), h('div.title-motes')),
    h('div.title-main',
      h('div.logo', h('span.logo-small', 'The'), h('span.logo-big', 'Planeswalker')),
      h('p.tagline', 'Climb the planes. Defeat the Overlord.'),
      h('div.menu',
        live ? h('button.btn.primary.big', { onclick: () => app.go('runMap') }, 'Continue run') : null,
        h(`button.btn.big${live ? '' : '.primary'}`, { onclick: newRun }, 'New run'),
        h('button.btn.big', { onclick: () => app.go('quickMatch') }, 'Quick match'))),
    h('footer.title-foot',
      h('button.icon-btn', { onclick: () => app.overlays.settings(), 'aria-label': 'Settings' }, icon('gear')),
      h('a.debug-link', { href: 'debug/' }, 'Engine debugger')));
  return { el };
}
