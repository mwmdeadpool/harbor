/**
 * Signal bus — maps external/internal events to agent reaction sequences.
 *
 * A Signal is a typed fact about the world ("PR opened", "CI failed",
 * "user wants Margot's attention"). resolveSignal looks up the catalog and
 * returns the agent + sequence to run, or null if the signal is unhandled.
 *
 * Keep reactions short (≤6 steps). Long-form coordination belongs in the
 * sequence endpoint, not the signal catalog.
 */

import type { AgentState, Signal, SignalReaction, SequenceStep } from './types.js';

// --- Helpers ---

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

// --- Catalog ---

type SignalHandler = (sig: Signal, agents: Record<string, AgentState>) => SignalReaction | null;

const CATALOG: Record<string, SignalHandler> = {
  /**
   * github:pr:opened — Nygma reacts to new PRs.
   * data: { title: string, author?: string, url?: string }
   */
  'github:pr:opened': (sig, agents) => {
    if (!agents.nygma) return null;
    const title = truncate(asString(sig.data?.title, 'a new pull request'), 140);
    const steps: SequenceStep[] = [
      { type: 'status', activity: 'presenting', mood: 'curious', animation: 'idle' },
      { type: 'gesture', animation: 'wave', duration: 1200 },
      { type: 'move', to: 'meeting-room' },
      { type: 'speak', text: `New PR just dropped: ${title}` },
      { type: 'status', activity: 'idle', mood: 'focused' },
    ];
    return { agentId: 'nygma', steps, cooldownMs: 60_000 };
  },

  /**
   * github:ci:failed — Bud storms to Harvey's desk to flag it.
   * data: { branch?: string, workflow?: string }
   */
  'github:ci:failed': (sig, agents) => {
    if (!agents.bud || !agents.harvey) return null;
    const branch = truncate(asString(sig.data?.branch, 'main'), 60);
    const workflow = truncate(asString(sig.data?.workflow, 'CI'), 40);
    const steps: SequenceStep[] = [
      { type: 'status', activity: 'idle', mood: 'frustrated' },
      { type: 'move', to: 'harvey' },
      { type: 'speak', text: `${workflow} broke on ${branch}. Harvey — eyes on it.` },
      { type: 'status', activity: 'working', mood: 'focused' },
    ];
    return { agentId: 'bud', steps, cooldownMs: 90_000 };
  },

  /**
   * user:summon — any agent walks to user-corner and greets.
   * data: { agentId: string, greeting?: string }
   */
  'user:summon': (sig, agents) => {
    const agentId = asString(sig.data?.agentId);
    if (!agentId || !agents[agentId]) return null;
    const greeting = truncate(asString(sig.data?.greeting, `What's up, Puddin'?`), 200);
    const steps: SequenceStep[] = [
      { type: 'status', activity: 'idle', mood: 'attentive' },
      { type: 'move', to: 'user-corner' },
      { type: 'speak', text: greeting },
      { type: 'status', activity: 'idle', mood: 'attentive' },
    ];
    return { agentId, steps, cooldownMs: 15_000 };
  },

  /**
   * agent:handoff — recipient walks to sender's zone and acknowledges.
   * data: { from: string, to: string, task?: string }
   */
  'agent:handoff': (sig, agents) => {
    const from = asString(sig.data?.from);
    const to = asString(sig.data?.to);
    if (!from || !to) return null;
    if (!agents[from] || !agents[to]) return null;
    const task = truncate(asString(sig.data?.task, 'the handoff'), 120);
    const steps: SequenceStep[] = [
      { type: 'status', activity: 'idle', mood: 'focused' },
      { type: 'move', to: from },
      { type: 'speak', text: `Got it, ${agents[from].name}. Picking up ${task}.` },
      { type: 'status', activity: 'working', mood: 'focused' },
    ];
    return { agentId: to, steps, cooldownMs: 20_000 };
  },

  /**
   * chat:mention — target agent pauses and faces the user-corner.
   * Lightweight ack — doesn't walk, just acknowledges.
   * data: { agentId: string }
   */
  'chat:mention': (sig, agents) => {
    const agentId = asString(sig.data?.agentId);
    if (!agentId || !agents[agentId]) return null;
    const steps: SequenceStep[] = [
      { type: 'status', activity: 'thinking', mood: 'attentive' },
      { type: 'gesture', animation: 'nod', duration: 1500 },
    ];
    return { agentId, steps, cooldownMs: 8_000 };
  },
};

// --- API ---

export function resolveSignal(
  sig: Signal,
  agents: Record<string, AgentState>,
): SignalReaction | null {
  const handler = CATALOG[sig.type];
  if (!handler) return null;
  return handler(sig, agents);
}

export function knownSignalTypes(): string[] {
  return Object.keys(CATALOG);
}
