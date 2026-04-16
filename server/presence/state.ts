import pino from 'pino';
import {
  persistEvent,
  getEventsSince as dbGetEventsSince,
  getLatestSnapshot,
  saveSnapshot,
  runCompaction,
} from './db.js';
import type {
  WorldState,
  WorldEvent,
  AgentState,
  EventType,
  Position,
  AgentActivity,
} from './types.js';
import { DEFAULT_AGENTS, DEFAULT_ROOM_CONFIG } from './types.js';

const log = pino({ name: 'harbor:state' });

const SNAPSHOT_INTERVAL = 100; // Save a snapshot every N events

export class StateEngine {
  private state: WorldState;
  private eventsSinceSnapshot = 0;

  constructor() {
    this.state = this.recover();
  }

  /**
   * Multi-stage recovery:
   * 1. Try snapshot + replay events since snapshot
   * 2. If snapshot is corrupt, replay all events from scratch
   * 3. If all recovery fails, start fresh with default state
   */
  private recover(): WorldState {
    // Stage 1: Try snapshot restore + event replay
    try {
      const snapshot = getLatestSnapshot();
      if (snapshot) {
        const state = snapshot.state;
        const snapshotSeq = snapshot.sequence;
        log.info({ sequence: snapshotSeq }, 'Restored state from snapshot');

        // Replay any events that occurred after the snapshot
        try {
          const missedEvents = dbGetEventsSince(snapshotSeq);
          if (missedEvents.length > 0) {
            log.info(
              { count: missedEvents.length, fromSeq: snapshotSeq },
              'Replaying events since snapshot',
            );
            for (const event of missedEvents) {
              this.applyToState(event as WorldEvent & { sequence: number }, state);
              if (event.sequence !== undefined) {
                state.sequence = event.sequence as number;
              }
            }
            state.timestamp = Date.now();
            log.info(
              { sequence: state.sequence, replayed: missedEvents.length },
              'Event replay complete',
            );
          }
        } catch (replayErr) {
          log.warn(
            { err: replayErr },
            'Event replay after snapshot failed — using snapshot state as-is',
          );
        }

        return state;
      }
    } catch (snapshotErr) {
      log.warn(
        { err: snapshotErr },
        'Snapshot restore failed (corrupt?) — attempting full event replay',
      );
    }

    // Stage 2: Full event replay from sequence 0
    try {
      const allEvents = dbGetEventsSince(0);
      if (allEvents.length > 0) {
        log.info({ count: allEvents.length }, 'Replaying all events from scratch');
        const state = this.buildDefaultState();
        for (const event of allEvents) {
          this.applyToState(event as WorldEvent & { sequence: number }, state);
          if (event.sequence !== undefined) {
            state.sequence = event.sequence as number;
          }
        }
        state.timestamp = Date.now();
        log.info({ sequence: state.sequence }, 'Full event replay complete');
        return state;
      }
    } catch (replayErr) {
      log.error({ err: replayErr }, 'Full event replay failed');
    }

    // Stage 3: Fresh start
    log.warn('All recovery methods failed — starting with default state');
    return this.buildDefaultState();
  }

  private buildDefaultState(): WorldState {
    const agents: Record<string, AgentState> = {};
    for (const agent of DEFAULT_AGENTS) {
      agents[agent.id] = { ...agent, lastActive: Date.now() };
    }

    return {
      sequence: 0,
      timestamp: Date.now(),
      agents,
      user: {
        online: false,
        lastSeen: 0,
        zone: 'user-corner',
        position: { x: 8, y: 0, z: 8 },
      },
      room: DEFAULT_ROOM_CONFIG,
    };
  }

  /**
   * Return the full current world state.
   */
  getState(): WorldState {
    return { ...this.state, timestamp: Date.now() };
  }

  /**
   * Return a single agent's state.
   */
  getAgentState(id: string): AgentState | null {
    return this.state.agents[id] ?? null;
  }

  /**
   * Get list of all agents.
   */
  getAgentRoster(): AgentState[] {
    return Object.values(this.state.agents);
  }

  /**
   * Validate, apply, persist, and return an event with its assigned sequence.
   */
  applyEvent(event: Omit<WorldEvent, 'sequence'>): WorldEvent & { sequence: number } {
    // Increment sequence
    this.state.sequence += 1;
    const seq = this.state.sequence;
    this.state.timestamp = Date.now();

    const fullEvent: WorldEvent & { sequence: number } = {
      ...event,
      sequence: seq,
      timestamp: event.timestamp || Date.now(),
    };

    // Apply to in-memory state
    this.applyToState(fullEvent);

    // Persist to SQLite
    try {
      persistEvent(fullEvent);
    } catch (err) {
      log.error({ err, event: fullEvent }, 'Failed to persist event');
    }

    // Periodic snapshot
    this.eventsSinceSnapshot += 1;
    if (this.eventsSinceSnapshot >= SNAPSHOT_INTERVAL) {
      this.takeSnapshot();
    }

    log.debug({ type: fullEvent.type, seq, agentId: fullEvent.agentId }, 'Event applied');
    return fullEvent;
  }

  /**
   * Get events since a given sequence number (for reconnecting clients).
   */
  getEventsSince(sequence: number): WorldEvent[] {
    return dbGetEventsSince(sequence);
  }

