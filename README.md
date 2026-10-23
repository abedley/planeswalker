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

**Instants and sorceries** are implemented, with damage, destroy, "+N/+N until end of turn",
draw and gain-life effects. Instants can be cast in response to other spells. Try the
*Instants & sorceries sampler* deck (`SAMPLE_SPELLS` / `SAMPLE_SPELLS_DECK`) in the debugger.

**Common costs and effects** work for spells, activated abilities and emblems alike:
- Costs: {T}, mana, paying life, "Sacrifice this", "Sacrifice a creature/artifact/…" and
  "Discard a card". Spells can have additional costs ("As an additional cost to cast this spell,
  sacrifice a creature.").
- Effects: damage, destroy, exile, return to hand, tap and untap, +N/+N until end of turn,
  +1/+1 counters, gain and lose life, draw, mill, tokens, counter target spell, and adding mana.
- Tokens: creature tokens, plus the predefined **Treasure**, **Food** and **Clue** artifact
  tokens (`{ type: 'createToken', count, token: 'treasure' }`, see `TOKEN` / `TOKENS`).
- Effects can apply to the target, to you, to each opponent, to each player, to each creature,
  to each creature you control, or to the ability's own source.

The *Costs & effects sampler* deck (`SAMPLE_EFFECTS` / `SAMPLE_EFFECTS_DECK`) shows them off.

**Triggered abilities:** "When this permanent enters, …" and "When this creature dies, …", with
any of the effects above. Try the *Triggered abilities sampler* deck (`SAMPLE_TRIGGERS` /
`SAMPLE_TRIGGERS_DECK`).

**Where this game differs from Magic:** each player has innate planeswalker-style abilities,
granted by **emblems** in the command zone. Instead of loyalty, the abilities cost life, mana,
or nothing. For now every player starts with one emblem, **Planeswalker**, with
"0: You gain 1 life." See *Emblems* below.

The combat keywords **haste, first strike, double strike, trample, menace, deathtouch, flying,
reach, lifelink, defender and vigilance** are implemented. No real card has them yet, so a
40-card **keyword sampler** deck (`SAMPLE_CARDS` / `SAMPLE_DECK`: 18 Forests and two each of
eleven {G} creatures, one per keyword) can be picked in the debugger.

**Campaign:** the game is a roguelite. You pick a planeswalker and a starting deck, then climb a
ladder of ever harder CPU opponents up to a boss, earning cards and planeswalker powers with each
win. The framework is in `src/campaign/`, with example content; see *Campaign* below.

- `index.html` + `app/`: **the game**, a single-page app for phones held upright (see *The app*)
- `debug/`: engine debugger, which lets you play both sides, watch every event, and inspect state

## Running locally

ES modules have to be served over HTTP, so opening the files directly won't work:

```sh
npm run serve        # python3 -m http.server 8000
# open http://localhost:8000/ (the game) or http://localhost:8000/debug/
npm test             # node --test (Node 18+)
```

## The app

`index.html` and `app/` are the game: one page, no build step, aimed at phones held upright
(designed on an iPhone 13 Pro, 390×844, and down to 390×664 with Safari's toolbars showing).
Add it to the home screen to play full screen; the service worker (`sw.js`) caches the app and
card images, so it then works offline. It's registered only when not on localhost, so local
edits show up on reload.

**Screens:** title → new run (a carousel of planeswalkers, then a starter deck) → run map (the
ladder, lives, deck, the next opponent) → battle → reward (offers dealt face down and flipped) or
defeat (retry or skip) → … → run won or over. There's also Quick Match, and a settings sheet
(sound, animation speed, auto-pass). The run is saved between fights.

**Playing:**
- **Whose turn:** the badge in the middle lane reads *Your turn* (gold) or *Opponent's turn*
  (red), with the turn number. The active side's half of the board and portrait glow in the
  same color. The prompt says *N attacking* only once the opponent has declared attackers.
- **Tap** a card in hand to see it big, at any time, even while the opponent is thinking or
  playing. A **Play** button appears when it can be played, and the preview stays open, updating,
  until you tap anywhere else (or the card again). **Drag** it
  up to play it, or, for a spell with a target, drag out an arrow and release on the target.
- **Mana is automatic:** a play is one tap. The app dry-runs it on a copy of the game, taps
  lands (and Elves, then Treasure) the way the AI would, and asks only about real choices: the
  target, or which creature to sacrifice.
- **Combat:** tap creatures to attack; to block, tap your creature, then an attacker.
- **Damage assignment** is a choice of which blockers die (`app/battle/damage.js`): splits
  with the same outcome are one choice (the one trampling over the most), and outcomes that
  kill less without dealing more are dropped. With one outcome left it just happens;
  otherwise each choice shows the blockers, the damage each takes, and a skull on those
  that die.
- **The main button** says what passing does: *End turn*, *Attack*, *Resolve*, *Pass*,
  *Attack (2)*, *No blocks*, *Deal damage*.
- **Auto-pass:** like MTG Arena's smart stops, the app passes priority for you unless you could
  act: your main phases, after blocks when you attack (to pump or remove a creature before
  damage), the opponent's spells, their attacks, after blocks, and their end step.
  Hold the main button for full control.
- **Long-press** any card to inspect it: real cards show their full Scryfall image, artist
  included. Tap anywhere to close it.
- **The opponent** thinks visibly (a ring around its portrait) only at moments that give nothing
  away, as described under *Search AI*.

**Screen limits:** fights use `GAME_LIMITS` (7 cards in hand, 10 creatures, 8 other permanents)
and planeswalkers have at most 4 abilities, so a whole board always fits. Lands are shown grouped
("Forest ×5, 3 ready"), and a side with more than five creatures switches to two rows.

**Art:** imported cards use Scryfall's images (`image.art` on the board and in hand, `image.card`
when inspecting). Cards without art, such as the samples and tokens, get generated art: a gradient
in their color with their type's emblem, and their name on the board. Planeswalkers and opponents
can have `art` and `color`; otherwise they get a monogram crest.

**Symbols:** mana costs, {T}, card types, keyword abilities and set symbols (in their rarity's
color) are drawn with the open-source [Mana](https://mana.andrewgioia.com) and
[Keyrune](https://keyrune.andrewgioia.com) fonts by Andrew Gioia, vendored in `app/vendor/`.
- **Size:** they're cut down to the glyphs the app uses, about 12 KB in all.
- **Rules text:** `app/symbols.js` turns "{T}: Add {G}." into symbols, and sets reminder text in
  italics.
- **Adding sets or glyphs:** run `npm run vendor-fonts` (`tools/vendor-fonts.js`), which needs
  fonttools: `pip install fonttools brotli`.

**Performance**, especially for older iPhones:
- **Animation:** everything animates only `transform` and `opacity` (Web Animations), and glows
  are pseudo-elements whose opacity changes.
- **Rendering:** each card keeps one element for its whole life and moves between zones with
  FLIP.
- **Updates:** each state is one render with one layout read.
- **The AI** thinks in a Web Worker.
- **Catching up:** the board plays the engine's events back as a queue, which speeds up when it
  falls behind and skips ahead when far behind.
- **Measured:** in Chromium emulating an iPhone 13 Pro with the CPU slowed 4× (roughly a phone's
  speed) and real card art:
  - typical renders take 10–35 ms, and the slowest about 100 ms, when the first board appears
  - a tap that plays a card takes about 60 ms, and a CPU move about 35 ms
  - image decoding totals about 0.2 s over a minute of play

**Code:**
- `app/main.js`: the router and settings
- `app/screens/`: one module per screen
- `app/battle/`:
  - `Battle.js`: the game, input and the animation queue
  - `BoardView.js`: rendering and FLIP
  - `fx.js`: effects
  - `play.js`: one-tap plays
  - `autopass.js`: smart stops and the main button
- `app/cardView.js` and `app/art.js`: how cards look
- `app/overlays.js`: sheets, inspect, deck viewer and settings
- `app/audio.js`: synthesized sound

`play.js` and `autopass.js` are plain logic and are tested in Node (`test/app.test.js`).
`tools/make-icons.js` renders the home-screen icons from `app/icons/icon.svg`.

## Importing cards from Scryfall

`tools/import-cards.js` is a Node command-line tool (Node 18+, no dependencies) that pulls card
definitions from the [Scryfall API](https://scryfall.com/docs/api) into
`src/cards/importedCards.js`. That file is merged into `CARDS`. The site never loads anything
from `tools/`.

```sh
npm run import-cards -- "Serra Angel" "Vampire Nighthawk"
npm run import-cards -- "Shock (M21)"                      # a particular printing (for its art)
npm run import-cards -- --file cards/real-cards.txt        # one card per line, # for comments
npm run import-cards -- --query "set:fdn t:creature c:g"   # any Scryfall search
npm run import-cards -- --dry-run "Birds of Paradise"      # report only, write nothing
```

A card is only imported if the engine supports everything it does:
- It's a single-faced creature, land, artifact, enchantment, instant or sorcery, with no
  supertype other than Basic.
- Its mana cost uses only generic and {W}{U}{B}{R}{G}{C} symbols.
- Its power and toughness are fixed numbers.
- Its rules text is only:
  - supported keywords
  - activated abilities, "<cost>: <effect>", optionally ending "Activate only as a sorcery."
  - triggered abilities, "When CARDNAME enters [the battlefield], <effect>" and "When CARDNAME
    dies, <effect>". Elvish Visionary, Wall of Omens, Flametongue Kavu and Doomed Traveler
    import; Blood Artist ("Whenever … another creature dies") doesn't.
  - for Auras and Equipment, "Enchant creature", "Enchanted/Equipped creature gets +N/+N and
    has …" and "Equip {N}"
- For instants and sorceries, every sentence must be a supported effect, with at most one
  target in total, plus optionally "As an additional cost to cast this spell, <cost>."

The grammar is in `tools/scryfall/rulesText.js`.
- **Costs:** {T}, mana symbols, "Pay N life", "Sacrifice CARDNAME", "Sacrifice a creature"
  (artifact, enchantment, land, permanent) and "Discard a card".
- **Effect sentences** (the card's own name or "this creature" can stand in for CARDNAME):
  - "CARDNAME deals N damage to any target / target creature / target player / each creature /
    each opponent / …"
  - "Destroy / Exile target creature / target artifact or enchantment / target nonland
    permanent / all creatures / …"
  - "Return target creature to its owner's hand."
  - "Tap / Untap target creature."
  - "Target creature / Creatures you control / CARDNAME gets +N/+N [and gains …] until end of
    turn."
  - "Put a +1/+1 counter on …"
  - "You / Target player / Each opponent gain(s) / lose(s) N life."
  - "[Target player] draws / mills N cards."
  - "Create N P/T <color> <type> creature tokens [with <keywords>]."
  - "Create N Treasure / Food / Clue tokens." and "Investigate."
  - "Counter target [creature / noncreature] spell."
  - "Add {B}{B}{B}." and "Add one mana of any color."
  - "<effect> and create <tokens>.", which is read as two sentences, e.g. "Draw two cards and
    create two Treasure tokens."

**Examples:**
- **Imports:** Prodigal Sorcerer, Mogg Fanatic, Mind Stone, Shivan Dragon, Greed, Counterspell,
  Unsummon, Naturalize, Dark Ritual, Raise the Alarm, Pyroclasm, Wrath of God, Overrun, Lava
  Spike, Thought Scour, Village Rites, Bone Splinters, Bake into a Pie, Big Score and Birds of
  Paradise.
- **Rejected:** Royal Assassin ("target tapped creature"), Sign in Blood (one sentence doing two
  things), Fling ("damage equal to …") and Gilded Lotus ("three mana of any one color").

Every other card is skipped, and the report says what isn't supported, for example:

```
Not imported — uses things the game doesn't support yet (2):
  - Birds of Paradise
      Unsupported rules text: "{T}: Add one mana of any color."
  - Thalia, Guardian of Thraben
      Unsupported supertype: Legendary.
      Unsupported rules text: "Noncreature spells cost {1} more to cast."
```

Card names are looked up 75 at a time with Scryfall's collection endpoint. If Scryfall rate-limits
the importer, it waits and tries again. A line can pin a printing: `Shock (M21)`, `Shock|m21`, or
`4 Shock (M21)` (the count is ignored). Behind a proxy, run Node with `NODE_USE_ENV_PROXY=1`
(Node 22.21+), because Node's `fetch` ignores `HTTPS_PROXY` otherwise.

`cards/real-cards.txt` lists the real cards the campaign uses: 86 cards from M19, M20, M21 and
Foundations. Forest and Llanowar Elves are defined by hand, so for those the importer records only
their art, in `CARD_PRESENTATION`.

Each imported card also keeps what the app needs to show it: `image: { art, card }` (Scryfall's
art crop and full-card image URLs, loaded from Scryfall's image CDN), `artist`, `colors`, `rarity`, `set` and `collectorNumber`.

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
  // emblems: { p1: ['planeswalker'] }, emblemDefinitions: {...}, // optional; see Emblems
  // startingLife: { p2: 25 },       // optional; per player, default 20
  // limits: GAME_LIMITS,            // optional; caps so a board fits on a phone (see Limits)
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
| `{ type: 'ACTIVATE_ABILITY', playerId, cardId, abilityId, targets?, costChoices? }` | the player has priority, controls the permanent or emblem (`cardId` is its id), and can pay the ability's cost (e.g. it's untapped for a {T} cost, and there's enough mana in their pool). Emblem abilities also respect their timing and per-turn limit. There is one entry per ability that can be activated, and one per legal target for abilities that target (e.g. equip) |
| `{ type: 'CAST_SPELL', playerId, cardId, targets?, costChoices? }` | the mana cost is already in the player's pool, and the timing fits: instants whenever the player has priority, everything else at sorcery timing (their main phase, with priority and an empty stack). There is one entry per castable card. A spell that targets (an Aura, a Shock, ...) has one entry per legal target, with `targets: [id]`, where the id is a permanent's, a player's, or (for counterspells) a spell's stack object id |
| `{ type: 'TOGGLE_ATTACKER', playerId, cardId }` | declare attackers step (`pendingDecision.type === 'declareAttackers'`): adds the creature to, or removes it from, `pendingDecision.attackers`. There is one entry per creature that can attack |
| `{ type: 'CONFIRM_ATTACKERS', playerId }` | declare attackers step: locks in the attack, which can be empty |
| `{ type: 'SET_BLOCKER', playerId, cardId, attackerId }` | declare blockers step (`'declareBlockers'`): the creature blocks that attacker, or blocks nothing when `attackerId` is `null`. Updates `pendingDecision.blocks` |
| `{ type: 'CONFIRM_BLOCKERS', playerId }` | declare blockers step: locks in the blocks |
| `{ type: 'ASSIGN_COMBAT_DAMAGE', playerId, attackerId, assignment }` | a combat damage step (`'assignCombatDamage'`), when an attacker has more than one legal split: several blockers, or trample. `assignment` maps blocker ids (and, with trample, the defending player's id) to damage. There is one entry per legal split |
| `{ type: 'DISCARD', playerId, cardId }` | the cleanup step is waiting for the active player to discard down to 7 (`state.pendingDecision`). There is one entry per card in their hand |
| `{ type: 'CHOOSE_TARGETS', playerId, targets }` | a triggered ability with more than one legal target is being put on the stack (`'chooseTargets'`); its controller picks one. There is one entry per legal target |

An action is accepted only if it equals one of `state.validActions`.

Costs that need a choice, like "sacrifice a creature" or "discard a card", work like targets:
there's one entry per option, with `costChoices: { sacrifice: [id] }` or
`costChoices: { discard: [id] }`. Likewise, "add one mana of any color" (a Treasure, Birds of
Paradise) has one entry per color, with `manaColor: 'W' | 'U' | 'B' | 'R' | 'G'`. Targets and cost choices combine, so Bone Splinters gets one
entry per (creature to destroy, creature to sacrifice) pair.

Attackers and blockers are declared one creature at a time and then confirmed, rather than in a
single action. That way every choice is a concrete entry in `validActions`: listing every
possible set of attackers or blocks up front could run to thousands of entries. The declaration
counts once it's confirmed.

### State

The `state` event payload includes `players[]`, each with `life`, `library`, `hand`, `graveyard`,
`exile`, `manaPool` (`{ W, U, B, R, G, C }`), `landsPlayedThisTurn` and `hasLost`. It also includes:
- `battlefield`: permanents carry `controllerId`, `tapped`, `summoningSick`, `damage`,
  `damagedByDeathtouch`, `counters` (e.g. `{ '+1/+1': 2 }`), `abilities` and `keywords`, and
  creatures also carry `power` and `toughness`. Tokens have `token: true` and `colors`
- `stack`: spells and abilities; the last element is the top
- `pendingTriggers`: abilities that have triggered but aren't on the stack yet
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
| `cardDiscarded` | `playerId`, `cardId` | a card is discarded (to hand size, or as a cost) |
| `damageDealt` | `sourceId`, `targetPlayerId \| targetCardId`, `amount` | a spell or ability deals damage |
| `permanentDestroyed` / `permanentExiled` / `permanentReturnedToHand` | `cardId`, `cardName`, `sourceId`, ... | a permanent is destroyed, exiled or bounced |
| `permanentSacrificed` | `cardId`, `cardName`, `controllerId` | a permanent is sacrificed to pay a cost |
| `permanentTapped` / `permanentUntapped` | `cardId`, `sourceId` | an effect taps or untaps a permanent |
| `temporaryEffectCreated` / `temporaryEffectsEnded` | the effect / `effectIds` | a pump starts / "until end of turn" effects end in cleanup |
| `countersAdded` | `cardId`, `counter`, `count`, `counters` | counters are put on a permanent |
| `tokenCreated` | `playerId`, `card`, `sourceId` | a token enters the battlefield |
| `spellCountered` | `stackObjectId`, `cardId`, `cardName`, `sourceId` | a spell is countered |
| `lifeGained` / `lifeLost` | `playerId`, `amount`, `life` | an effect changes a life total |
| `cardsMilled` | `playerId`, `cardIds`, `librarySize` | cards are milled |
| `stackObjectFizzled` | `stackObjectId`, `reason` | a spell or ability's targets are all illegal |
| `drawFromEmptyLibrary` / `playerLost` / `gameEnded` | `playerId` / `reason` / `winnerId` | a player decks out |
| `actionAccepted` / `actionRejected` | `action` (+ `reason`) | an action is processed |
| `abilityTriggered` | the trigger: `id`, `sourceId`, `sourceName`, `controllerId`, `trigger`, `text`, `effects`, `targetKind` | a triggered ability triggers |
| `triggeredAbilityPutOnStack` / `triggeredAbilityRemoved` | `triggerId`, `sourceId`, `stackObjectId`, `targets` / `reason` | it's put on the stack, or removed for lack of a legal target |
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

### Limits (this game's screen-size rules)

So that a whole board fits on a phone screen, a game can impose limits (the `limits` option;
`GAME_LIMITS` is `{ hand: 7, creatures: 10, permanents: 8 }`, and the campaign uses it). A game
has none unless asked:
- **Hand:** a card drawn into a full hand, or returned to one, is **burned**: it goes to the
  graveyard, with a `cardBurned { playerId, cardId, cardName, reason: 'draw' | 'returnToHand' }`
  event. A burned draw still appears in `cardsDrawn`.
- **Creatures:** creature spells can't be cast while the player controls that many creatures
  (their creature spells on the stack count too), and creature tokens beyond the cap aren't
  created (`tokensLimited { playerId, count, sourceId }`).
- **Other permanents:** the same for nonland, noncreature permanents (artifacts, enchantments,
  Treasure and other tokens). Lands are unlimited.

Limits survive `serialize()`, `clone()` and `getPlayerView()`, so the AI's simulations obey them.

### Rules implemented

- The turn structure follows CR 500–514: beginning (untap, upkeep, draw), precombat main, combat
  (beginning of combat, declare attackers, declare blockers, combat damage, end of combat),
  postcombat main, and ending (end, cleanup).
- No player receives priority during untap or cleanup (502.4, 514.3).
- The active player receives priority at the start of every other step and main phase (117.3a).
  After a pass, the next player in turn order receives it (117.3d).
- When all players pass in succession with an empty stack, the step or phase ends (117.4, 500.2).
- The player who goes first skips the draw step of turn 1 (103.8a).
- Declare blockers and combat damage are skipped when no creatures attack (508.8).
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
- Instants and sorceries (304, 307): instants can be cast whenever their owner has priority,
  including in response to other spells, during combat, and on the opponent's turn. Sorceries
  need sorcery timing. On resolution their `effects` happen in order (608.2c), then the card goes
  to its owner's graveyard (608.2n). Effects:
- Effects (`EFFECT` in `src/cards/cards.js`) are shared by spells, activated abilities and
  emblems. Each applies to what its `affected` field says (`target`, `you`, `eachOpponent`,
  `eachPlayer`, `eachCreature`, `eachCreatureYouControl`, or `source`, the ability's own
  permanent). Without it, targeted effect types apply to the target, and the rest to "you".
  - `dealDamage`: to a creature (marked damage, so state-based actions kill it) or to a player
    (life loss). If the source is a permanent with deathtouch or lifelink, those apply (702.2,
    702.15).
  - `destroy` (701.7), `exile` (701.5) and `returnToHand`: move a permanent to its owner's
    graveyard, exile zone or hand.
  - `tap` and `untap` (701.21).
  - `pump`: +N/+N (or -N/-N) and keywords until end of turn (611.2). It ends in the cleanup
    step at the same time damage wears off (514.2), or earlier if the creature leaves the
    battlefield. Active ones are in `state.temporaryEffects`.
  - `addCounters`: +1/+1 counters (122), which last until the permanent leaves the battlefield.
  - `drawCards`, `gainLife`, `loseLife`, `mill` (701.13) and `addMana`, for players.
    `addMana` takes either `mana` or `anyColor: n`, where the color comes from the action's
    `manaColor`.
  - `createToken`: tokens (111) owned by the player who creates them. A token that leaves the
    battlefield ceases to exist (111.7, 704.5d), so it never shows up in a graveyard, hand or
    exile. `token` is either a creature token's description
    (`{ colors, subtypes, power, toughness, keywords }`) or a predefined token (111.10):
    - `'treasure'`: "{T}, Sacrifice this artifact: Add one mana of any color." That's a mana
      ability, so it doesn't use the stack.
    - `'food'`: "{2}, {T}, Sacrifice this artifact: You gain 3 life."
    - `'clue'`: "{2}, Sacrifice this artifact: Draw a card."

    They're colorless artifacts, so they can use {T} abilities the turn they're created.
  - `counterSpell`: the countered spell goes to its owner's graveyard (701.6).
- Costs (118, 601.2f–h, 602.2b): {T}, mana, life, `sacrificeSelf`, `sacrifice` (a permanent
  kind) and `discard` (a number of cards). A spell's `additionalCost` is paid after its mana
  cost. A sacrificed source is gone before the ability resolves, but the ability still
  resolves; effects on "this permanent" then do nothing.
- Targets (115): spells and abilities that target list one valid action per legal target. When
  one resolves, its targets are checked again, and if they're all illegal it doesn't resolve
  (608.2b). A spell that doesn't resolve goes to its owner's graveyard (`stackObjectFizzled`).
  Target kinds (`TARGET`):
  - creatures: `creature`, `creatureYouControl`, `creatureOpponentControls`
  - other permanents: `artifact`, `enchantment`, `artifactOrEnchantment`, `land`,
    `nonlandPermanent`, `permanent`
  - players: `player`, `opponent`, and `any` (a creature or a player)
  - spells on the stack: `spell`, `creatureSpell`, `noncreatureSpell`
  
  Abilities can target their own source, except Auras and Equipment attaching to themselves.
- Auras (303.4): "Enchant creature" Auras target a creature when cast and enter attached to it.
  An Aura that's attached to nothing, or to something it can't enchant, goes to its owner's
  graveyard (704.5m).
- Equipment (301.5): enters unattached. "Equip {N}" (702.6) is a sorcery-speed ability that
  targets a creature you control. It uses the stack and moves the Equipment if it's already
  attached. If the creature leaves, the Equipment stays on the battlefield, unattached (704.5n).
- Continuous effects (613): each permanent keeps its printed `base` power, toughness and
  keywords. The current values are recalculated whenever something enters, leaves, or is
  attached. The effects so far are:
  - static abilities on attached Auras and Equipment (`affected: 'attachedPermanent'`)
  - +1/+1 counters
  - "until end of turn" pumps

  These add power, toughness and keywords. Combat and keyword rules use the recalculated
  values.
- Triggered abilities (603): `triggeredAbilities: [{ id, text, trigger, effects, target? }]`,
  where `trigger` is `entersBattlefield` (603.6a) or `dies` (700.4: put into a graveyard from the
  battlefield, by any means, including tokens). Being exiled or returned to hand isn't dying.
  - When the event happens, the ability triggers (`abilityTriggered`, `state.pendingTriggers`).
    The next time a player would receive priority, after state-based actions, it goes on the
    stack (603.3). Its controller is the permanent's controller at the time.
  - Several at once go on in APNAP order (603.3b): the active player's first, so the other
    player's end up on top and resolve first. A player's own triggers go on in the order they
    triggered; choosing that order isn't modelled.
  - Targets are chosen as it goes on the stack (603.3d):
    - With no legal target, it's removed.
    - With one, that one is used.
    - With more, its controller gets a `chooseTargets` decision, and priority waits until
      they've chosen.
  - A dies ability works even though its source is gone (603.10a), but an effect on the source
    itself then does nothing.
  - During the cleanup step, abilities that trigger wait until a player next gets priority;
    the extra cleanup step of 514.3a isn't modelled.
- State-based actions are checked before a player receives priority (117.5), and repeated until
  there are none left (704.3). Creatures with lethal damage or 0 toughness die (704.5f, 704.5g).
  A player loses at 0 life (704.5a), or after trying to draw from an empty library (704.5b). The
  game ends as soon as any player loses, because multiplayer elimination isn't modelled.

Cards are defined in `src/cards/cards.js` (by hand) and `src/cards/importedCards.js` (generated
from Scryfall, see above): a mana cost, types, power and toughness for creatures, and activated
abilities as data (`{ id, text, cost, effects, target?, timing? }`; the format is documented at
the top of `cards.js`). An ability that adds mana and doesn't target is a mana ability. Creatures
can list `keywords`. The tests add test-only cards through the `cards` option, including free (0-cost)
creatures for building combat scenarios.

**Snapshots and simulation** (for AI search and saving games):
- **Copying the game:** `game.serialize()` returns the whole game, including the random number
  generator's state, and `Game.deserialize(snapshot)` rebuilds it. `game.clone()` is a fast
  independent copy.
- **Hiding information:** `game.getPlayerView(playerId)` is a snapshot without what that player
  can't know: the opponent's hand, the order of every library, and the random state. The unknown
  cards are listed as a pool. `determinize(view, random)` (`src/ai/determinize.js`) deals that
  pool into a playable guess.
- **Simulating fast:** `silent: true` games emit no events, `applyTrusted(action)` skips
  re-validation, and `peekState()` reads the state without copying it.

The turn structure is defined as data in `src/engine/turnStructure.js`. Each step or main
phase records whether players get priority and can provide a `skip` rule.


## Campaign

A run is a roguelite climb:
1. **Start:** choose a planeswalker (its emblems and powers) and one of its starter decks.
2. **Fight** up a **ladder** of tiers. Each tier has a number of fights, each against an
   opponent drawn from the tier's pool, not one already faced. The last tier is the **boss**.
3. **Win** and choose a **reward**: a card from the tier's card pool, a **planeswalker power**,
   or removing a card from the deck (once it's above the minimum size). Or skip it.
4. **Lose** and the run loses a **life**. Then retry the fight (new shuffle) or skip it with no
   reward. A boss can't be skipped. With no lives left, the run is over. Beating the boss wins
   the run.

The framework in `src/campaign/` is pure data and functions; the app (*The app*, above) drives it
like this:

```js
import {
  SAMPLE_CAMPAIGN as content, startRun, matchSetup, recordResult, chooseReward, skipReward,
  retryFight, skipFight, createCpuController, saveRun, loadRun, Game,
} from './src/index.js';

let run = loadRun(localStorage, content) ?? startRun(content, { planeswalkerId: 'warden', deckId: 'effects' });
const { game: options, cpu, encounter } = matchSetup(run, content); // run.phase === 'fight'
const game = new Game(options);                                    // players 'player' and 'cpu'
const ai = createCpuController(game, cpu, { delayMs: 300 });       // basic or search AI, as the opponent says
// ... play; when the game ends:
run = recordResult(run, content, { won: game.getState().winnerId === 'player' });
// 'reward':   run.offers → chooseReward(run, content, i[, { cardId }]) or skipReward(run, content)
// 'defeated': retryFight(run) or skipFight(run, content) (canSkipFight: not a boss)
// 'victory' / 'over': the run is finished
saveRun(localStorage, run);
```

- **Runs are plain JSON.** The functions never mutate a run; they return the next one. A run
  has its own seeded generator, so the same seed gives the same opponents, offers and shuffles.
- **Saving:** `saveRun`, `loadRun` and `clearRun` work with any storage (`localStorage`). A
  saved run that no longer fits the content loads as `null`: another `RUN_VERSION`, or a card,
  opponent or power that's gone.

### Content

Everything a campaign has is data. There are two campaigns:
- **`CAMPAIGN`** (`src/campaign/realCampaign.js`) is the one the app plays, built from real cards.
  - **Decks:** `REAL_DECKS` (`src/campaign/decks.js`), a mono-color 40-card deck per color, lighter
    builds for the early opponents, and the boss's dragons.
  - **Planeswalkers:** the Warden plays Green Stompy and the Sage plays Blue Skies.
  - **Opponents** climb from basic-AI White, Black and Red, through searching full builds and
    the other planeswalker's color, to **the Dragonlord**.
- **`SAMPLE_CAMPAIGN`** (`src/campaign/sampleCampaign.js`) uses the made-up sample cards, for
  tests.

A campaign contains:

| Key | What |
| --- | --- |
| `rules` | `lives`, `minDeckSize`, `rewards: { cards, powers, removeCard }` (what each win offers), `limits` (game limits, default `GAME_LIMITS`) and `maxAbilities` (planeswalker abilities over all of a player's emblems, default 4) |
| `cards` | definitions of every card the campaign uses (beyond `CARDS`) |
| `emblems` | emblem definitions for planeswalkers, powers and bosses (see *Emblems*) |
| `planeswalkers` | `{ name, text, color?, art?, colors?, emblems, startingLife?, powers, decks? }`: starting emblems, the powers it can earn, and (optionally) which starter decks it may use. With `colors` (e.g. `['G']`), card rewards are only cards in those colors or colorless (`poolFor`) |
| `starterDecks` | `{ name, cards }` |
| `powers` | `{ kind, name, text, repeatable?, ... }`, with these kinds: `emblem` (`emblemId`), `activations` (`emblemId`, `amount`: more uses per turn), `startingLife` (`amount`), `extraLife` (`amount`) |
| `opponents` | `{ name, color?, art?, deck, emblems?, startingLife?, ai }`, where `ai` is `{ kind: 'basic' }` or `{ kind: 'search', budgetMs, weights? }` (`weights` defaults to the opponent's id, see *Weights for each CPU deck*) |
| `cardPools` | lists of card ids that rewards are drawn from |
| `ladder` | tiers `{ id, name, fights, opponents, cardPool, rewards?, boss? }`, from easiest to the boss |

Opponents get harder through their AI (basic → search with more thinking time), their deck,
emblems and starting life. The example ladder has four tiers:
- **Outskirts:** basic AIs.
- **Deep Wilds:** search AIs with 500 ms to think.
- **Citadel:** 1.5 s search, plus an emblem.
- **Throne:** a boss with 25 life, two emblems and 2.5 s of search.

To add a planeswalker, deck, opponent, power or tier, add it to the content. Then
`validateCampaign(content)` lists anything inconsistent: unknown cards, emblems, powers or
opponents, small decks, a tier with fewer opponents than fights, or a boss before the end. The
test suite runs it on `SAMPLE_CAMPAIGN`.

### Simulating runs

```sh
npm run campaign-sim -- --runs 20 --walker warden --deck effects --workers 4
npm run campaign-sim -- --player "search:b=150" --budget 200
```

This plays whole runs with an AI standing in for you: it retries every loss and takes a power
when one is offered, otherwise the first card. It reports how many runs were won, how far they
got, and the win rate in each tier and against each opponent: a quick check that the ladder
really gets harder. CPU searches are capped at `--budget` ms (default 100) so runs finish fast.
That makes the CPUs weaker than in the browser.

## AI

There are three computer players, all in `src/ai/`. Each listens to the game's `state` events and
emits `action` events. None of them looks at the opponent's hand or any library.

### Basic AI (`BasicAIController`)

A fast heuristic player, also used to play out the search AI's simulations (5–20 µs per decision).
- **Combat** (`combat.js`):
  - **Attacks:** with creatures the opponent can't block profitably, and with everything when
    that's lethal through the best possible blocks. Then it adds any other attacker that makes
    the whole attack better against the defender's best blocks: each blocker stops only one
    attacker, so more attackers than they can block well get through ("swarming"). It keeps enough blockers home to survive
    the crack-back, and goes all in when it's losing the race to deck out. It expects the
    defender to block as it does itself (`predictBlocking`).
  - **Blocks:** the `value` plan of *Blocking plans* below: the blocks worth the most, counting
    attacker value killed, blocker value lost, and life kept (worth more when life is low),
    solved exactly. It survives first, and chump-blocks only when the life is worth the creature.
    `blocking: 'greedy'` blocks as it used to (`planBlocks`: good blocks first, greedily).
  - **Predictions:** its combat predictions follow the engine's rules (first strike, double
    strike, deathtouch, trample, lifelink); a test checks them against real combats for every
    keyword pairing.
- **Mana:** in its main phase it picks the most valuable set of spells and abilities it can
  afford (a small knapsack over its hand). It keeps mana up for instants it would rather cast
  later, and taps lands and Elves before sacrificing Treasures.
- **Instants:**
  - combat tricks once blockers are declared, when they win the fight
  - removal on attackers
  - counterspells on spells worth countering
  - everything else at the end of the opponent's turn
- **Scoring** (`scoring.js`): spells and abilities are scored effect by effect, in the same points
  as creature values. Removal goes at the biggest threat, and burn goes to the face when it's
  lethal.

`LegacyAIController` is the first version, kept unchanged as a baseline. `strategy: 'passive'`
only passes and makes empty declarations.

### Blocking plans (`blocking.js`)

The first piece of a new AI. `blockingPlans(attackers, blockers, life)` makes five plans for
blocking an attack, each a different idea of the best blocks (`BLOCK_PLAN`):

| Plan | Puts first | Then |
| --- | --- | --- |
| `life` | the most life left | kills, then creatures kept |
| `creatures` | the least creature value lost | kills, then life |
| `kills` | the most attackers killed, then their value | life, then creatures kept |
| `optimal` | the most attackers killed, then their value | creatures kept, then life |
| `value` | attacker value killed − blocker value lost + life kept × `damageWeight(life)` | creatures kept, then life |

Every plan survives the combat first, if any blocks can. First-strike damage counts before
lifelink gains it back. Each plan gives its blocks, whether the defender survives, the life left,
and the attackers and blockers that die, so the plans can be compared or played out. On real
boards, the first four plans usually come to two different sets of blocks. `blockingPlansFor(state,
me, canBlockPair)` reads them from a game state. `optimalBlocks` and `planOptimalBlocks` make
just the `optimal` plan.

Each plan is exact, with up to 3 blockers on an attacker (`maxGroup`). It fights each attacker
against each useful group of blockers once, using a flat copy of `resolveCombat`'s rules, and the
plans share those fights. Then each plan searches the attackers, memoizing on how many of each
class of identical blockers are left.

- **Speed:** measured on 1,478 blocking decisions from basic-AI games on the real and sample
  decks.
  - With up to 4 creatures a side, all four plans take 11–18 µs (median); `optimal` alone takes
    5–8 µs, faster than `planBlocks`.
  - With 7–10 creatures a side, all four take 66–231 µs (median).
- **Budgets:** boards beyond `stateLimit` or `nodeLimit` get a best effort flagged
  `exact: false`. That only happens well past the campaign's 10 creatures a side.
- **Tests:** `test/blocking.test.js` checks every plan against brute force on random boards.

`value` is `planBlocks`' own scoring, solved exactly instead of greedily, and it's how the basic
AI blocks. To try another plan, pass `blocking: '<plan>'` (arena: `basic:blocks=<plan>`;
`greedy` for `planBlocks`). Here is each plan, in place of `planBlocks`, against the basic AI as
it was (blocking with `planBlocks`), in mirror matches on every deck:

| Blocking plan | Games | Win rate vs basic (95% CI) |
| --- | --- | --- |
| `value` | 2640 | 54.2% (52.3–56.1%) |
| `creatures` | 2640 | 51.2% (49.3–53.1%) |
| `optimal` | 1320 | 50.0% (47.3–52.7%) |
| `kills` | 1320 | 43.2% (40.5–45.9%) |
| `life` | 1320 | 40.2% (37.6–42.9%) |

`value` also beats `creatures` head to head, 54.6% (52.7–56.5%) over 2640 games.

- **Chump blocks:** the plans that put life before creatures (`life`, and `kills` after its
  kills) chump-block attackers they can't kill, and lose for it.
- **Trades:** putting kills first (`optimal`) trades a big creature for a small one.
- **Weighing both:** weighing value killed against value lost, as `planBlocks` does, is what
  wins. Solving that exactly gains about 4 points.

With `value` as the default, the basic AI's attacks also expect the defender to block that way
(`predictBlocking`; arena: `basic:predict=greedy` for the old expectation). The search AI's
evaluation predicts the next combat the same way, and it offers both `value` and greedy blocks
as candidates.

| Match | Games | First AI's win rate (95% CI) |
| --- | --- | --- |
| basic (now) vs basic as it was (greedy blocks, greedy predictions) | 2640 | 53.0% (51.1–54.9%) |
| basic (now) vs the same with greedy predictions | 2640 | 50.9% (49.0–52.8%) |
| search (now) vs search as it was, 150 ms, real decks | 200 | 56.0% (49.1–62.7%) |

Predicting `value` blocks is neutral in the arena, where both sides block the same way, but it's
right, as each side expects the blocks it will actually meet. Playouts are up to 9% slower (the
benchmark's standard deck: 52 to 48 games/s).

### Lookahead attacks (`attacking.js`)

The second piece of the new AI. `planLookaheadAttack(state, me, candidates)` picks one of three
strategies (`ATTACK_STRATEGY`) by playing each out a few turns:

| Strategy | Attacks with |
| --- | --- |
| `aggressive` | everything that can attack, to race |
| `value` | attackers added one at a time while the trade improves against the defender's blocks: creature value killed minus value lost, plus a little for chip damage (more when the defender is low) |
| `hold` | the `value` attack, minus the creatures it will want as blockers when the opponent attacks with everything next turn |

- **Lookahead:** each of our strategies plays out for 3 of our turns, and theirs after each,
  against each of the opponent's strategies. It uses only the creatures in play (nobody casts
  another), and defenders block with the `value` plan. So a crack-back that would kill us shows
  up, and so does a race we'd win.
- **Choice:** it takes the strategy whose worst case is best. A win scores more the sooner it
  comes; otherwise the score is board value plus life, which counts for more when it's low.
- **Trying it:** it's opt-in, `BasicAIController({ attacking: 'lookahead' })` (arena:
  `basic:attack=lookahead`).

| Match | Games | First AI's win rate (95% CI) |
| --- | --- | --- |
| basic with lookahead attacks vs basic | 2640 | 52.1% (50.2–54.0%) |

It wins or ties on 9 of the 11 decks. Its games run longer, as it holds back more: green's go from
22 to 31 turns. Its attack decisions take up to a few milliseconds on big boards.

### Search AI (`SearchAIController`)

At each real decision, the search AI chooses among *macro actions* (`macroActions.js`), whole
decisions rather than the engine's raw actions:
- "cast this at that, tapping mana as needed"
- "attack with these creatures"
- "these blocks"
- "pass"

It simulates each one many times (`search.js`):
1. **Guess the hidden cards.** Each simulation starts from `determinize(game.getPlayerView(me))`.
   The player view hides the opponent's hand, the order of every library and the random number
   generator's state. The guess deals the unknown cards at random and reseeds the generator, so
   the AI never relies on anything it couldn't know, including its own next draws. A test checks
   that its choices don't change when the hidden cards, the library orders or the seed change.
2. **Play the macro**, then let the basic AI play both sides up to the AI's next turn.
3. **Score the result** with `evaluate.js`: a weighted sum of life (concave), creature values,
   lands, other permanents, spells in hand, lands in hand (weighted apart, so the AI never
   prefers keeping a land in hand to playing it), each side's clock, and deck-out danger.
4. **Race the candidates:** each round deals one new guess and simulates every remaining
   candidate on it, so candidates are compared pair by pair on identical situations. After 6
   rounds, a candidate 2.5 standard errors behind the leader drops out, and the time goes to the
   close contenders. The basic AI's own choice is the default, and another candidate has to beat
   it by a margin of 1 point.

It runs in a module Web Worker (`aiWorker.js`, with an inline time-sliced fallback), so the page
stays responsive.

It never wastes the player's time, or its own work:
- **Quick passes where it never acts.** It only ever acts in its windows (`windowOf`): its own
  main phases, after blocks, when attacked, at the opponent's end step, and in response to an
  opponent's spell. Elsewhere (upkeep, draw, beginning of combat, ...) it always passes, so it
  passes at once (`passMs`, 60 ms). The windows depend only on public information, so this gives
  nothing away.
- **Searches are kept by position** (`searchPool.js`). The worker keeps recent searches by a hash
  of the AI's view. When a position comes up that it already searched, or pondered, it carries
  on from where it got to instead of starting over. A search stops as soon as its race is
  decided (one candidate left), or once it has had its budget, pondering included.
- **Pondering** (`ponder.js`). Whenever it isn't deciding, it plays a private copy of the game
  forward along the likeliest line, and searches the next three decisions it meets there.
  - **The line:**
    - The opponent passes, and confirms the attackers or blocks they've picked so far.
    - The AI carries on with the play it's making, and otherwise does what the basic AI would.
  - **So while you take your turn**, it's already thinking about its next main phase. While you
    choose attackers, it's thinking about its blocks against exactly those attackers. If you
    then do what it predicted, its answer is ready.
  - **What the search sees:** it only ever gets the AI's view of each position. The result is
    only used once the AI really reaches that position.

Measured over whole games (a basic AI standing in for the player and answering at once), this
took the Pyromancer's games from 223 s to 81 s, and the Dragonlord's from 203 s to 56 s. Its
average think at its own main phase fell from 1.6 s to 0.6 s.

It gives little away:
- **Uniform timing in its windows:** there it answers after the same delay (`responseMs`,
  400 ms), plus random jitter. That holds whether it passes or acts, and whether or not it holds
  an instant; a test checks the delays are identical with and without one.
- **Visible thinking only at public moments:** it shows "Thinking…" only at its own main phases
  and declarations, which happen every turn whatever its hand. It thinks for at least
  `minThinkMs` (600 ms, or its budget if that's less) and at most its budget. It can answer sooner than the budget when the
  choice is clear, or was pondered, so how long it thinks can hint at how hard the choice was.
  That trade buys a lot of speed.

In the debugger, pick "AI: search" for a player to see its top candidates and simulation count.

### Measuring strength

```sh
npm run arena -- basic legacy --games 50 --workers 4    # mirror matches on every deck
npm run arena -- basic basic-noswarm --workers 1        # vs the basic AI before it swarmed
npm run arena -- "search:b=150" basic --decks effects,keywords
npm run benchmark                                        # silent playouts per second
npm run tune-ai                                          # refit the evaluation weights
```

### Weights for each CPU deck

Each CPU deck can weigh things its own way. An aggro deck cares about its clock, while a control
deck cares about cards and life. `weightsFor(profile)` (`evaluate.js`) picks a deck's weights:
1. **Its own tuned weights:** `DECK_WEIGHTS[deckName]` in `src/ai/weights.js`.
2. **An archetype's:** `aggro`, `control` or `midrange` (`ARCHETYPE_WEIGHTS`), adjustments of the
   defaults.
3. **The defaults.**

Pass the profile to the search AI: `new SearchAIController({ game, playerId, weights: 'goblins' })`,
or `weights: 'aggro'`, or a weights object. The debugger uses the selected deck's name.

To tune a deck, add it to `DECKS` in `tools/ai-arena.js`, then run
`npm run tune-ai -- --deck goblins [--from aggro]`. That plays it against every deck from its own
side and writes `DECK_WEIGHTS.goblins`. Tuning is deliberately light: the fit starts from the
general weights (or `--from`'s) and is pulled back towards them, so a deck's weights move only as
far as its games clearly show. The sample decks are just examples, so none of them has its own
weights yet. In the arena, `w=<deck or archetype>` picks weights, e.g. `"search:b=150,w=aggro"`.

The arena plays each seed twice with the seats swapped and reports win rates with 95% confidence
intervals. `tools/tune-ai.js` fits the evaluation weights to the results of basic-AI games
(logistic regression on positions from games decided by life totals) and writes
`src/ai/weights.js`.

Results:

| Match | Games | First AI's win rate (95% CI) |
| --- | --- | --- |
| basic vs legacy | 600, all six decks | 70.3% (66.6–73.8%) |
| greedy (8 guesses, 2-turn horizon) vs basic | 100, five decks* | 64.0% (54.2–72.7%) |
| search (250 ms) vs basic | 100, five decks* | 62.0% (52.2–70.9%) |
| search (250 ms) vs greedy | 100, five decks* | 50.0% (40.4–59.6%) |
| search (1 s) vs greedy | 100, five decks* | 48.0% (38.5–57.7%) |
| greedy, 3-turn vs 2-turn horizon | 100, five decks* | 54.0% (44.3–63.4%) |
| greedy, tuned vs hand-picked weights | 100, five decks* | 52.0% (42.3–61.5%) |

\* Every deck except the Forest + Elves mirror, where games are 1/1s trading evenly until someone
decks out, so the seat decides them. The search AI's lead comes from its simulations, which the
time budget doesn't change much: given enough simulations, greedy and search agree, so a better
rollout policy or evaluation, not more time, is what would make it stronger.

On the real decks (mirror matches of the five colors, 200 games each, search at 150 ms):

| Match | First AI's win rate (95% CI) |
| --- | --- |
| search vs basic (before the changes below) | 63.5% (56.6–69.9%) |
| search vs the previous basic AI (after them) | 66.0% (59.2–72.2%) |
| basic (swarming) vs the previous basic AI | 52.3% (49.6–55.0%), 1320 games, all eleven decks |
| general weights refit on all decks vs current | 49.5% (42.6–56.4%) |
| 3-turn vs 2-turn horizon | 50.5% (43.6–57.4%) |
| margin 0 vs 1 | 43.0% (36.3–49.9%) |
| margin 2 vs 1 | 50.0% (43.1–56.9%) |
| lands in hand weighed apart vs as spells | 49.0% (42.2–55.9%) |

The search still gains nothing from more time, a deeper horizon or refit weights, and does worse
when it trusts its simulations over the basic AI's choice (margin 0). What it does gain from is
a better basic AI, which both plays the outskirts' CPUs and plays out every simulation.

#### Heuristics from Magic strategy

Well-known rules of thumb, from Forge's AI (`AiAttackController`, `AiBlockController`,
`ComputerUtilCombat`) and from Limited strategy, are in the code as opt-in options. They're
measured as `basic:h=<name>[@value]` against the basic AI in mirror matches on every deck
(1320 games each).

| Heuristic | Rule | Win rate vs current basic |
| --- | --- | --- |
| `attrition` | Forge's attritional attack: all in if attacking every turn kills them even when each blocker stops one of our biggest attackers | 50.1% |
| `beatdown` | "Who's the beatdown?": when we'd win the race, accept even trades (`@2`, `@4`: worse trades) | 49.7% (48.7–49.6% stronger) |
| `danger` | Forge's "life in danger": trade-block, then chump-block, while the damage getting through would leave us below 4 life (`@7`, `@10`) | 49.9% (49.2–49.5%) |
| `home` | Forge's blockers kept home: don't attack with a creature whose absence costs more on the crack-back than it deals | 48.6% |
| `reinforce` | Add a blocker to a block that doesn't kill its attacker | 50.9% |
| `postCombat` | Cast creatures after combat unless they matter in it (haste, an enters-the-battlefield effect), when lands alone pay for them | 49.5% (on by default) |
| `saveRemoval` | Removal in the main phase only on creatures worth 6+ unless at 8 life or less (`@4.5`, `@8`) | 50.0% (49.7–50.7%) |
| all of attrition, beatdown@2, danger@7, reinforce | | 50.2% |

Offering their attack and block plans to the search as extra candidates (`search:hp=1`,
`HEURISTIC_PLANS`) scored 50.0% (43.1–56.9%) against the search without them.

None of them helps, and the reason shows when counting how often each changes a decision.
Over 80,000 decisions in basic-AI games, `attrition`, `beatdown`, `danger` and `reinforce`
changed between 13 and 53. The basic AI already follows the rules they encode: it attacks
where no block is profitable, swarms, trades up, double-blocks, and chump-blocks when the
attack is lethal.

`postCombat` first scored 47.4%, almost all of it in green (79–121). The cause was mana, not
blockers. Waiting until after combat left Llanowar Elves free to attack, so they were tapped
when the creature came to be cast, which then slipped a turn. With the rule limited to
creatures that lands alone pay for, it's neutral against the AI. It's on by default because it
plays better against a person: the hand stays hidden and mana stays up through combat. `home`
still scores 48.6%.

Measuring these also turned up two mistakes in how positions were judged, both fixed:
- **Creatures still to be cast.** Deciding whether attacking leaves it dead to the crack-back,
  the AI counted only the creatures in play. Those it would cast after combat block just as
  well on the opponent's turn. They now count (`plannedCreatures`; 50.0% against leaving them
  out).
- **Tapped blockers in the clock.** The evaluation's race clock treated every creature as able
  to block the next attack. A creature that attacked on its own turn stays tapped through the
  opponent's, so the active player's next attack now meets blockers as they are (50.5%).

Both were neutral in the arena, where the opponent is the same AI, but they're right.

#### Tiered evaluation and pruned lookahead

Two search options, both off by default, measured against the default search on the real
decks (200 games each):
- **`evaluation: 'tiered'`** (`evaluateTiered`, arena `e=tiered`). It ranks winning, then not
  losing (lethal on board either way, the race, life), then creatures and who wins the next
  combat (the active player's planned attack against the planned blocks), then cards in hand,
  then other permanents. `TIERS` sets the gaps; `weights.tiers` overrides them.
- **`lookahead: { depth, beam, branchOpponent }`** with **`rootBeam`** (`lookahead.js`, arena
  `la=`, `bw=`, `bo=`, `rb=`). Instead of one basic-AI playout per candidate, it branches at key
  decisions: our main-phase plays and both sides' attacks and blocks. Every option is scored
  where it leads and only the best `beam` go deeper. `rootBeam` keeps only the best few
  candidates before the search starts.

| Setting | Budget | Win rate vs default search |
| --- | --- | --- |
| tiered, wide gaps (lethal 3000, clock 12/turn) | 150 ms | 43.5% (36.8–50.4%) |
| tiered, moderate gaps (lethal 150/60, clock 3) | 150 ms | 48.0% (41.2–54.9%) |
| lookahead depth 2, beam 2, 4 candidates | 150 ms | 52.0% (45.1–58.8%) |
| lookahead depth 3 + tiered (moderate), opponent branching | 300 ms | 38.5% (32.0–45.4%) |
| lookahead depth 3, opponent not branching | 150 ms | 46.0% (39.2–52.9%) |

What the results say:
- **Gap sizes:** with wide gaps, rare lethal swings in a few noisy simulations swamp the
  average, and the search can't tell its options apart. Moderate gaps keep the order without
  that.
- **Opponent branching:** in a guessed game the opponent sees the AI's hand. Branching on its
  worst-for-us replies makes it dodge every trick, so every plan looks bad, and more so the
  deeper the search goes.
- **Depth:** a deeper lookahead costs two to four times as much per simulation. Within the same
  time it gets fewer guesses of the hidden cards, and so far that has cost as much as the depth
  gained.

A rule from the same sources that would matter, but needs the rules engine first, is the
mulligan: the engine keeps every opening hand, so hands with too few or too many lands are
played out.

