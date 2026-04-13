import pino from 'pino';
import {
  persistEvent,
  getEventsSince as dbGetEventsSince,
  getLatestSnapshot,
  saveSnapshot,
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
    // Try to restore from snapshot, otherwise build default state
    const snapshot = getLatestSnapshot();
    if (snapshot) {
      this.state = snapshot;
      log.info({ sequence: snapshot.sequence }, 'Restored state from snapshot');
    } else {
      this.state = this.buildDefaultState();
      log.info('Initialized default world state');
    }
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
  applyEvent(
    event: Omit<WorldEvent, 'sequence'>,
  ): WorldEvent & { sequence: number } {
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

    log.debug(
      { type: fullEvent.type, seq, agentId: fullEvent.agentId },
      'Event applied',
    );
    return fullEvent;
  }

  /**
   * Get events since a given sequence number (for reconnecting clients).
   */
  getEventsSince(sequence: number): WorldEvent[] {
    return dbGetEventsSince(sequence);
  }

  /**
   * Apply an event's effects to the in-memory world state.
   */
  private applyToState(event: WorldEvent & { sequence: number }): void {
    const { type, agentId, data } = event;

    switch (type) {
      case 'agent:move': {
        if (!agentId || !this.state.agents[agentId]) break;
        const agent = this.state.agents[agentId];
        if (data.position) agent.position = data.position as Position;
        if (data.rotation !== undefined)
          agent.rotation = data.rotation as number;
        if (data.zone) agent.zone = data.zone as string;
        agent.lastActive = event.timestamp;
        break;
      }

      case 'agent:speak': {
        if (!agentId || !this.state.agents[agentId]) break;
        const agent = this.state.agents[agentId];
        agent.speaking = true;
        agent.activity = 'talking';
        agent.animation = 'talking';
        agent.lastActive = event.timestamp;
        // Auto-clear speaking after a delay (handled by caller or timeout)
        setTimeout(() => {
          if (this.state.agents[agentId]) {
            this.state.agents[agentId].speaking = false;
            if (this.state.agents[agentId].activity === 'talking') {
              this.state.agents[agentId].activity = 'idle';
              this.state.agents[agentId].animation = 'idle';
            }
          }
        }, 5000);
        break;
      }

      case 'agent:gesture': {
        if (!agentId || !this.state.agents[agentId]) break;
        const agent = this.state.agents[agentId];
        if (data.animation) agent.animation = data.animation as string;
        agent.lastActive = event.timestamp;
        // Reset animation after duration
        const duration = (data.duration as number) || 3000;
        setTimeout(() => {
          if (this.state.agents[agentId]) {
            this.state.agents[agentId].animation = 'idle';
          }
        }, duration);
        break;
      }

      case 'agent:status': {
        if (!agentId || !this.state.agents[agentId]) break;
        const agent = this.state.agents[agentId];
        if (data.activity) agent.activity = data.activity as AgentActivity;
        if (data.mood) agent.mood = data.mood as string;
        if (data.animation) agent.animation = data.animation as string;
        agent.lastActive = event.timestamp;
        break;
      }

      case 'user:join': {
        this.state.user.online = true;
        this.state.user.lastSeen = event.timestamp;
        if (data.zone) this.state.user.zone = data.zone as string;
        if (data.position) this.state.user.position = data.position as Position;
        break;
      }

      case 'user:leave': {
        this.state.user.online = false;
        this.state.user.lastSeen = event.timestamp;
        break;
      }

      case 'user:chat': {
        // Chat messages are events but don't mutate spatial state.
        // They get broadcast to clients via the event stream.
        break;
      }

      case 'room:update': {
        if (data.name) this.state.room.name = data.name as string;
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
    } catch (err) {
      log.error({ err }, 'Failed to save snapshot');
    }
  }
}
