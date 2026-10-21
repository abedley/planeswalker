import { h, wait } from '../dom.js';
import { fullCard, cardBack } from '../cardView.js';
import { loadRun, saveRun } from '../../src/campaign/save.js';
import { chooseReward, skipReward, REWARD, RUN_PHASE } from '../../src/campaign/campaign.js';
import { icon } from '../icons.js';
import { powerFace } from './common.js';

/** After a win: the offers are dealt face down and flipped; pick one (or skip). */
export function rewardScreen(app) {
  const { content } = app;
  const run = loadRun(app.storage, content);
  if (!run || run.phase !== RUN_PHASE.REWARD) {
    queueMicrotask(() => app.go(run ? 'runMap' : 'title'));
    return { el: h('div') };
  }
  let chosen = null;

  const faceFor = (offer) => {
    if (offer.kind === REWARD.CARD) return fullCard({ ...app.definitions[offer.cardId], id: offer.cardId, cardId: offer.cardId }, app.definitions);
    if (offer.kind === REWARD.POWER) return powerFace(content.powers[offer.powerId], content);
    return h('div.card-face.power-face.remove-face', h('div.cf-top', h('span.cf-name', 'Trim the deck')),
      h('div.power-glyph', icon('minus')), h('div.cf-type', 'Remove a card'), h('div.cf-text', 'Remove one card of your choice from your deck.'));
  };

  const take = h('button.btn.primary.big', { disabled: true, onclick: () => confirmChoice() }, 'Choose a reward');
  const offers = run.offers.map((offer, index) => {
    const el = h('button.offer', { dataset: { index } },
      h('div.offer-inner', h('div.offer-front', faceFor(offer)), h('div.offer-back', cardBack())),
      h('div.offer-kind', offer.kind === REWARD.CARD ? 'New card' : offer.kind === REWARD.POWER ? 'Power' : 'Deck'));
    el.addEventListener('click', () => {
      chosen = index;
      app.sound('select');
      for (const other of offers) other.classList.toggle('chosen', other === el);
      take.disabled = false;
      take.textContent = offer.kind === REWARD.REMOVE_CARD ? 'Choose a card to remove' : 'Take it';
    });
    let timer = null;
    el.addEventListener('pointerdown', () => {
      timer = setTimeout(() => {
        if (offer.kind === REWARD.CARD) app.overlays.inspect({ ...app.definitions[offer.cardId], id: offer.cardId, cardId: offer.cardId });
      }, 450);
    });
    el.addEventListener('pointerup', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => clearTimeout(timer));
    return el;
  });

  function confirmChoice() {
    if (chosen === null) return;
    const offer = run.offers[chosen];
    const finish = (next) => {
      saveRun(app.storage, next);
      app.sound('reward');
      app.go('runMap');
    };
    if (offer.kind === REWARD.REMOVE_CARD) {
      app.overlays.deck(run.deck, { title: 'Remove a card', pickLabel: 'Tap the card to remove.', onPick: (cardId) => finish(chooseReward(run, content, chosen, { cardId })) });
      return;
    }
    finish(chooseReward(run, content, chosen));
  }

  const el = h('div',
    h('div.reward-head', h('div.reward-title', 'Victory'), h('div.reward-sub', 'Choose your reward')),
    h('div.offers', offers),
    h('div.cta', take, h('button.btn.ghost', {
      onclick: async () => {
        if (await app.overlays.confirm({ title: 'Skip the reward?', yes: 'Skip' })) {
          saveRun(app.storage, skipReward(run, content));
          app.go('runMap');
        }
      },
    }, 'Skip')));

  return {
    el,
    async enter() {
      // Deal, then flip one by one.
      offers.forEach((offer, i) => offer.animate(
        [{ transform: 'translateY(60vh) rotate(-8deg)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 420, delay: i * 110, easing: 'cubic-bezier(.2,.9,.3,1.1)', fill: 'backwards' },
      ));
      await wait(420 + offers.length * 110);
      for (const [i, offer] of offers.entries()) {
        await wait(i ? 160 : 0);
        app.sound('draw');
        offer.classList.add('revealed');
      }
    },
  };
}
