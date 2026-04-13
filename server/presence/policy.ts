import pino from 'pino';
import { getAgentProfile } from './capabilities.js';

const log = pino({ name: 'harbor:policy' });

interface PolicyResult {
  approved: boolean;
  reason?: string;
}

interface ActionRecord {
  timestamps: number[];
}

interface TalkBudgetRecord {
  hourlyTimestamps: number[];
  burstTimestamps: number[];
  cooldownUntil: number;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  openUntil: number;
}

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30; // max actions per agent per window (raised for behavior engine)
const BURST_WINDOW_MS = 10_000; // 10-second burst window
const CIRCUIT_BREAKER_THRESHOLD = 5; // failures before circuit opens
const CIRCUIT_BREAKER_RESET_MS = 60_000; // circuit stays open for 1 min

export class PolicyEngine {
  private actionCounts: Map<string, ActionRecord> = new Map();
  private talkBudgets: Map<string, TalkBudgetRecord> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();

  /**
   * Evaluate whether an agent action should be permitted.
   * Checks: rate limit, talk budget (for speak actions), circuit breaker.
   */
  evaluate(agentId: string, action: string): PolicyResult {
    const now = Date.now();

    // Circuit breaker check
    const breaker = this.circuitBreakers.get(agentId);
    if (breaker && breaker.openUntil > now) {
      return {
        approved: false,
        reason: `Circuit breaker open until ${new Date(breaker.openUntil).toISOString()} (${breaker.failures} failures)`,
      };
    }

    // General rate limit
    const rateResult = this.checkRateLimit(agentId, now);
    if (!rateResult.approved) return rateResult;

    // Talk budget for speak actions
    if (action === 'speak') {
      const budgetResult = this.checkTalkBudget(agentId, now);
      if (!budgetResult.approved) return budgetResult;
    }

    return { approved: true };
  }

  /**
   * Record a policy failure (for circuit breaker).
   */
  recordFailure(agentId: string): void {
    const now = Date.now();
    let breaker = this.circuitBreakers.get(agentId);
    if (!breaker) {
      breaker = { failures: 0, lastFailure: 0, openUntil: 0 };
      this.circuitBreakers.set(agentId, breaker);
    }

    // Reset if last failure was long ago
    if (now - breaker.lastFailure > CIRCUIT_BREAKER_RESET_MS * 2) {
      breaker.failures = 0;
    }

    breaker.failures++;
    breaker.lastFailure = now;

    if (breaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      breaker.openUntil = now + CIRCUIT_BREAKER_RESET_MS;
      log.warn({ agentId, failures: breaker.failures }, 'Circuit breaker opened');
    }
  }

  /**
   * Record a policy success (for circuit breaker recovery).
   */
  recordSuccess(agentId: string): void {
    const breaker = this.circuitBreakers.get(agentId);
    if (breaker && breaker.failures > 0) {
      breaker.failures = Math.max(0, breaker.failures - 1);
    }
  }

  private checkRateLimit(agentId: string, now: number): PolicyResult {
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    let record = this.actionCounts.get(agentId);
    if (!record) {
      record = { timestamps: [] };
      this.actionCounts.set(agentId, record);
    }

    record.timestamps = record.timestamps.filter((t) => t > cutoff);

    if (record.timestamps.length >= RATE_LIMIT_MAX) {
      log.warn({ agentId, count: record.timestamps.length }, 'Rate limit exceeded');
      return {
        approved: false,
        reason: `Rate limit exceeded: ${record.timestamps.length}/${RATE_LIMIT_MAX} actions in the last minute`,
      };
    }

    record.timestamps.push(now);
    return { approved: true };
  }

  private checkTalkBudget(agentId: string, now: number): PolicyResult {
    const profile = getAgentProfile(agentId);

    let budget = this.talkBudgets.get(agentId);
    if (!budget) {
      budget = { hourlyTimestamps: [], burstTimestamps: [], cooldownUntil: 0 };
      this.talkBudgets.set(agentId, budget);
    }

    // Cooldown check
    if (budget.cooldownUntil > now) {
      const remaining = Math.ceil((budget.cooldownUntil - now) / 1000);
      return {
        approved: false,
        reason: `Talk cooldown active: ${remaining}s remaining`,
      };
    }

    // Hourly budget
    const hourCutoff = now - 3_600_000;
    budget.hourlyTimestamps = budget.hourlyTimestamps.filter((t) => t > hourCutoff);
    if (budget.hourlyTimestamps.length >= profile.talkBudgetPerHour) {
      return {
        approved: false,
        reason: `Hourly talk budget exhausted: ${budget.hourlyTimestamps.length}/${profile.talkBudgetPerHour}`,
      };
    }

    // Burst detection
    const burstCutoff = now - BURST_WINDOW_MS;
    budget.burstTimestamps = budget.burstTimestamps.filter((t) => t > burstCutoff);
    if (budget.burstTimestamps.length >= profile.maxBurstMessages) {
      budget.cooldownUntil = now + profile.cooldownAfterBurstMs;
      log.info(
        { agentId, burst: budget.burstTimestamps.length, cooldownMs: profile.cooldownAfterBurstMs },
        'Burst detected, cooldown applied',
      );
      return {
        approved: false,
        reason: `Burst limit hit (${budget.burstTimestamps.length} in ${BURST_WINDOW_MS / 1000}s), cooldown: ${profile.cooldownAfterBurstMs / 1000}s`,
      };
    }

    budget.hourlyTimestamps.push(now);
    budget.burstTimestamps.push(now);
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
   * Get talk budget status for an agent.
   */
  getTalkBudgetStatus(agentId: string): {
    used: number;
    limit: number;
    burstUsed: number;
    burstLimit: number;
    cooldown: boolean;
  } {
    const profile = getAgentProfile(agentId);
    const now = Date.now();
    const budget = this.talkBudgets.get(agentId);
    if (!budget) {
      return {
        used: 0,
        limit: profile.talkBudgetPerHour,
        burstUsed: 0,
        burstLimit: profile.maxBurstMessages,
        cooldown: false,
      };
    }

    const hourCutoff = now - 3_600_000;
    const burstCutoff = now - BURST_WINDOW_MS;

    return {
      used: budget.hourlyTimestamps.filter((t) => t > hourCutoff).length,
      limit: profile.talkBudgetPerHour,
      burstUsed: budget.burstTimestamps.filter((t) => t > burstCutoff).length,
      burstLimit: profile.maxBurstMessages,
      cooldown: budget.cooldownUntil > now,
    };
  }

  /**
   * Reset all tracking (e.g. for testing).
   */
  reset(): void {
    this.actionCounts.clear();
    this.talkBudgets.clear();
    this.circuitBreakers.clear();
  }
}
