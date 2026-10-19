# Planeswalker

A single-player game built on a subset of the Magic: The Gathering rules, written in plain
JavaScript (ES modules, no build step) and hosted on GitHub Pages.

So far the engine models the **turn structure** (phases and steps), **priority**, the **stack**,
**mana pools**, **life totals**, and **combat**. There are two cards: **Forest** and **Llanowar
Elves** (a 1/1 for {G} with "{T}: Add {G}."). Each player starts at 20 life with a 40-card deck
of 20 Forests and 20 Elves, shuffles it, and draws 7 cards.

Players can pass priority, play a land, cast creatures, activate abilities, declare attackers and
blockers, divide combat damage, and discard when the cleanup step asks them to.

**Artifacts, enchantments, Auras and Equipment** are implemented too, with targeting,
attachments and "enchanted/equipped creature gets +N/+N and has …" bonuses. The debugger has an
*Artifacts & enchantments sampler* deck (`SAMPLE_PERMANENTS` / `SAMPLE_PERMANENTS_DECK`) to try
them.

**Where this game differs from Magic:** each player has innate planeswalker-style abilities,
granted by **emblems** in the command zone. Instead of loyalty, the abilities cost life, mana,
or nothing. For now every player starts with one emblem, **Planeswalker**, with
"0: You gain 1 life." See *Emblems* below.

The combat keywords **haste, first strike, double strike, trample, menace, deathtouch, flying,
reach, lifelink, defender and vigilance** are implemented. No real card has them yet, so a
40-card **keyword sampler** deck (`SAMPLE_CARDS` / `SAMPLE_DECK`: 18 Forests and two each of
eleven {G} creatures, one per keyword) can be picked in the debugger.

- `index.html`: landing page
- `debug/`: engine debugger, which lets you play both sides, watch every event, and inspect state

## Running locally

ES modules have to be served over HTTP, so opening the files directly won't work:

```sh
npm run serve        # python3 -m http.server 8000
# open http://localhost:8000/debug/
npm test             # node --test (Node 18+)
```

## Importing cards from Scryfall

