import { EventEmitter } from '../engine/EventEmitter.js';
import { ACTION } from '../engine/actions.js';
import { DECISION } from '../engine/Game.js';
import {
  isCreature, isLand, isInstant, isAura, isEquipment, hasKeyword, manaValue, KEYWORD, EFFECT, AFFECTED, TARGET,
  PLAYER_TARGETS, SPELL_TARGETS, effectAffects, matchesPermanentKind,
} from '../cards/cards.js';
import { manaPoolTotal } from '../engine/mana.js';

export const AI_STRATEGY = Object.freeze({
  /** Plays lands, casts creatures, attacks when it has more creatures, blocks to trade. */
  BASIC: 'basic',
  /** Never acts on its own: passes priority and makes empty declarations. */
  PASSIVE: 'passive',
});

/**
 * A simple computer player. It listens to the game's `state` events and, when it
 * has something to do, emits an `action` event that the game listens to. It never
 * touches the game directly, and it only ever sends actions from `validActions`.
 *
 * `delayMs: null` acts synchronously (the game queues the action); any number
 * schedules the action with setTimeout so a viewer can follow along.
 */
export class BasicAIController extends EventEmitter {
  #game;
  #playerId;
  #delayMs;
  #strategy;
  #timer = null;
  #unsubscribers;

  constructor({ game, playerId, delayMs = 0, strategy = AI_STRATEGY.BASIC }) {
    super();
    this.#game = game;
    this.#playerId = playerId;
    this.#delayMs = delayMs;
    this.#strategy = strategy;
    this.#unsubscribers = [
      game.on('state', (state) => this.#onState(state)),
      game.listenTo(this),
    ];
  }

