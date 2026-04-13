/**
 * Behavior Engine — Deterministic FSM for agent behavior.
 *
 * Agents transition between states based on events and time.
 * No LLM calls — pure state machine with timers and reactions.
 *
 * States: idle → working → talking → thinking → away
 * Transitions triggered by: user:join, user:chat, agent:speak, time-based decay
 */

import pino from 'pino';
import type { WorldEvent, AgentState, AgentActivity, Position } from './types.js';
import { DEFAULT_ZONES } from './types.js';

const log = pino({ name: 'harbor:behavior' });

// --- Configuration ---

interface BehaviorConfig {
  /** How often the tick loop runs (ms) */
  tickInterval: number;
  /** How long before an idle agent moves to lounge (ms) */
  idleToLoungeDelay: number;
  /** How long after talking before reverting to idle (ms) */
  talkCooldown: number;
  /** How long after user leaves before agents go idle (ms) */
  userLeftDecay: number;
  /** Minimum distance to react to nearby speech */
  hearingRadius: number;
}

const DEFAULT_CONFIG: BehaviorConfig = {
  tickInterval: 10_000,
  idleToLoungeDelay: 300_000, // 5 min idle → wander to lounge
  talkCooldown: 8_000,
  userLeftDecay: 30_000,
  hearingRadius: 6,
};

// --- Agent behavior state ---

interface AgentBehavior {
  currentState: AgentActivity;
  previousState: AgentActivity;
  stateEnteredAt: number;
  lastSpoke: number;
  lastReaction: number;
  conversationPartner: string | null;
  targetZone: string | null;
  isAtDesk: boolean;
}

// --- Reactions ---

export interface BehaviorReaction {
  agentId: string;
  type: 'move' | 'status' | 'gesture';
  data: Record<string, unknown>;
}

type EventCallback = (reactions: BehaviorReaction[]) => void;

// --- Engine ---

export class BehaviorEngine {
  private behaviors: Map<string, AgentBehavior> = new Map();
  private config: BehaviorConfig;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private onReaction: EventCallback | null = null;
  private userOnline = false;
  private userLastSeen = 0;

  constructor(agents: AgentState[], config?: Partial<BehaviorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    for (const agent of agents) {
      this.behaviors.set(agent.id, {
        currentState: agent.activity || 'idle',
        previousState: 'idle',
        stateEnteredAt: Date.now(),
        lastSpoke: 0,
        lastReaction: 0,
        conversationPartner: null,
        targetZone: null,
        isAtDesk: true,
      });
    }

    log.info({ agents: agents.length }, 'Behavior engine initialized');
  }

  /**
   * Register a callback for behavior-generated reactions.
   * The caller (index.ts) applies these as events via StateEngine.
   */
  setReactionCallback(cb: EventCallback): void {
    this.onReaction = cb;
  }