`tools/import-cards.js` is a Node command-line tool (Node 18+, no dependencies) that pulls card
definitions from the [Scryfall API](https://scryfall.com/docs/api) into
`src/cards/importedCards.js`. That file is merged into `CARDS`. The site never loads anything
from `tools/`.

```sh
npm run import-cards -- "Serra Angel" "Vampire Nighthawk"
npm run import-cards -- --file my-cards.txt                # one name per line, # for comments
npm run import-cards -- --query "set:fdn t:creature c:g"   # any Scryfall search
npm run import-cards -- --dry-run "Birds of Paradise"      # report only, write nothing
```

A card is only imported if the engine supports everything it does:
- It's a single-faced creature, land, artifact or enchantment, with no supertype other than
  Basic.
- Its mana cost uses only generic and {W}{U}{B}{R}{G}{C} symbols.
- Its power and toughness are fixed numbers.
- Its rules text is only supported keywords, "{T}: Add …" mana abilities, and for Auras and
  Equipment "Enchant creature", "Enchanted/Equipped creature gets +N/+N and has …" and
  "Equip {N}".

Every other card is skipped, and the report says what isn't supported, for example:

```
Not imported — uses things the game doesn't support yet (2):
  - Birds of Paradise
      Unsupported rules text: "{T}: Add one mana of any color."
  - Thalia, Guardian of Thraben
      Unsupported supertype: Legendary.
      Unsupported rules text: "Noncreature spells cost {1} more to cast."
```

The exit code is 1 when anything was skipped or not found. Re-importing a card updates it. Cards
defined by hand in `src/cards/cards.js` (Forest, Llanowar Elves) aren't overwritten. The
importer's tests use hand-written card objects in Scryfall's format
(`test/fixtures/scryfallCards.js`), so they don't need network access.

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
import { Game, BasicAIController, passPriority, playLand, activateAbility, castSpell } from './src/index.js';

const game = new Game({
  players: [{ id: 'p1', name: 'You' }, { id: 'p2', name: 'Opponent' }],
  // decks: { p1: ['forest', ...] }, // optional; defaults to 20 Forests + 20 Llanowar Elves
  // seed: 42,                       // optional; makes shuffles reproducible
  // cards: { myCard: {...} },        // optional; extra card definitions (e.g. SAMPLE_CARDS)
  // shuffleLibraries: false,        // optional; keep decks in order (first 7 = opening hand)
});

game.on('state', (state) => {
  console.log(state.turn, state.phase, state.step, state.priorityPlayerId, state.validActions);
});
new BasicAIController({ game, playerId: 'p2', delayMs: 300 }); // listens to state, emits action

game.start();
game.dispatch(passPriority('p1'));                 // upkeep → precombat main
game.dispatch(playLand('p1', 'p1-3'));             // card ids are `${ownerId}-${n}`
game.dispatch(activateAbility('p1', 'p1-3', 'tapForG'));
game.dispatch(castSpell('p1', 'p1-7'));            // a Llanowar Elves in hand
```

### Actions

| Action | Valid when |
| --- | --- |
| `{ type: 'PASS_PRIORITY', playerId }` | the player has priority |
| `{ type: 'PLAY_LAND', playerId, cardId }` | it's the player's main phase, they have priority, the stack is empty, and they haven't played a land this turn. There is one entry per land in their hand |
| `{ type: 'ACTIVATE_ABILITY', playerId, cardId, abilityId, targets? }` | the player has priority, controls the permanent or emblem (`cardId` is its id), and can pay the ability's cost (e.g. it's untapped for a {T} cost, and there's enough mana in their pool). Emblem abilities also respect their timing and per-turn limit. There is one entry per ability that can be activated, and one per legal target for abilities that target (e.g. equip) |
| `{ type: 'CAST_SPELL', playerId, cardId, targets? }` | sorcery timing (the player's main phase, with priority and an empty stack) and the mana cost is already in their pool. There is one entry per castable card; an Aura has one entry per creature it could enchant, with `targets: [creatureId]` |
| `{ type: 'TOGGLE_ATTACKER', playerId, cardId }` | declare attackers step (`pendingDecision.type === 'declareAttackers'`): adds the creature to, or removes it from, `pendingDecision.attackers`. There is one entry per creature that can attack |
| `{ type: 'CONFIRM_ATTACKERS', playerId }` | declare attackers step: locks in the attack, which can be empty |
| `{ type: 'SET_BLOCKER', playerId, cardId, attackerId }` | declare blockers step (`'declareBlockers'`): the creature blocks that attacker, or blocks nothing when `attackerId` is `null`. Updates `pendingDecision.blocks` |
| `{ type: 'CONFIRM_BLOCKERS', playerId }` | declare blockers step: locks in the blocks |
| `{ type: 'ASSIGN_COMBAT_DAMAGE', playerId, attackerId, assignment }` | a combat damage step (`'assignCombatDamage'`), when an attacker has more than one legal split: several blockers, or trample. `assignment` maps blocker ids (and, with trample, the defending player's id) to damage. There is one entry per legal split |
| `{ type: 'DISCARD', playerId, cardId }` | the cleanup step is waiting for the active player to discard down to 7 (`state.pendingDecision`). There is one entry per card in their hand |

An action is accepted only if it equals one of `state.validActions`.

Attackers and blockers are declared one creature at a time and then confirmed, rather than in a
single action. That way every choice is a concrete entry in `validActions`: listing every
possible set of attackers or blocks up front could run to thousands of entries. The declaration
counts once it's confirmed.

### State

The `state` event payload includes `players[]`, each with `life`, `library`, `hand`, `graveyard`,
`manaPool` (`{ W, U, B, R, G, C }`), `landsPlayedThisTurn` and `hasLost`. It also includes:
- `battlefield`: permanents carry `controllerId`, `tapped`, `summoningSick`, `damage`,
  `damagedByDeathtouch`, `abilities` and `keywords`, and creatures also carry `power` and
  `toughness`
- `stack`: spells and abilities; the last element is the top
- `combat`: `declaredAttackers` (ids), and `attackers: [{ cardId, defendingPlayerId, blocked, blockerIds, damageAssignment }]`
- `pendingDecision` `status` (`notStarted` / `inProgress` /
`gameOver`), `winnerId`, and the turn and priority fields.

The state is deliberately not filtered per player: libraries (in order) and every hand are
included. The game is single-player and runs entirely in the browser, so there is no one to hide
information from, and the UI decides what to show.

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
| `spellCast` / `permanentEntered` | `playerId`, `cardId`, `manaPaid`, `stackObjectId` / `card` | a spell is cast / resolves onto the battlefield |
| `attackersDeclared` / `blockersDeclared` | `attackers`, `defendingPlayerId` / `blocks: [{ blockerId, attackerId }]` | a declaration is confirmed (or there was nothing to declare) |
| `combatDamageDealt` | `step`, `damage: [{ sourceId, targetPlayerId \| targetCardId, amount }]`, `lifeGained`, `life` | each combat damage step (first-strike and regular) |
| `creatureDied` | `cardId`, `cardName`, `controllerId`, `reason` (`lethalDamage` / `deathtouch` / `zeroToughness`) | a creature dies from a state-based action |
| `abilityActivated` | `playerId`, `cardId`, `abilityId`, `text`, `costPaid`, `usesStack`, `stackObjectId?` | an ability is activated and its cost is paid |
| `manaAdded` | `playerId`, `mana`, `manaPool` | mana is added to a pool |
| `stackObjectResolving` / `stackObjectResolved` | `stackObject` / `stackObjectId` | the top of the stack resolves |
| `manaPoolsEmptied` | `pools: [{ playerId, lost }]` | a step or phase ends with mana in a pool |
| `permanentsUntapped` | `playerId`, `cardIds` | untap step, if anything was tapped |
| `decisionRequired` | the new `pendingDecision` | a player must declare attackers or blockers, divide damage, or discard |
| `cardDiscarded` | `playerId`, `cardId` | a card is discarded |
| `drawFromEmptyLibrary` / `playerLost` / `gameEnded` | `playerId` / `reason` / `winnerId` | a player decks out |
| `actionAccepted` / `actionRejected` | `action` (+ `reason`) | an action is processed |
| `state` | full snapshot incl. `validActions`, `version` | the game is waiting for input |

`game.onAny((name, payload) => ...)` receives every event.

### Emblems (this game's planeswalker abilities)

Emblems are defined in `src/cards/emblems.js` and given to players with the `emblems` option
(default: `DEFAULT_EMBLEMS`, i.e. `['planeswalker']` for everyone). Each emblem appears in
`state.players[].emblems` with its abilities, `activationsPerTurn` and `activationsThisTurn`.

- Emblems live in the command zone (114.1) and can't be removed. In Magic, emblems only have
  static or triggered abilities. Here they can also have **activated abilities**, which work like
  a planeswalker's loyalty abilities (606.3):
  - **Sorcery timing** (`timing: 'sorcery'`): the player's own main phase, with an empty stack.
    Leave `timing` out to allow activation whenever the player has priority.
  - **Once per turn per emblem** (`activationsPerTurn: 1`): an emblem with several abilities
    allows one of them each turn, the way a planeswalker does. The count resets at the start of
    every turn.
  - They **use the stack**, so the opponent can respond.
- Costs can be nothing (`{}`), life (`{ life: 2 }`, payable only with at least that much life,
  119.4), mana (`{ mana: { G: 1 } }`), or a combination.
- They're activated with the normal `ACTIVATE_ABILITY` action, with the emblem's id
  (e.g. `p1-emblem-1`) as `cardId`.
- Effects: anything an ability can do, plus `{ type: 'gainLife', amount }`, which emits a
  `lifeGained` event.

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
- Activated abilities (602): the player needs priority and must be able to pay the whole cost.
  The cost (tapping and/or mana) is paid automatically. A non-mana ability goes on the stack, and
  the player who activated it gets priority (117.3c). When all players pass in succession with
  something on the stack, the top object resolves (117.4, 608). Then the active player gets
  priority (117.3b), and the step continues.
- Mana abilities (605): an ability that adds mana doesn't use the stack. It resolves as soon as
  it's activated (605.3b), and the player keeps priority. Forest's "{T}: Add {G}." works this
  way, so it never appears on the stack.
- Mana pools empty as each step and phase ends (500.4). When an ability's mana cost is paid,
  specific colors are used first; any generic part is then paid from colorless mana, then
  colored.
- Casting creatures: only with sorcery timing (302.1, 307.1). The card moves to the stack and
  its mana cost is paid from the pool (601.2). Mana has to be in the pool before casting:
  activating mana abilities partway through casting (601.2g) isn't modelled. When the spell
  resolves, the creature enters the battlefield (608.3).
- Summoning sickness (302.6): a creature can't attack, or use abilities with {T} in the cost,
  until its controller has controlled it since the start of their most recent turn. It can
  still block.
- Combat (506–511):
  - In the declare attackers step, the active player chooses among untapped, non-sick creatures
    (508.1a). Attackers tap (508.1f), and in a two-player game they attack the other player.
  - The defending player blocks with untapped creatures (509.1a). Each blocker blocks one
    attacker, and an attacker can have several blockers.
  - An attacker blocked by more than one creature has its damage divided among them by the
    attacking player, in any split (510.1c, as of the Foundations rules update). All combat
    damage is dealt at once (510.2). Unblocked attackers damage the defending player, and a
    blocked attacker whose blockers are gone deals no damage.
  - If nobody attacks, the declare blockers and combat damage steps are skipped (508.8).
    Creatures leave combat as the end of combat step ends (511.3).
  - Keywords (702):
    - **Haste:** the creature can attack and use {T} abilities despite summoning sickness (702.10).
    - **Defender:** the creature can't attack (702.3).
    - **Vigilance:** attacking doesn't tap the creature (702.20).
    - **Flying:** only creatures with flying or reach can block it (702.9, 702.17).
    - **Menace:** it can't be blocked by just one creature (702.111). Each `SET_BLOCKER` is offered
      on its own, but `CONFIRM_BLOCKERS` only appears once no menace attacker has exactly one
      blocker.
    - **First strike:** if any attacking or blocking creature has first strike or double strike,
      there's an extra first-strike damage step before the regular one. Players get priority in
      between (510.4).
    - **Double strike:** the creature deals damage in both the first-strike and regular damage
      steps (702.4). A blocked double striker whose blockers died in the first step deals no
      more damage, unless it has trample.
    - **Trample:** the attacker can assign damage to the player only after every blocker is
      assigned lethal damage. That counts damage already marked, and deathtouch makes 1 lethal
      (702.19). If all its blockers are gone, all its damage goes to the player.
    - **Deathtouch:** any damage it deals to a creature destroys it, as a state-based action
      (702.2, 704.5h).
    - **Lifelink:** damage it deals also gains its controller that much life (702.15).
  - Damage assignment: for each attacker, the engine works out every legal split. When there's
    more than one, the attacking player chooses (`ASSIGN_COMBAT_DAMAGE`); when there's exactly
    one, it's applied automatically. Splits are keyed by blocker id, plus the defending player's
    id for trample.
  - Other keywords aren't implemented yet.
- Damage on creatures wears off in the cleanup step (514.2).
- Artifacts and enchantments (301, 303) are cast with sorcery timing and resolve onto the
  battlefield. Summoning sickness only affects creatures, so a noncreature artifact can use {T}
  abilities right away. An artifact creature is both types.
- Targets (115): spells and abilities that target list one valid action per legal target. When
  one resolves, its targets are checked again, and if they're all illegal it doesn't resolve
  (608.2b). A spell that doesn't resolve goes to its owner's graveyard (`stackObjectFizzled`).
  Target kinds so far: `creature` and `creatureYouControl`.
- Auras (303.4): "Enchant creature" Auras target a creature when cast and enter attached to it.
  An Aura that's attached to nothing, or to something it can't enchant, goes to its owner's
  graveyard (704.5m).
- Equipment (301.5): enters unattached. "Equip {N}" (702.6) is a sorcery-speed ability that
  targets a creature you control. It uses the stack and moves the Equipment if it's already
  attached. If the creature leaves, the Equipment stays on the battlefield, unattached (704.5n).
- Continuous effects (613): each permanent keeps its printed `base` power, toughness and
  keywords. The current values are recalculated whenever something enters, leaves, or is
  attached. So far the only effects are static abilities on attached Auras and Equipment
  (`affected: 'attachedPermanent'`), which add power, toughness and keywords. Combat and
  keyword rules use the recalculated values.
- State-based actions are checked before a player receives priority (117.5), and repeated until
  there are none left (704.3). Creatures with lethal damage or 0 toughness die (704.5f, 704.5g).
  A player loses at 0 life (704.5a), or after trying to draw from an empty library (704.5b). The
  game ends as soon as any player loses, because multiplayer elimination isn't modelled.

Cards are defined in `src/cards/cards.js` (by hand) and `src/cards/importedCards.js` (generated
from Scryfall, see above): a mana cost, types, power and toughness for creatures,
and activated abilities as data (`{ id, text, cost: { tap?, mana? }, effect }`). The supported
effects are `addMana` (which makes it a mana ability) and `drawCards`. Creatures can list
`keywords`. The tests add test-only cards through the `cards` option, including free (0-cost)
creatures for building combat scenarios.

The basic AI (`BasicAIController`, `strategy: 'basic'`) plays lands and casts Elves. It attacks
with everything when it has more creatures ready than the opponent has untapped blockers, and
otherwise blocks one-for-one to trade. It uses emblem abilities that cost nothing. It only makes legal blocks: flyers only with flying or
reach, and menace with two blockers or none. It casts artifacts and enchantments, puts Auras
only on its own creatures, equips loose Equipment, and taps enough mana for generic costs. With trample, it sends as much damage to the player
as it can. `strategy: 'passive'` only passes and makes empty
declarations.

The turn structure is defined as data in `src/engine/turnStructure.js`. Each step or main
phase records whether players get priority and can provide a `skip` rule.
