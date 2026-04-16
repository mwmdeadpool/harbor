import type { WebSocket } from 'ws';
import pino from 'pino';
import type { WorldEvent, WorldState } from './types.js';

const log = pino({ name: 'harbor:broadcast' });

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 30_000;

interface TrackedClient {
  ws: WebSocket;
  userId: string;
  lastSequence: number;
  connectedAt: number;
  lastPong: number;
}

export class BroadcastManager {
  private clients: Map<WebSocket, TrackedClient> = new Map();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startHeartbeat();
  }

  /**
   * Start the ping/pong heartbeat loop to detect dead connections.
   */
  private startHeartbeat(): void {
    this.pingTimer = setInterval(() => {
      const now = Date.now();
      const staleThreshold = now - PONG_TIMEOUT_MS;

      for (const [ws, client] of this.clients.entries()) {
        // Check if client missed pong deadline
        if (client.lastPong < staleThreshold) {
          log.warn(
            { userId: client.userId, lastPong: client.lastPong },
            'Stale WebSocket connection — terminating',
          );
          try {
            ws.terminate();
          } catch {
            // already dead
          }
          this.clients.delete(ws);
          continue;
        }

        // Send ping
        try {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', timestamp: now }));
          }
        } catch (err) {
          log.warn({ err, userId: client.userId }, 'Failed to send ping — removing client');
          try {
            ws.terminate();
          } catch {
            // ignore
          }
          this.clients.delete(ws);
        }
      }
    }, PING_INTERVAL_MS);
  }

  /**
   * Stop the heartbeat loop (for graceful shutdown).
   */
  stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Record a pong response from a client.
   */
  recordPong(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (client) {
      client.lastPong = Date.now();
    }
  }

  /**
   * Register a new WebSocket client.
   */
  addClient(ws: WebSocket, userId: string): void {
    const now = Date.now();
    this.clients.set(ws, {
      ws,
      userId,
      lastSequence: 0,
      connectedAt: now,
      lastPong: now,
    });
    log.info({ userId, total: this.clients.size }, 'Client connected');
  }

  /**
   * Remove a WebSocket client on disconnect.
   */
  removeClient(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (client) {
      log.info({ userId: client.userId, total: this.clients.size - 1 }, 'Client disconnected');
    }
    this.clients.delete(ws);
  }

  /**
   * Broadcast an event delta to all connected clients.
   * Errors on individual clients are caught so the loop continues.
   */
  broadcastEvent(event: WorldEvent): void {
    const payload = JSON.stringify({ type: 'event', data: event });
    let sent = 0;
    let failed = 0;

    for (const [ws, client] of this.clients.entries()) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(payload);
          client.lastSequence = event.sequence ?? client.lastSequence;
          sent++;
        } catch (err) {
          log.error({ err, userId: client.userId }, 'Failed to send to client — skipping');
          failed++;
          // Don't remove the client here; let the heartbeat handle cleanup
        }
      }
    }

    log.debug({ type: event.type, sequence: event.sequence, sent, failed }, 'Event broadcast');
  }

  /**
   * Send the full world state to a specific client (on initial connection).
   */
  sendFullState(ws: WebSocket, state: WorldState): void {
    const payload = JSON.stringify({ type: 'state', data: state });
    try {
      ws.send(payload);
      const client = this.clients.get(ws);
      if (client) {
        client.lastSequence = state.sequence;
      }
      log.debug({ sequence: state.sequence }, 'Full state sent to client');
    } catch (err) {
      log.error({ err }, 'Failed to send full state');
    }
  }

  /**
   * Get the number of connected clients.
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Get the last known sequence for a specific client.
   */
  getClientSequence(ws: WebSocket): number {
    return this.clients.get(ws)?.lastSequence ?? 0;
  }
}
