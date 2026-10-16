# Planeswalker

A single-player game built on a subset of the Magic: The Gathering rules, written in plain
JavaScript (ES modules, no build step) and hosted on GitHub Pages.

So far the engine models the **turn structure** (phases and steps), **priority**, a library,
hand, battlefield and graveyard for each player, and one card: **Forest**. Each player starts with
a deck of 10 Forests, shuffles it, and draws 7 cards. Players can **pass priority**, **play a land**,
and **discard** when the cleanup step asks them to.

- `index.html`: landing page
- `debug/`: engine debugger, which lets you play both sides, watch every event, and inspect state

## Running locally

ES modules have to be served over HTTP, so opening the files directly won't work:

```sh
npm run serve        # python3 -m http.server 8000
# open http://localhost:8000/debug/
npm test             # node --test (Node 18+)
```

## GitHub Pages

The site is served from the root of the `main` branch. To turn it on, go to
**Settings → Pages → Build and deployment**, pick **Deploy from a branch**, then choose
`main` and `/ (root)`. The `.nojekyll` file makes Pages serve the files as they are.

## Engine architecture

```
           action events                          state + transition events
 controller ───────────────▶  Game (EventEmitter)  ───────────────────────────▶ UI / AI / logs
 (UI, AI)   ◀───────────────────────────────────────────────────────────────── (listeners)
                          state.validActions tells each controller what it may do
```

The `Game` emits events and also listens for them:

- **Output:** a `state` event every time the game stops to wait for input. Its payload is a full
  snapshot (a deep copy) that includes `validActions`, so a client can be built entirely from
  `state` events: show a button for each valid action and send it back unchanged.
- **Input:** `game.dispatch(action)`, or `game.listenTo(emitter)`, which dispatches every `action`
  event the emitter emits. An action dispatched from inside a listener is queued and runs once
  the current action has finished, so listeners never re-enter the engine.

```js
import { Game, BasicAIController, passPriority, playLand } from './src/index.js';

const game = new Game({
  players: [{ id: 'p1', name: 'You' }, { id: 'p2', name: 'Opponent' }],
  // decks: { p1: ['forest', ...] }, // optional; defaults to 10 Forests each
  // seed: 42,                       // optional; makes shuffles reproducible
});

game.on('state', (state) => {
  console.log(state.turn, state.phase, state.step, state.priorityPlayerId, state.validActions);
});
new BasicAIController({ game, playerId: 'p2', delayMs: 300 }); // listens to state, emits action

game.start();
game.dispatch(passPriority('p1'));                 // upkeep → precombat main
game.dispatch(playLand('p1', 'p1-3'));             // card ids are `${ownerId}-${n}`
```

### Actions

| Action | Valid when |
| --- | --- |
| `{ type: 'PASS_PRIORITY', playerId }` | the player has priority |
| `{ type: 'PLAY_LAND', playerId, cardId }` | it's the player's main phase, they have priority, the stack is empty, and they haven't played a land this turn. There is one entry per land in their hand |
| `{ type: 'DISCARD', playerId, cardId }` | the cleanup step is waiting for the active player to discard down to 7 (`state.pendingDecision`). There is one entry per card in their hand |

An action is accepted only if it matches one of `state.validActions` field for field.

### State

The `state` event payload includes `players[]`, each with `library`, `hand`, `graveyard`,
`landsPlayedThisTurn` and `hasLost`. It also includes `battlefield` (permanents carry
`controllerId` and `tapped`), `pendingDecision`, `status` (`notStarted` / `inProgress` /
`gameOver`), `winnerId`, and the turn and priority fields. Hidden information isn't hidden yet:
the debugger shows everything.

### Events

Every payload carries a `seq` number that increases for each event the game emits.

| Event | Payload | When |
| --- | --- | --- |
| `gameStarted` | `players`, `startingPlayerId` | `start()` is called |
| `turnStarted` / `turnEnded` | `turn`, `activePlayerId` | turn boundaries |
| `phaseStarted` / `phaseEnded` | `phase`, `phaseName`, ... | phase boundaries |
| `stepStarted` / `stepEnded` | `step`, `stepName`, ... | step boundaries (main phases have no steps) |
| `stepSkipped` | `step`, `stepName`, ... | a step is skipped (see below) |
| `priorityGranted` | `playerId` | a player receives priority |
| `priorityPassed` | `playerId` | a player passes priority |
| `libraryShuffled` | `playerId` | at game start |
| `cardsDrawn` | `playerId`, `cardIds`, `librarySize` | opening hand, draw step |
| `landPlayed` | `playerId`, `card` | a land enters the battlefield |
| `permanentsUntapped` | `playerId`, `cardIds` | untap step, if anything was tapped |
| `decisionRequired` | `type`, `playerId`, `count` | cleanup step: discard to hand size |
| `cardDiscarded` | `playerId`, `cardId` | a card is discarded |
| `drawFromEmptyLibrary` / `playerLost` / `gameEnded` | `playerId` / `reason` / `winnerId` | a player decks out |
| `actionAccepted` / `actionRejected` | `action` (+ `reason`) | an action is processed |
| `state` | full snapshot incl. `validActions`, `version` | the game is waiting for input |

`game.onAny((name, payload) => ...)` receives every event.

### Rules implemented

- The turn structure follows CR 500–514: beginning (untap, upkeep, draw), precombat main, combat
  (beginning of combat, declare attackers, declare blockers, combat damage, end of combat),
  postcombat main, and ending (end, cleanup).
- No player receives priority during untap or cleanup (502.4, 514.3).
- The active player receives priority at the start of every other step and main phase (117.3a).
  After a pass, the next player in turn order receives it (117.3d).
- When all players pass in succession with an empty stack, the step or phase ends (117.4, 500.2).
- The player who goes first skips the draw step of turn 1 (103.8a).
- Declare blockers and combat damage are skipped when no creatures attack (508.8). For now,
  nothing can attack.
- Setup: each player shuffles (103.3) and draws an opening hand of 7 (103.5). Mulligans aren't
  implemented yet.
- Turn-based actions: the active player untaps their permanents (502.3), draws in the draw step
  (504.1), and discards down to the maximum hand size of 7 in cleanup (514.1, 402.2).
- Playing lands: a special action that doesn't use the stack (116.2a). The active player can do
  it in their main phase while they have priority and the stack is empty (305.1, 505.6b), once
  per turn (305.2). Afterwards the same player gets priority again (117.3c), and the run of
  passes starts over (117.4).
- State-based actions are checked before a player receives priority (117.5). A player who tried
  to draw from an empty library loses (704.5b). The game ends as soon as any player loses,
  because multiplayer elimination isn't modelled.

Cards are defined in `src/cards/cards.js`. Forest's mana ability is listed in its text but
doesn't work yet, because mana isn't implemented.

The turn structure is defined as data in `src/engine/turnStructure.js`. Each step or main
phase records whether players get priority and can provide a `skip` rule.