  get playerId() { return this.#playerId; }

  set delayMs(value) { this.#delayMs = value; }

  /** Stop listening to the game and cancel any pending action. */
  detach() {
    clearTimeout(this.#timer);
    this.#unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  /** Act on the game's current state, e.g. right after taking control mid-game. */
  actNow() {
    this.#onState(this.#game.getState());
  }

  chooseAction(state) {
    const mine = state.validActions.filter((a) => a.playerId === this.#playerId);
    if (mine.length === 0) return null;
    const find = (type, predicate = () => true) => mine.find((a) => a.type === type && predicate(a));
    const passive = this.#strategy === AI_STRATEGY.PASSIVE;

    switch (state.pendingDecision?.type) {
      case DECISION.DECLARE_ATTACKERS:
        return this.#moveTowards(state.pendingDecision.attackers, passive ? [] : this.#planAttack(state), find,
          ACTION.TOGGLE_ATTACKER, ACTION.CONFIRM_ATTACKERS);
      case DECISION.DECLARE_BLOCKERS:
        return this.#chooseBlock(state, passive ? {} : this.#planBlocks(state), find);
      case DECISION.ASSIGN_COMBAT_DAMAGE: {
        // Send as much damage as possible to the player (trample); otherwise take the first split.
        const toPlayer = (a) => Object.entries(a.assignment)
          .filter(([id]) => state.players.some((p) => p.id === id)).reduce((sum, [, n]) => sum + n, 0);
        return mine.reduce((best, a) => (toPlayer(a) > toPlayer(best) ? a : best));
      }
      case DECISION.CHOOSE_TARGETS: {
        // A triggered ability's target: the best one for us, even if every option is bad.
        const { effects, sourceId } = state.pendingDecision;
        const score = (a) => this.#scoreEffects(state, effects, a.targets, sourceId);
        return mine.reduce((best, a) => (score(a) > score(best) ? a : best));
      }
      case undefined:
        break;
      default:
        // Discarding, dividing combat damage, ...: any choice will do.
        return mine[0];
    }
    if (passive) return find(ACTION.PASS_PRIORITY);

    const permanents = state.battlefield.filter((p) => p.controllerId === this.#playerId);
    const me = state.players.find((p) => p.id === this.#playerId);
    const myCreatures = new Set(permanents.filter(isCreature).map((p) => p.id));
    const abilityOf = (a) => permanents.find((p) => p.id === a.cardId)?.abilities.find((ab) => ab.id === a.abilityId);
    const isManaSource = (a) => abilityOf(a)?.isManaAbility;
    // The sample Auras and Equipment are all bonuses: only put them on our own creatures.
    const onOwnCreatures = (a) => (a.targets ?? []).every((id) => myCreatures.has(id));
    const unattachedEquipment = permanents.filter((p) => isEquipment(p) && !p.attachedTo);
    const isEquipForLooseEquipment = (a) => abilityOf(a)?.id === 'equip'
      && unattachedEquipment.some((e) => e.id === a.cardId) && onOwnCreatures(a);
    // Emblem abilities that cost nothing are free value.
    const isFreeEmblemAbility = (a) => me.emblems.find((e) => e.id === a.cardId)
      ?.abilities.find((ab) => ab.id === a.abilityId && Object.keys(ab.cost).length === 0);

    return find(ACTION.PLAY_LAND)
      ?? this.#chooseCast(state, me, mine, onOwnCreatures)
      ?? find(ACTION.ACTIVATE_ABILITY, isEquipForLooseEquipment)
      ?? find(ACTION.ACTIVATE_ABILITY, isFreeEmblemAbility)
      ?? this.#chooseActivation(state, mine, abilityOf)
      // Only make mana when there's something affordable to spend it on.
      ?? (this.#wantsMana(state, me, permanents, myCreatures, unattachedEquipment, mine.filter(isManaSource).length)
        ? this.#chooseManaAction(me, mine.filter(isManaSource), abilityOf) : null)
      ?? find(ACTION.PASS_PRIORITY);
  }

  /**
   * Picks a mana ability: ones that don't sacrifice anything (lands, Elves) before
   * ones that do (Treasures), and for "any color", the color our hand needs most.
   */
  #chooseManaAction(me, actions, abilityOf) {
    const needed = {};
    for (const card of me.hand.filter((c) => !isLand(c))) {
      for (const [color, n] of Object.entries(card.manaCost ?? {})) {
        if (color !== 'generic') needed[color] = (needed[color] ?? 0) + n;
      }
    }
    const cost = (a) => (abilityOf(a)?.cost.sacrificeSelf ? 10 : 0) - (needed[a.manaColor] ?? 0);
    return actions.reduce((best, a) => (cost(a) < cost(best) ? a : best));
  }

  #isSorceryTiming(state) {
    return state.activePlayerId === this.#playerId
      && ['precombatMain', 'postcombatMain'].includes(state.phase)
      && state.stack.length === 0;
  }

  /**
   * Whether to tap another mana source: when there's a spell, ability or equip for
   * loose Equipment we'd use whose cost we could reach with the sources still
   * untapped, but can't pay from the pool yet. Outside our main phase, only for
   * instants (such as a counterspell for the opponent's spell).
   */
  #wantsMana(state, me, permanents, myCreatures, unattachedEquipment, untappedSources) {
    if (untappedSources === 0) return false;
    const sorceryTiming = this.#isSorceryTiming(state);
    const castable = me.hand.filter((c) => !isLand(c) && (sorceryTiming || isInstant(c)));
    const usefulAbilities = !sorceryTiming ? [] : permanents.flatMap((p) => p.abilities
      .filter((ab) => !ab.isManaAbility && ab.cost.mana && !(ab.cost.tap && p.tapped))
      .filter((ab) => this.#bestScore(state, ab.effects, ab.target, ab.cost, p.id) > 0)
      .map((ab) => ab.cost.mana));
    const costs = [
      ...castable.filter((c) => this.#worthCasting(c, state, myCreatures)).map((c) => c.manaCost),
      ...(sorceryTiming && myCreatures.size > 0 ? unattachedEquipment : [])
        .map((e) => e.abilities.find((ab) => ab.id === 'equip')?.cost.mana).filter(Boolean),
      ...usefulAbilities,
    ];
    const available = manaPoolTotal(me.manaPool) + untappedSources;
    return costs.some((cost) => manaValue(cost) <= available && manaValue(cost) > manaPoolTotal(me.manaPool));
  }

  /** Whether a card in hand has a sensible use right now (used to decide whether to make mana). */
  #worthCasting(card, state, myCreatures) {
    if (isAura(card)) return myCreatures.size > 0;
    if (!card.spell) return true;
    return this.#bestScore(state, card.spell.effects, card.spell.target, card.additionalCost ?? {}, card.id) > 0;
  }

  /** The best score over the targets a spell or ability could have (an estimate: the engine decides legality). */
  #bestScore(state, effects, targetKind, cost, sourceId) {
    if (cost.sacrifice || cost.discard) return 0; // Not worth working out here.
    const candidates = targetKind ? this.#candidateTargets(state, targetKind) : [null];
    const costScore = this.#costScore(state, cost, {}, sourceId);
    return Math.max(-Infinity, ...candidates.map((id) => this.#scoreEffects(state, effects, id ? [id] : [], sourceId)))
      + costScore;
  }

  #candidateTargets(state, kind) {
    if (SPELL_TARGETS.has(kind)) return state.stack.filter((s) => s.kind === 'spell').map((s) => s.id);
    const players = state.players.filter((p) => !p.hasLost).map((p) => p.id);
    if (kind === TARGET.ANY) return [...state.battlefield.filter(isCreature).map((p) => p.id), ...players];
    if (PLAYER_TARGETS.has(kind)) {
      return kind === TARGET.OPPONENT ? players.filter((id) => id !== this.#playerId) : players;
    }
    return state.battlefield.filter((p) => matchesPermanentKind(p, kind, this.#playerId)).map((p) => p.id);
  }

  /**
   * How good a spell's or ability's effects would be for us, with these targets:
   * positive is good. Killing a creature is worth the most; hitting the opponent,
   * drawing and making tokens are worth a little; hurting ourselves counts against.
   */
  #scoreEffects(state, effects, targets, sourceId) {
    const opponentId = state.players.find((p) => p.id !== this.#playerId).id;
    const byId = (id) => state.battlefield.find((p) => p.id === id);
    const creatures = state.battlefield.filter(isCreature);
    // +1 for things that are ours, -1 for things that are the opponent's.
    const side = (id) => ((id === this.#playerId || byId(id)?.controllerId === this.#playerId) ? 1 : -1);
    const preCombat = state.phase === 'precombatMain' && state.activePlayerId === this.#playerId;
    const canAttack = (c) => !c.tapped && (!c.summoningSick || hasKeyword(c, KEYWORD.HASTE)) && !hasKeyword(c, KEYWORD.DEFENDER);
    const worth = (p) => (isCreature(p) ? 10 + p.power : 5);
    let score = 0;
    for (const effect of effects) {
      const affected = {
        [AFFECTED.TARGET]: targets,
        [AFFECTED.YOU]: [this.#playerId],
        [AFFECTED.EACH_OPPONENT]: [opponentId],
        [AFFECTED.EACH_PLAYER]: [this.#playerId, opponentId],
        [AFFECTED.EACH_CREATURE]: creatures.map((p) => p.id),
        [AFFECTED.EACH_CREATURE_YOU_CONTROL]: creatures.filter((p) => p.controllerId === this.#playerId).map((p) => p.id),
        [AFFECTED.SOURCE]: [sourceId],
      }[effectAffects(effect)] ?? [];
      for (const id of affected) {
        const spell = state.stack.find((s) => s.id === id);
        if (spell && effect.type === EFFECT.COUNTER_SPELL) {
          score += spell.controllerId === this.#playerId ? -6 : 6;
          continue;
        }
        const permanent = byId(id);
        const isPlayer = !permanent && state.players.some((p) => p.id === id);
        if (!permanent && !isPlayer) continue;
        switch (effect.type) {
          case EFFECT.DEAL_DAMAGE:
            if (isPlayer) score -= side(id) * (side(id) > 0 ? 3 : 1);
            else if (permanent.toughness - permanent.damage <= effect.amount) score -= side(id) * worth(permanent);
            break;
          case EFFECT.DESTROY:
          case EFFECT.EXILE:
            score -= side(id) * worth(permanent);
            break;
          case EFFECT.RETURN_TO_HAND:
            score -= side(id) * (permanent.token ? worth(permanent) : worth(permanent) / 2);
            break;
          case EFFECT.TAP:
            // Tapping a would-be blocker before attacking.
            if (!permanent.tapped && isCreature(permanent) && preCombat) score -= side(id) * 2;
            break;
          case EFFECT.PUMP: {
            if (!isCreature(permanent)) break;
            const toughness = permanent.toughness + (effect.toughness ?? 0);
            if (toughness - permanent.damage <= 0) score -= side(id) * worth(permanent);
            else if (side(id) > 0 && preCombat && canAttack(permanent) && (effect.power ?? 0) > 0) score += 2;
            break;
          }
          case EFFECT.ADD_COUNTERS:
            if (isCreature(permanent)) score += side(id) * 3;
            break;
          case EFFECT.GAIN_LIFE: {
            // Life matters more when it's running low.
            const life = state.players.find((p) => p.id === id).life;
            score += side(id) * effect.amount * (life <= 10 ? 1 : 0.4);
            break;
          }
          case EFFECT.LOSE_LIFE:
            score -= side(id) * (side(id) > 0 ? 3 : 1);
            break;
          case EFFECT.DRAW_CARDS:
            score += side(id) * 1.5 * effect.count;
            break;
          case EFFECT.MILL:
            score -= side(id) * 0.5;
            break;
          case EFFECT.CREATE_TOKEN:
            score += side(id) * 3 * (effect.count ?? 1);
            break;
          default:
            break; // Mana and attaching aren't worth anything on their own.
        }
      }
    }
    return score;
  }

  /** What paying a cost's sacrifices and life would lose us (zero or negative). */
  #costScore(state, cost, costChoices, sourceId) {
    const byId = (id) => state.battlefield.find((p) => p.id === id);
    const sacrificed = [...(cost.sacrificeSelf ? [sourceId] : []), ...(costChoices.sacrifice ?? [])].map(byId);
    return -(cost.life ?? 0) / 2
      - sacrificed.reduce((sum, p) => sum + (!p ? 0 : isCreature(p) ? p.power + p.toughness + (p.token ? 0 : 1) : 1), 0)
      - (costChoices.discard?.length ?? 0) * 2;
  }

  /**
   * Picks a spell to cast, and its target and cost choices, by the score of its
   * effects: removal at the opponent's creatures, burn at their face, pumps on
   * our creatures that can still attack, and so on. Auras and Equipment go on our
   * own creatures; other permanents are always worth casting.
   */
  #chooseCast(state, me, mine, onOwnCreatures) {
    let best = null;
    let bestScore = 0;
    for (const action of mine.filter((a) => a.type === ACTION.CAST_SPELL)) {
      const card = me.hand.find((c) => c.id === action.cardId);
      const costScore = this.#costScore(state, card.additionalCost ?? {}, action.costChoices ?? {}, card.id);
      const score = card.spell
        ? this.#scoreEffects(state, card.spell.effects, action.targets ?? [], card.id) + costScore
        : (onOwnCreatures(action) ? 1 : 0) + costScore;
      if (score > bestScore) {
        best = action;
        bestScore = score;
      }
    }
    return best;
  }

  /** Picks a non-mana ability of one of our permanents worth activating, the same way. */
  #chooseActivation(state, mine, abilityOf) {
    if (!this.#isSorceryTiming(state)) return null;
    let best = null;
    let bestScore = 0;
    for (const action of mine.filter((a) => a.type === ACTION.ACTIVATE_ABILITY)) {
      const ability = abilityOf(action);
      if (!ability || ability.isManaAbility || ability.id === 'equip') continue;
      const score = this.#scoreEffects(state, ability.effects, action.targets ?? [], action.cardId)
        + this.#costScore(state, ability.cost, action.costChoices ?? {}, action.cardId);
      if (score > bestScore) {
        best = action;
        bestScore = score;
      }
    }
    return best;
  }

  /** Attack with everything if we have more ready creatures than they have untapped blockers. */
  #planAttack(state) {
    const ready = state.validActions
      .filter((a) => a.playerId === this.#playerId && a.type === ACTION.TOGGLE_ATTACKER)
      .map((a) => a.cardId);
    const theirBlockers = state.battlefield
      .filter((p) => p.controllerId !== this.#playerId && isCreature(p) && !p.tapped);
    return ready.length > theirBlockers.length ? ready : [];
  }

  /**
   * Block each attacker with one creature that can legally block it (two for
   * menace), while creatures last. Blocks already chosen count as possible too.
   */
  #planBlocks(state) {
    const { blocks } = state.pendingDecision;
    const canBlock = (blockerId, attackerId) => blocks[blockerId] === attackerId || state.validActions.some((a) => (
      a.playerId === this.#playerId && a.type === ACTION.SET_BLOCKER && a.cardId === blockerId && a.attackerId === attackerId
    ));
    const available = new Set(state.validActions
      .filter((a) => a.playerId === this.#playerId && a.type === ACTION.SET_BLOCKER)
      .map((a) => a.cardId));
    const plan = {};
    for (const { cardId: attackerId } of state.combat.attackers) {
      const attacker = state.battlefield.find((p) => p.id === attackerId);
      const needed = hasKeyword(attacker, KEYWORD.MENACE) ? 2 : 1;
      const chosen = [...available].filter((id) => canBlock(id, attackerId)).slice(0, needed);
      if (chosen.length < needed) continue;
      for (const id of chosen) {
        plan[id] = attackerId;
        available.delete(id);
      }
    }
    return plan;
  }

  /** Toggle the first creature that differs from the plan, or confirm once they match. */
  #moveTowards(current, wanted, find, toggleType, confirmType) {
    const differs = (id) => current.includes(id) !== wanted.includes(id);
    const next = [...current, ...wanted].find(differs);
    return (next && find(toggleType, (a) => a.cardId === next)) || find(confirmType);
  }

  #chooseBlock(state, plan, find) {
    const { blocks } = state.pendingDecision;
    for (const blockerId of new Set([...Object.keys(blocks), ...Object.keys(plan)])) {
      const wanted = plan[blockerId] ?? null;
      if ((blocks[blockerId] ?? null) !== wanted) {
        const action = find(ACTION.SET_BLOCKER, (a) => a.cardId === blockerId && a.attackerId === wanted);
        if (action) return action;
      }
    }
    return find(ACTION.CONFIRM_BLOCKERS);
  }

  #onState(state) {
    clearTimeout(this.#timer);
    const action = this.chooseAction(state);
    if (!action) return;

    if (this.#delayMs === null) {
      this.emit('action', action);
      return;
    }
    this.#timer = setTimeout(() => {
      // Only act if nothing has changed since this state was emitted.
      if (this.#game.getState().version === state.version) this.emit('action', action);
    }, this.#delayMs);
  }
}
