/**
 * The play history: what each player cast, activated, triggered, played and
 * attacked with, and what it targeted. Recorded from the engine's events as each
 * state arrives (before any animation is skipped), shown from the battle menu.
 */
import { h } from '../dom.js';
import { symbolText } from '../symbols.js';
import { findCard } from './describe.js';

/**
 * Entries: `{ turn, playerId, kind, source, text?, targets, note? }`, where
 * `targets` are `{ playerId }` or `{ name }`. Card names are taken when the play
 * happens, so they stay right after the card has left the battlefield.
 */
export class PlayHistory {
  entries = [];
  /** Names of cards and stack objects seen in the last state, for ones gone since. */
  #names = new Map();

  /** `events`: the `{ name, payload }`s that led to `state`. */
  record(events, state) {
    const playerIds = new Set(state.players.map((p) => p.id));
    const nameOf = (id) => {
      const card = findCard(state, id);
      return card?.name ?? card?.sourceName ?? this.#names.get(id) ?? 'something';
    };
    const target = (id) => (playerIds.has(id) ? { playerId: id } : { name: nameOf(id) });
    const add = (entry) => this.entries.push({ turn: state.turn, targets: [], ...entry });
    const bySpell = (stackObjectId) => this.entries.findLast((e) => e.stackObjectId === stackObjectId);

    for (const { name, payload } of events) {
      switch (name) {
        case 'landPlayed':
          add({ playerId: payload.playerId, kind: 'land', source: payload.card.name });
          break;
        case 'spellCast':
          add({
            playerId: payload.playerId, kind: 'spell', source: payload.cardName,
            stackObjectId: payload.stackObjectId, targets: payload.targets.map(target),
          });
          break;
        case 'abilityActivated':
          // Mana abilities are too many and too small to list.
          if (!payload.usesStack) break;
          add({
            playerId: payload.playerId, kind: 'ability', source: payload.cardName, text: payload.text,
            stackObjectId: payload.stackObjectId, targets: payload.targets.map(target),
          });
          break;
        case 'triggeredAbilityPutOnStack': {
          const object = state.stack.find((o) => o.id === payload.stackObjectId);
          add({
            playerId: object?.controllerId, kind: 'trigger', source: object?.sourceName ?? nameOf(payload.sourceId),
            text: object?.text, stackObjectId: payload.stackObjectId, targets: payload.targets.map(target),
          });
          break;
        }
        case 'attackersDeclared':
          if (!payload.attackers.length) break;
          add({
            playerId: payload.playerId, kind: 'attack', source: payload.attackers.map(nameOf).join(', '),
            targets: [{ playerId: payload.defendingPlayerId }],
          });
          break;
        case 'blockersDeclared':
          for (const { blockerId, attackerId } of payload.blocks) {
            add({ playerId: payload.playerId, kind: 'block', source: nameOf(blockerId), targets: [{ name: nameOf(attackerId) }] });
          }
          break;
        case 'spellCountered': {
          const entry = bySpell(payload.stackObjectId);
          if (entry) entry.note = 'Countered';
          break;
        }
        case 'stackObjectFizzled': {
          const entry = bySpell(payload.stackObjectId);
          if (entry) entry.note = 'No legal targets';
          break;
        }
        default:
      }
    }
    this.#remember(state);
  }

  #remember(state) {
    for (const permanent of state.battlefield) this.#names.set(permanent.id, permanent.name);
    for (const object of state.stack) {
      this.#names.set(object.id, object.card?.name ?? object.sourceName);
      if (object.card) this.#names.set(object.card.id, object.card.name);
    }
  }
}

const VERB = {
  land: 'Played', spell: 'Cast', ability: 'Activated', trigger: 'Triggered', attack: 'Attacked with', block: 'Blocked with',
};

/**
 * The history as a list grouped by turn, oldest first. `nameOfPlayer(id)`: a
 * player's display name (e.g. "You" or the opponent's name).
 */
export function historyView(entries, { me, nameOfPlayer }) {
  if (!entries.length) return h('p.sheet-text', 'Nothing has been played yet.');
  const targetName = (t) => (t.playerId ? nameOfPlayer(t.playerId) : t.name);
  const targetLine = (e) => {
    const names = e.targets.map(targetName).join(', ');
    if (e.kind === 'attack') return `→ ${names}`;
    if (e.kind === 'block') return `Blocking ${names}`;
    return `Target: ${names}`;
  };
  const turns = [];
  for (const entry of entries) {
    const last = turns.at(-1);
    if (last?.turn === entry.turn) last.entries.push(entry);
    else turns.push({ turn: entry.turn, entries: [entry] });
  }
  return h('div.history', turns.map(({ turn, entries: list }) => h('section.history-turn',
    h('h4', turn ? `Turn ${turn}` : 'Before the game'),
    list.map((e) => h('div.history-entry', { class: e.playerId === me ? 'me' : 'opp' },
      h('span.history-who', nameOfPlayer(e.playerId)),
      h('div.history-what',
        h('div', h('span.history-verb', `${VERB[e.kind]} `), h('b', e.source),
          e.note ? h('span.history-note', ` — ${e.note}`) : null),
        e.text ? h('div.history-text', symbolText(e.text)) : null,
        e.targets.length ? h('div.history-targets', targetLine(e)) : null))))));
}
