/**
 * The Planeswalker app: one page, several screens (title, new run, run map,
 * battle, rewards, results), for phones held upright.
 */
import { CARDS } from '../src/cards/cards.js';
import { SAMPLE_CAMPAIGN } from '../src/campaign/sampleCampaign.js';
import { h, wait } from './dom.js';
import { installIcons } from './icons.js';
import { unlockAudio, setSoundEnabled, play } from './audio.js';
import { createOverlays } from './overlays.js';
import { titleScreen } from './screens/title.js';
import { newRunScreen } from './screens/newRun.js';
import { runMapScreen } from './screens/runMap.js';
import { battleScreen } from './screens/battle.js';
import { rewardScreen } from './screens/reward.js';
import { resultScreen } from './screens/result.js';
import { quickMatchScreen } from './screens/quickMatch.js';

const SETTINGS_KEY = 'planeswalker.settings';
const DEFAULT_SETTINGS = { sound: true, speed: 1, autoPass: true };

const SCREENS = {
  title: titleScreen,
  newRun: newRunScreen,
  runMap: runMapScreen,
  battle: battleScreen,
  reward: rewardScreen,
  result: resultScreen,
  quickMatch: quickMatchScreen,
};

/** localStorage, or a stand-in when it's unavailable (private mode, blocked). */
function safeStorage() {
  try {
    const probe = '__pw';
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    const items = new Map();
    return {
      getItem: (k) => (items.has(k) ? items.get(k) : null),
      setItem: (k, v) => items.set(k, String(v)),
      removeItem: (k) => items.delete(k),
    };
  }
}

function createApp(root) {
  const storage = safeStorage();
  let settings = DEFAULT_SETTINGS;
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch { /* defaults */ }
  setSoundEnabled(settings.sound);

  const stage = h('div.stage');
  root.append(stage);
  let current = null;

  const app = {
    root,
    content: SAMPLE_CAMPAIGN,
    /** Every card definition, for art and text lookups by `cardId`. */
    definitions: { ...CARDS, ...SAMPLE_CAMPAIGN.cards },
    storage,
    get settings() { return settings; },
    updateSettings(changes) {
      settings = { ...settings, ...changes };
      storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      setSoundEnabled(settings.sound);
    },
    sound: play,
    /** Shows a screen; the old one fades out as the new one fades in. */
    async go(name, params = {}) {
      performance.mark(`go:${name}`);
      app.overlays?.close();
      const previous = current;
      const next = SCREENS[name](app, params);
      current = next;
      next.name = name;
      next.el.classList.add('screen', `screen-${name}`);
      stage.append(next.el);
      next.el.animate([{ opacity: 0, transform: 'scale(1.02)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
      if (previous) {
        previous.destroy?.();
        previous.el.style.pointerEvents = 'none';
        await previous.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished.catch(() => {});
        previous.el.remove();
      }
      if (current === next) next.enter?.();
    },
  };
  app.overlays = createOverlays(app);
  return app;
}

function boot() {
  installIcons();
  const root = document.getElementById('app');
  const app = createApp(root);
  window.planeswalker = app;
  // Sound needs a user gesture to start.
  window.addEventListener('pointerdown', unlockAudio, { capture: true });
  // No pinch or double-tap zoom on iOS.
  document.addEventListener('gesturestart', (event) => event.preventDefault());
  document.addEventListener('dblclick', (event) => event.preventDefault());
  app.go('title');
  if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    wait(2000).then(() => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}

boot();
