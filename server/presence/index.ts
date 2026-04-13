import express from 'express';
import http from 'node:http';
import path from 'node:path';
import url from 'node:url';
import { WebSocketServer } from 'ws';
import pino from 'pino';

import { initDb, closeDb } from './db.js';
import { initAuth, loginUser, verifyToken, requireAuth, requireCapability } from './auth.js';
import type { AuthRequest } from './auth.js';
import { StateEngine } from './state.js';
import { PolicyEngine } from './policy.js';
import { BroadcastManager } from './broadcast.js';
import type { EventType } from './types.js';

const log = pino({ name: 'harbor' });
const PORT = parseInt(process.env.HARBOR_PORT || '3333', 10);
const startTime = Date.now();

// --- Initialize core systems ---

const db = initDb();
await initAuth(db);

const stateEngine = new StateEngine();
const policyEngine = new PolicyEngine();
const broadcastManager = new BroadcastManager();

// --- Express app ---

const app = express();
app.use(express.json());

// Serve static client files
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../../client/dist');
app.use(express.static(clientDist));

// Proxy /media requests to Media Service (port 3334) in production
const MEDIA_SERVICE_URL = process.env.HARBOR_MEDIA_URL || 'http://localhost:3334';
app.use('/media', (req, res) => {
  const proxyUrl = `${MEDIA_SERVICE_URL}${req.originalUrl}`;
  const proxyReq = http.request(
    proxyUrl,
    { method: req.method, headers: { ...req.headers, host: new URL(MEDIA_SERVICE_URL).host } },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    log.warn({ err, url: proxyUrl }, 'Media service proxy error');
    if (!res.headersSent) res.status(502).json({ error: 'Media service unavailable' });
  });
  req.pipe(proxyReq);
});

// --- Public endpoints ---

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    agents: Object.keys(stateEngine.getState().agents).length,
    sequence: stateEngine.getState().sequence,
    clients: broadcastManager.clientCount,
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }

  try {
    const token = await loginUser(username, password);
    res.json({ token });
  } catch (err) {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// --- Authenticated user endpoints ---

app.get('/api/state', requireAuth, (_req, res) => {
  res.json(stateEngine.getState());
});

app.get('/api/agents', requireAuth, (_req, res) => {
  res.json(stateEngine.getAgentRoster());
});

// --- Agent action endpoints (capability-scoped) ---

function handleAgentAction(eventType: EventType, capability: string) {
  return [
    requireCapability(capability),
    (req: AuthRequest, res: express.Response) => {
      const agentId = req.agentId!;
      const data = req.body || {};

      // Policy check
      const policy = policyEngine.evaluate(agentId, capability);
      if (!policy.approved) {
        res.status(429).json({ error: policy.reason });
        return;
      }

      // Apply event
      const event = stateEngine.applyEvent({
        timestamp: Date.now(),
        type: eventType,
        agentId,
        data,
      });

      // Broadcast to connected clients
      broadcastManager.broadcastEvent(event);

      res.json({ ok: true, sequence: event.sequence });
    },
  ] as express.RequestHandler[];
}

app.post('/harbor/move', ...handleAgentAction('agent:move', 'move'));
app.post('/harbor/speak', ...handleAgentAction('agent:speak', 'speak'));
app.post('/harbor/gesture', ...handleAgentAction('agent:gesture', 'gesture'));
app.post('/harbor/status', ...handleAgentAction('agent:status', 'status'));

app.get('/harbor/state', requireCapability('read'), (req: AuthRequest, res) => {
  const agentId = req.agentId!;
  const agent = stateEngine.getAgentState(agentId);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  res.json({
    self: agent,
    world: stateEngine.getState(),
  });
});

// SPA fallback — serve index.html for unmatched routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) {
      res.status(404).json({ error: 'Not found' });
    }
  });
});

// --- HTTP server + WebSocket ---

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  // Parse token from query string
  const parsedUrl = url.parse(request.url || '', true);
  const token = parsedUrl.query.token as string | undefined;

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    const { userId } = verifyToken(token);
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, userId);
    });
  } catch (err) {
    log.warn('WebSocket auth failed');
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});

wss.on(
  'connection',
  (ws: import('ws').WebSocket, _request: import('http').IncomingMessage, userId: string) => {
    broadcastManager.addClient(ws, userId);

    // Send full state on connect
    broadcastManager.sendFullState(ws, stateEngine.getState());

    // Emit user:join event
    const joinEvent = stateEngine.applyEvent({
      timestamp: Date.now(),
      type: 'user:join',
      userId,
      data: { userId },
    });
    broadcastManager.broadcastEvent(joinEvent);

    ws.on('message', (raw: import('ws').RawData) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Handle catchup request — client sends { type: 'catchup', since: <sequence> }
        if (msg.type === 'catchup' && typeof msg.since === 'number') {
          const events = stateEngine.getEventsSince(msg.since);
          ws.send(JSON.stringify({ type: 'catchup', data: events }));
          return;
        }

        // Handle user chat
        if (msg.type === 'chat' && typeof msg.text === 'string') {
          const chatEvent = stateEngine.applyEvent({
            timestamp: Date.now(),
            type: 'user:chat',
            userId,
            data: { text: msg.text, userId },
          });
          broadcastManager.broadcastEvent(chatEvent);
          return;
        }
      } catch (err) {
        log.warn({ err }, 'Invalid WebSocket message');
      }
    });

    ws.on('close', () => {
      broadcastManager.removeClient(ws);

      const leaveEvent = stateEngine.applyEvent({
        timestamp: Date.now(),
        type: 'user:leave',
        userId,
        data: { userId },
      });
      broadcastManager.broadcastEvent(leaveEvent);
    });

    ws.on('error', (err: Error) => {
      log.error({ err, userId }, 'WebSocket error');
      broadcastManager.removeClient(ws);
    });
  },
);

// --- Start server ---

server.listen(PORT, () => {
  log.info(`Harbor Presence Service running on port ${PORT}`);
  log.info(`Health check: http://localhost:${PORT}/api/health`);
  log.info(`WebSocket: ws://localhost:${PORT}?token=<jwt>`);
});

// --- Graceful shutdown ---

const shutdown = () => {
  log.info('Shutting down...');
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
