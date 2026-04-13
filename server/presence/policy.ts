import pino from 'pino';

const log = pino({ name: 'harbor:policy' });

interface PolicyResult {
  approved: boolean;
  reason?: string;
}

interface ActionRecord {
  timestamps: number[];
}

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // max actions per agent per window

export class PolicyEngine {
  private actionCounts: Map<string, ActionRecord> = new Map();

  /**
   * Evaluate whether an agent action should be permitted.
   * MVP: rate limiting only — 10 actions per agent per minute.
   */
  evaluate(agentId: string, action: string): PolicyResult {
    const now = Date.now();
    const cutoff = now - RATE_LIMIT_WINDOW_MS;

    let record = this.actionCounts.get(agentId);
    if (!record) {
      record = { timestamps: [] };
      this.actionCounts.set(agentId, record);
    }

    // Prune timestamps outside the sliding window
    record.timestamps = record.timestamps.filter((t) => t > cutoff);

    if (record.timestamps.length >= RATE_LIMIT_MAX) {
      log.warn({ agentId, action, count: record.timestamps.length }, 'Rate limit exceeded');
      return {
        approved: false,
        reason: `Rate limit exceeded: ${record.timestamps.length}/${RATE_LIMIT_MAX} actions in the last minute`,
      };
    }

    record.timestamps.push(now);
    return { approved: true };
  }

  /**
   * Get current action count for an agent within the sliding window.
   */
  getActionCount(agentId: string): number {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    const record = this.actionCounts.get(agentId);
    if (!record) return 0;
    record.timestamps = record.timestamps.filter((t) => t > cutoff);
    return record.timestamps.length;
  }

  /**
   * Reset rate limit tracking (e.g. for testing).
   */
  reset(): void {
    this.actionCounts.clear();
  }
}
