/**
 * Agent Capability Definitions — Per-agent action scoping.
 *
 * Each agent gets a set of capabilities that determine what actions
 * they can perform in the Harbor space. Tokens are JWTs signed by auth.ts.
 */

import pino from 'pino';
import { createCapabilityToken } from './auth.js';

const log = pino({ name: 'harbor:capabilities' });

// --- Capability definitions ---

export type Capability = 'move' | 'speak' | 'gesture' | 'status' | 'read' | '*';

interface AgentCapabilityProfile {
  capabilities: Capability[];
  talkBudgetPerHour: number;
  maxBurstMessages: number;
  cooldownAfterBurstMs: number;
}

/**
 * Per-agent capability profiles.
 * Margot gets full access, others are scoped by role.
 */
const AGENT_PROFILES: Record<string, AgentCapabilityProfile> = {
  margot: {
    capabilities: ['*'],
    talkBudgetPerHour: 60,
    maxBurstMessages: 10,
    cooldownAfterBurstMs: 30_000,
  },
  bud: {
    capabilities: ['move', 'speak', 'gesture', 'status', 'read'],
    talkBudgetPerHour: 30,
    maxBurstMessages: 5,
    cooldownAfterBurstMs: 60_000,
  },
  lou: {
    capabilities: ['move', 'speak', 'gesture', 'status', 'read'],
    talkBudgetPerHour: 40,
    maxBurstMessages: 8,
    cooldownAfterBurstMs: 45_000,
  },
  nygma: {
    capabilities: ['move', 'speak', 'gesture', 'status', 'read'],
    talkBudgetPerHour: 20,
    maxBurstMessages: 3,
    cooldownAfterBurstMs: 90_000,
  },
  ivy: {
    capabilities: ['move', 'speak', 'gesture', 'status', 'read'],
    talkBudgetPerHour: 25,
    maxBurstMessages: 5,
    cooldownAfterBurstMs: 60_000,
  },
  harvey: {
    capabilities: ['move', 'speak', 'gesture', 'status', 'read'],
    talkBudgetPerHour: 15,
    maxBurstMessages: 3,
    cooldownAfterBurstMs: 120_000,
  },
};

const DEFAULT_PROFILE: AgentCapabilityProfile = {
  capabilities: ['read', 'status'],
  talkBudgetPerHour: 10,
  maxBurstMessages: 3,
  cooldownAfterBurstMs: 60_000,
};

/**
 * Get the capability profile for an agent.
 */
export function getAgentProfile(agentId: string): AgentCapabilityProfile {
  return AGENT_PROFILES[agentId] ?? DEFAULT_PROFILE;
}

/**
 * Generate a capability token for an agent.
 */
export function generateAgentToken(agentId: string): string {
  const profile = getAgentProfile(agentId);
  const token = createCapabilityToken(agentId, profile.capabilities);
  log.info({ agentId, capabilities: profile.capabilities }, 'Generated capability token');
  return token;
}

/**
 * Generate tokens for all known agents.
 */
export function generateAllAgentTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const agentId of Object.keys(AGENT_PROFILES)) {
    tokens[agentId] = generateAgentToken(agentId);
  }
  log.info({ count: Object.keys(tokens).length }, 'Generated all agent tokens');
  return tokens;
}

/**
 * List all known agent IDs with their profiles (for admin API).
 */
export function listAgentProfiles(): Record<string, AgentCapabilityProfile> {
  return { ...AGENT_PROFILES };
}