  /**
   * Apply an event's effects to a world state object.
   * When called without a target, applies to this.state.
   */
  private applyToState(event: WorldEvent & { sequence: number }, target?: WorldState): void {
    const state = target ?? this.state;
    const { type, agentId, data } = event;

    switch (type) {
      case 'agent:move': {
        if (!agentId || !state.agents[agentId]) break;
        const agent = state.agents[agentId];
        if (data.position) agent.position = data.position as Position;
        if (data.rotation !== undefined) agent.rotation = data.rotation as number;
        if (data.zone) agent.zone = data.zone as string;
        agent.lastActive = event.timestamp;
        break;
      }

      case 'agent:speak': {
        if (!agentId || !state.agents[agentId]) break;
        const agent = state.agents[agentId];
        agent.speaking = true;
        agent.activity = 'talking';
        agent.animation = 'talking';
        agent.lastActive = event.timestamp;
        // Auto-clear speaking after a delay (handled by caller or timeout)
        // Only set timeouts for live state, not during replay
        if (!target) {
          setTimeout(() => {
            if (this.state.agents[agentId]) {
              this.state.agents[agentId].speaking = false;
              if (this.state.agents[agentId].activity === 'talking') {
                this.state.agents[agentId].activity = 'idle';
                this.state.agents[agentId].animation = 'idle';
              }
            }
          }, 5000);
        }
        break;
      }

      case 'agent:gesture': {
        if (!agentId || !state.agents[agentId]) break;
        const agent = state.agents[agentId];
        if (data.animation) agent.animation = data.animation as string;
        agent.lastActive = event.timestamp;
        // Reset animation after duration — only for live state
        if (!target) {
          const duration = (data.duration as number) || 3000;
          setTimeout(() => {
            if (this.state.agents[agentId]) {
              this.state.agents[agentId].animation = 'idle';
            }
          }, duration);
        }
        break;
      }

      case 'agent:status': {
        if (!agentId || !state.agents[agentId]) break;
        const agent = state.agents[agentId];
        if (data.activity) agent.activity = data.activity as AgentActivity;
        if (data.mood) agent.mood = data.mood as string;
        if (data.animation) agent.animation = data.animation as string;
        agent.lastActive = event.timestamp;
        break;
      }

      case 'user:join': {
        state.user.online = true;
        state.user.lastSeen = event.timestamp;
        if (data.zone) state.user.zone = data.zone as string;
        if (data.position) state.user.position = data.position as Position;
        break;
      }

      case 'user:leave': {
        state.user.online = false;
        state.user.lastSeen = event.timestamp;
        break;
      }

      case 'user:chat': {
        // Chat messages are events but don't mutate spatial state.
        // They get broadcast to clients via the event stream.
        break;
      }

      case 'agent:conversation': {
        // Inter-agent conversation rendering — two agents talking
        // The event carries: fromAgent, toAgent, text
        // We mark both agents as talking and update their rotations to face each other
        const fromId = data.fromAgent as string;
        const toId = data.toAgent as string;
        if (fromId && state.agents[fromId]) {
          state.agents[fromId].speaking = true;
          state.agents[fromId].activity = 'talking';
          state.agents[fromId].lastActive = event.timestamp;

          if (toId && state.agents[toId]) {
            // Face toward the speaker
            const from = state.agents[fromId].position;
            const to = state.agents[toId].position;
            state.agents[toId].activity = 'idle';
            state.agents[toId].animation = 'listening';
            state.agents[toId].lastActive = event.timestamp;
            // Calculate facing angle
            const angle = Math.atan2(from.x - to.x, from.z - to.z);
            state.agents[toId].rotation = angle;
          }

          // Only set timeouts for live state
          if (!target) {
            setTimeout(() => {
              if (this.state.agents[fromId]) {
                this.state.agents[fromId].speaking = false;
                if (this.state.agents[fromId].activity === 'talking') {
                  this.state.agents[fromId].activity = 'idle';
                  this.state.agents[fromId].animation = 'idle';
                }
              }
              if (toId && this.state.agents[toId]) {
                this.state.agents[toId].animation = 'idle';
              }
            }, 5000);
          }
        }
        break;
      }

      case 'agent:react': {
        // Behavioral reaction — gesture, wave, nod, etc.
        if (!agentId || !state.agents[agentId]) break;
        const agent = state.agents[agentId];
        if (data.animation) agent.animation = data.animation as string;
        if (data.mood) agent.mood = data.mood as string;
        agent.lastActive = event.timestamp;
        // Only set timeouts for live state
        if (!target) {
          const reactDuration = (data.duration as number) || 3000;
          setTimeout(() => {
            if (this.state.agents[agentId!]) {
              this.state.agents[agentId!].animation = 'idle';
            }
          }, reactDuration);
        }
        break;
      }

      case 'room:update': {
        if (data.name) state.room.name = data.name as string;
        break;
      }

      default:
        log.warn({ type }, 'Unknown event type');
    }
  }

  private takeSnapshot(): void {
    try {
      saveSnapshot(this.state);
      this.eventsSinceSnapshot = 0;
      log.info({ sequence: this.state.sequence }, 'State snapshot saved');

      // Run compaction after snapshot — keep last 5 snapshots, purge old events
      runCompaction(5);
    } catch (err) {
      log.error({ err }, 'Failed to save snapshot');
    }
  }
}
