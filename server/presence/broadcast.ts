import type { WebSocket } from 'ws';
import pino from 'pino';
import type { WorldEvent, WorldState } from './types.js';

const log = pino({ name: 'harbor:broadcast' });

interface TrackedClient {
  ws: WebSocket;
  userId: string;
  lastSequence: number;
  connectedAt: number;
}

export class BroadcastManager {
  private clients: Map<WebSocket, TrackedClient> = new Map();

  /**
   * Register a new WebSocket client.
   */
  addClient(ws: WebSocket, userId: string): void {
    this.clients.set(ws, {
      ws,
      userId,
      lastSequence: 0,
      connectedAt: Date.now(),
    });
    log.info({ userId, total: this.clients.size }, 'Client connected');
  }

  /**
   * Remove a WebSocket client on disconnect.
   */
  removeClient(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (client) {
      log.info(
        { userId: client.userId, total: this.clients.size - 1 },
        'Client disconnected',
      );
    }
    this.clients.delete(ws);
  }

  /**
   * Broadcast an event delta to all connected clients.
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
          log.error({ err, userId: client.userId }, 'Failed to send to client');
          failed++;
        }
      }
    }

    log.debug(
      { type: event.type, sequence: event.sequence, sent, failed },
      'Event broadcast',
    );
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
