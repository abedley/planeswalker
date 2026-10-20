import { BasicAIController } from '../ai/BasicAIController.js';
import { SearchAIController } from '../ai/SearchAIController.js';
import { AI_KIND } from './campaign.js';

/**
 * The controller for a campaign opponent (`matchSetup(...).cpu`), so a UI needs
 * no knowledge of the AI classes. `delayMs` paces the basic AI; `responseMs` and
 * `jitterMs` pace the search AI, which thinks for `ai.budgetMs` on its own turn.
 * Call `.detach()` on it when the fight ends.
 */
export function createCpuController(game, cpu, { delayMs = 300, responseMs, jitterMs, seed } = {}) {
  const { playerId, ai } = cpu;
  switch (ai.kind) {
    case AI_KIND.BASIC:
      return new BasicAIController({ game, playerId, delayMs });
    case AI_KIND.SEARCH: {
      const options = Object.fromEntries(Object.entries({ responseMs, jitterMs, seed, budgetMs: ai.budgetMs })
        .filter(([, value]) => value !== undefined));
      return new SearchAIController({ game, playerId, weights: ai.weights, ...options });
    }
    default:
      throw new Error(`Unknown AI kind: ${ai.kind}`);
  }
}
