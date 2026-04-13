/**
 * Harbor Event Adapter
 *
 * Bridge between NanoClaw agent orchestration and Harbor's 3D presence system.
 * Converts NanoClaw agent responses → Harbor presence updates (speaking state, chat).
 * Converts Harbor user input (user typing in 3D chat) → NanoClaw inbound messages.
 */

import WebSocket from 'ws';

// --- Types ---

export interface HarborAdapterConfig {
  /** Harbor server base URL, e.g. http://localhost:3333 */
  serverUrl: string;
  /** Capability token for adapter authentication */
  token: string;
  /** Reconnect delay in ms (default: 3000) */
  reconnectDelay?: number;
  /** Max reconnect attempts before giving up (default: 20) */
  maxReconnectAttempts?: number;
}

export interface HarborInboundMessage {
  /** User who sent the message */
  sender: string;
  /** The text content */
  content: string;
  /** ISO timestamp */
  timestamp: string;
  /** Harbor room/zone the message came from */
  room?: string;
}

export type HarborMessageCallback = (message: HarborInboundMessage) => void;

export type AgentActivity =
  | 'idle'
  | 'working'
  | 'speaking'
  | 'listening'
  | 'thinking'
  | 'moving';

interface HarborWsMessage {
  type: string;
  payload: Record<string, unknown>;
}

// --- Adapter State ---

let ws: WebSocket | null = null;
let config: HarborAdapterConfig | null = null;
let messageCallback: HarborMessageCallback | null = null;
let connected = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;

// --- Internal Helpers ---

function log(
  level: 'info' | 'warn' | 'error' | 'debug',
  msg: string,
  data?: Record<string, unknown>,
): void {
  const prefix = `[harbor-adapter]`;
  const extra = data ? ` ${JSON.stringify(data)}` : '';
  if (level === 'error') {
    console.error(`${prefix} ${msg}${extra}`);
  } else if (level === 'warn') {
    console.warn(`${prefix} ${msg}${extra}`);
  } else if (level === 'debug') {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`${prefix} ${msg}${extra}`);
    }
  } else {
    console.log(`${prefix} ${msg}${extra}`);
  }
}

function send(msg: HarborWsMessage): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log('warn', 'Cannot send — WebSocket not open', { type: msg.type });
    return false;
  }
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch (err) {
    log('error', 'WebSocket send failed', { type: msg.type, err: String(err) });
    return false;
  }
}

function scheduleReconnect(): void {
  if (intentionalClose) return;
  const maxAttempts = config?.maxReconnectAttempts ?? 20;
  if (reconnectAttempts >= maxAttempts) {
    log('error', `Max reconnect attempts (${maxAttempts}) reached — giving up`);
    return;
  }

  const delay = config?.reconnectDelay ?? 3000;
  // Exponential backoff capped at 30s
  const backoff = Math.min(delay * Math.pow(1.5, reconnectAttempts), 30000);
  reconnectAttempts++;

  log(
    'info',
    `Reconnecting in ${Math.round(backoff)}ms (attempt ${reconnectAttempts}/${maxAttempts})`,
  );
  reconnectTimer = setTimeout(() => {
    connectWs().catch((err) => {
      log('error', 'Reconnect failed', { err: String(err) });
    });
  }, backoff);
}

function handleIncoming(raw: string): void {
  let msg: HarborWsMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    log('warn', 'Received non-JSON WebSocket message');
    return;
  }

  switch (msg.type) {
    case 'chat:message': {
      // User sent a message in Harbor's 3D chat overlay
      const payload = msg.payload as {
        sender?: string;
        content?: string;
        timestamp?: string;
        room?: string;
      };
      if (!payload.sender || !payload.content) {
        log('debug', 'Ignoring incomplete chat:message', {
          payload: msg.payload,
        });
        return;
      }
      if (messageCallback) {
        messageCallback({
          sender: payload.sender,
          content: payload.content,
          timestamp: payload.timestamp || new Date().toISOString(),
          room: payload.room,
        });
      }
      break;
    }

    case 'auth:ok':
      log('info', 'Authenticated with Harbor server');
      connected = true;
      reconnectAttempts = 0;
      break;

    case 'auth:error':
      log('error', 'Harbor authentication failed', { payload: msg.payload });
      connected = false;
      break;

    case 'pong':
      log('debug', 'Pong received');
      break;

    default:
      log('debug', 'Unhandled Harbor message type', { type: msg.type });
  }
}

async function connectWs(): Promise<void> {
  if (!config)
    throw new Error('Adapter not initialized — call initAdapter() first');

  const wsUrl = config.serverUrl.replace(/^http/, 'ws') + '/ws/adapter';

  return new Promise<void>((resolve, reject) => {
    ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        ws.terminate();
        reject(new Error('WebSocket connection timeout (10s)'));
      }
    }, 10000);

    ws.on('open', () => {
      clearTimeout(timeout);
      log('info', 'WebSocket connected to Harbor', { url: wsUrl });

      // Authenticate immediately
      send({
        type: 'auth:token',
        payload: { token: config!.token },
      });

      resolve();
    });

    ws.on('message', (data: WebSocket.Data) => {
      handleIncoming(data.toString());
    });

    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      connected = false;
      log('info', 'WebSocket closed', { code, reason: reason.toString() });
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      connected = false;
      log('error', 'WebSocket error', { err: err.message });
      // close event will fire after this, triggering reconnect
    });
  });
}

// --- Public API ---

/**
 * Initialize the Harbor adapter and connect to the Harbor server.
 */
export async function initAdapter(
  adapterConfig: HarborAdapterConfig,
): Promise<void> {
  config = adapterConfig;
  intentionalClose = false;
  reconnectAttempts = 0;

  log('info', 'Initializing Harbor adapter', { serverUrl: config.serverUrl });
  await connectWs();
}

/**
 * Send an agent response to Harbor for display in the 3D space.
 * Sets the agent's speaking state and delivers the chat text.
 */
export function sendToHarbor(agentId: string, message: string): boolean {
  // Set speaking state
  send({
    type: 'agent:state',
    payload: { agentId, activity: 'speaking' as AgentActivity },
  });

  // Send the chat message for display (and eventual TTS in Phase 2)
  const ok = send({
    type: 'agent:chat',
    payload: {
      agentId,
      text: message,
      timestamp: new Date().toISOString(),
    },
  });

  // Revert to idle after a delay proportional to message length
  // (rough estimate: 50ms per character, min 2s, max 30s)
  const displayMs = Math.min(Math.max(message.length * 50, 2000), 30000);
  setTimeout(() => {
    send({
      type: 'agent:state',
      payload: { agentId, activity: 'idle' as AgentActivity },
    });
  }, displayMs);

  return ok;
}

/**
 * Register a callback for when a user sends text in Harbor's chat overlay.
 */
export function onHarborMessage(callback: HarborMessageCallback): void {
  messageCallback = callback;
}

/**
 * Update an agent's presence/activity state in Harbor.
 */
export function updateAgentPresence(
  agentId: string,
  activity: AgentActivity,
): boolean {
  return send({
    type: 'agent:state',
    payload: { agentId, activity },
  });
}

/**
 * Check if the adapter is connected and authenticated.
 */
export function isAdapterConnected(): boolean {
  return connected && ws !== null && ws.readyState === WebSocket.OPEN;
}

/**
 * Gracefully disconnect from Harbor.
 */
export async function disconnectAdapter(): Promise<void> {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close(1000, 'Adapter shutting down');
    ws = null;
  }
  connected = false;
  log('info', 'Harbor adapter disconnected');
}