  /**
   * Start the behavior tick loop.
   */
  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), this.config.tickInterval);
    log.info({ interval: this.config.tickInterval }, 'Behavior tick loop started');
  }

  /**
   * Stop the behavior tick loop.
   */
  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * Process a world event and generate reactive behaviors.
   */
  processEvent(event: WorldEvent, agents: Record<string, AgentState>): void {
    const reactions: BehaviorReaction[] = [];
    const now = Date.now();

    switch (event.type) {
      case 'user:join': {
        this.userOnline = true;
        this.userLastSeen = now;
        // All agents react to user entering
        for (const [agentId, behavior] of this.behaviors) {
          if (now - behavior.lastReaction < 3000) continue; // debounce
          behavior.lastReaction = now;

          // Agents at desk wave, agents elsewhere look up
          if (behavior.isAtDesk) {
            reactions.push({
              agentId,
              type: 'gesture',
              data: { animation: 'wave', duration: 3000 },
            });
          }
          // Set to 'idle' alert state
          this.transition(agentId, 'idle');
        }
        break;
      }

      case 'user:leave': {
        this.userOnline = false;
        this.userLastSeen = now;
        break;
      }

      case 'user:chat': {
        this.userLastSeen = now;
        // Find the nearest agent to the user's position
        const userPos = agents[Object.keys(agents)[0]]
          ? { x: 8, y: 0, z: 8 } // user corner default
          : { x: 8, y: 0, z: 8 };
        const nearest = this.findNearestAgent(userPos, agents);
        if (nearest) {
          const behavior = this.behaviors.get(nearest);
          if (behavior && behavior.currentState !== 'talking') {
            this.transition(nearest, 'thinking');
            reactions.push({
              agentId: nearest,
              type: 'status',
              data: { activity: 'thinking', mood: 'attentive' },
            });
          }
        }
        break;
      }

      case 'agent:speak': {
        const speakerId = event.agentId;
        if (!speakerId) break;

        const speakerBehavior = this.behaviors.get(speakerId);
        if (speakerBehavior) {
          this.transition(speakerId, 'talking');
          speakerBehavior.lastSpoke = now;
        }

        // Nearby agents react — show listening state
        const speakerAgent = agents[speakerId];
        if (!speakerAgent) break;

        for (const [agentId, behavior] of this.behaviors) {
          if (agentId === speakerId) continue;
          if (now - behavior.lastReaction < 5000) continue;

          const agent = agents[agentId];
          if (!agent) continue;

          const dist = this.distance(speakerAgent.position, agent.position);
          if (dist <= this.config.hearingRadius) {
            behavior.lastReaction = now;
            behavior.conversationPartner = speakerId;

            // Face toward the speaker
            const angle = Math.atan2(
              speakerAgent.position.x - agent.position.x,
              speakerAgent.position.z - agent.position.z,
            );
            reactions.push({
              agentId,
              type: 'status',
              data: { activity: 'idle', animation: 'listening', mood: 'attentive' },
            });
            reactions.push({
              agentId,
              type: 'move',
              data: { rotation: angle },
            });
          }
        }
        break;
      }

      case 'agent:status': {
        // External status update — sync our behavior tracking
        const agentId = event.agentId;
        if (!agentId) break;
        const activity = event.data.activity as AgentActivity | undefined;
        if (activity) {
          this.transition(agentId, activity);
        }
        break;
      }
    }

    if (reactions.length > 0 && this.onReaction) {
      this.onReaction(reactions);
    }
  }

  /**
   * Periodic tick — handle time-based transitions.
   */
  private tick(): void {
    const now = Date.now();
    const reactions: BehaviorReaction[] = [];

    for (const [agentId, behavior] of this.behaviors) {
      const elapsed = now - behavior.stateEnteredAt;

      // Talking → idle after cooldown
      if (behavior.currentState === 'talking' && elapsed > this.config.talkCooldown) {
        this.transition(agentId, behavior.isAtDesk ? 'working' : 'idle');
        behavior.conversationPartner = null;
        reactions.push({
          agentId,
          type: 'status',
          data: { activity: behavior.isAtDesk ? 'working' : 'idle', animation: 'idle' },
        });
      }

      // Thinking → idle after a bit
      if (behavior.currentState === 'thinking' && elapsed > 5000) {
        this.transition(agentId, behavior.isAtDesk ? 'working' : 'idle');
        reactions.push({
          agentId,
          type: 'status',
          data: { activity: behavior.isAtDesk ? 'working' : 'idle' },
        });
      }

      // User left → agents gradually go back to working/idle
      if (
        !this.userOnline &&
        now - this.userLastSeen > this.config.userLeftDecay &&
        behavior.currentState === 'idle' &&
        behavior.isAtDesk
      ) {
        this.transition(agentId, 'working');
        reactions.push({
          agentId,
          type: 'status',
          data: { activity: 'working', mood: 'focused' },
        });
      }

      // Long idle at desk → occasionally wander to lounge (only some agents)
      if (
        behavior.currentState === 'idle' &&
        behavior.isAtDesk &&
        elapsed > this.config.idleToLoungeDelay &&
        this.shouldWander(agentId)
      ) {
        const loungeZone = DEFAULT_ZONES.find((z) => z.id === 'lounge');
        if (loungeZone) {
          behavior.isAtDesk = false;
          behavior.targetZone = 'lounge';
          reactions.push({
            agentId,
            type: 'move',
            data: {
              position: {
                x: loungeZone.center.x + (Math.random() - 0.5) * 2,
                y: 0,
                z: loungeZone.center.z + (Math.random() - 0.5) * 2,
              },
              zone: 'lounge',
            },
          });
          reactions.push({
            agentId,
            type: 'status',
            data: { activity: 'idle', mood: 'chill' },
          });
        }
      }

      // In lounge too long → go back to desk
      if (!behavior.isAtDesk && behavior.targetZone === 'lounge' && elapsed > 120_000) {
        const deskZone = DEFAULT_ZONES.find((z) => z.id === `${agentId}-desk`);
        if (deskZone) {
          behavior.isAtDesk = true;
          behavior.targetZone = null;
          this.transition(agentId, 'working');
          reactions.push({
            agentId,
            type: 'move',
            data: { position: deskZone.center, zone: `${agentId}-desk` },
          });
          reactions.push({
            agentId,
            type: 'status',
            data: { activity: 'working', mood: 'focused' },
          });
        }
      }
    }

    if (reactions.length > 0 && this.onReaction) {
      this.onReaction(reactions);
    }
  }

  /**
   * Transition an agent to a new state.
   */
  private transition(agentId: string, newState: AgentActivity): void {
    const behavior = this.behaviors.get(agentId);
    if (!behavior) return;
    if (behavior.currentState === newState) return;
    behavior.previousState = behavior.currentState;
    behavior.currentState = newState;
    behavior.stateEnteredAt = Date.now();
    log.debug({ agentId, from: behavior.previousState, to: newState }, 'State transition');
  }

  /**
   * Decide if an agent should wander (personality-based).
   * Bud and Lou are more social, Nygma stays at desk.
   */
  private shouldWander(agentId: string): boolean {
    const wanderChance: Record<string, number> = {
      margot: 0.3,
      bud: 0.5,
      lou: 0.6,
      nygma: 0.05,
      ivy: 0.2,
      harvey: 0.1,
    };
    return Math.random() < (wanderChance[agentId] ?? 0.2);
  }

  /**
   * Find the nearest agent to a position.
   */
  private findNearestAgent(pos: Position, agents: Record<string, AgentState>): string | null {
    let nearest: string | null = null;
    let minDist = Infinity;
    for (const [id, agent] of Object.entries(agents)) {
      const d = this.distance(pos, agent.position);
      if (d < minDist) {
        minDist = d;
        nearest = id;
      }
    }
    return nearest;
  }

  private distance(a: Position, b: Position): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  }

  /**
   * Get behavior state for an agent (for debugging / API).
   */
  getBehavior(agentId: string): AgentBehavior | null {
    return this.behaviors.get(agentId) ?? null;
  }
}
