import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import type { AgentConversation } from '../types';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

export function useWebSocket() {
  const token = useStore((s) => s.token);
  const setConnected = useStore((s) => s.setConnected);
  const setConnectionStatus = useStore((s) => s.setConnectionStatus);
  const updateState = useStore((s) => s.updateState);
  const addEvent = useStore((s) => s.addEvent);
  const addChatMessage = useStore((s) => s.addChatMessage);
  const addAgentConversation = useStore((s) => s.addAgentConversation);
  const logout = useStore((s) => s.logout);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const attemptRef = useRef(0);
  const lastSequenceRef = useRef(0);

  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return;

    const isReconnect = attemptRef.current > 0;
    setConnectionStatus(isReconnect ? 'reconnecting' : 'connecting');

    // Build WebSocket URL
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${proto}//${host}/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      attemptRef.current = 0;
      setConnected(true);
      setConnectionStatus('connected');

      // Request catchup from last known sequence on reconnect
      if (lastSequenceRef.current > 0) {
        ws.send(JSON.stringify({ type: 'catchup', since: lastSequenceRef.current }));
      }
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data);

        // Respond to server pings
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        // Server sends: { type: 'state', data: worldState } for full state
        //               { type: 'event', data: worldEvent } for deltas
        //               { type: 'catchup', data: worldEvent[] } for catchup
        switch (msg.type) {
          // Full state from server
          case 'state':
          case 'state:full':
            updateState(msg.data);
            if (msg.data?.sequence != null) {
              lastSequenceRef.current = msg.data.sequence;
            }
            break;

          // Catchup response — array of missed events
          case 'catchup': {
            const events = msg.data;
            if (Array.isArray(events)) {
              for (const evt of events) {
                applyWorldEvent(evt, event);
              }
            }
            break;
          }

          // Event delta from server
          case 'event': {
            applyWorldEvent(msg.data, event);
            break;
          }

          // Legacy format compatibility
          case 'state:delta':
            addEvent(msg.data);
            break;
          case 'chat:message':
            addChatMessage(msg.data);
            break;
          case 'agent:speak':
            window.dispatchEvent(new MessageEvent('harbor:ws:message', { data: event.data }));
            break;
          case 'auth:expired':
            logout();
            break;
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      wsRef.current = null;

      // Exponential backoff reconnect
      attemptRef.current++;
      const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attemptRef.current - 1), BACKOFF_MAX_MS);
      setConnectionStatus('reconnecting');

      reconnectTimer.current = setTimeout(() => {
        if (mountedRef.current && token) {
          connect();
        }
      }, delay);
    };

    ws.onerror = () => {
      // onclose will fire after this, handling reconnect
      ws.close();
    };

    // Helper to process a single world event
    function applyWorldEvent(worldEvent: Record<string, unknown>, rawEvent: MessageEvent) {
      if (!worldEvent?.type) return;

      // Track sequence
      if (typeof worldEvent.sequence === 'number') {
        lastSequenceRef.current = Math.max(lastSequenceRef.current, worldEvent.sequence as number);
      }

      // Apply state change for agent events
      if (worldEvent.agentId) {
        const patch: Record<string, unknown> = {};
        switch (worldEvent.type) {
          case 'agent:move':
            if ((worldEvent.data as Record<string, unknown>)?.position)
              patch.position = (worldEvent.data as Record<string, unknown>).position;
            if ((worldEvent.data as Record<string, unknown>)?.rotation !== undefined)
              patch.rotation = (worldEvent.data as Record<string, unknown>).rotation;
            if ((worldEvent.data as Record<string, unknown>)?.zone)
              patch.zone = (worldEvent.data as Record<string, unknown>).zone;
            break;
          case 'agent:speak':
            patch.speaking = true;
            patch.activity = 'talking';
            // Dispatch for audio playback
            window.dispatchEvent(new MessageEvent('harbor:ws:message', { data: rawEvent.data }));
            break;
          case 'agent:status':
          case 'agent:react':
            if ((worldEvent.data as Record<string, unknown>)?.activity)
              patch.activity = (worldEvent.data as Record<string, unknown>).activity;
            if ((worldEvent.data as Record<string, unknown>)?.mood)
              patch.mood = (worldEvent.data as Record<string, unknown>).mood;
            if ((worldEvent.data as Record<string, unknown>)?.animation)
              patch.animation = (worldEvent.data as Record<string, unknown>).animation;
            break;
          case 'agent:gesture':
            if ((worldEvent.data as Record<string, unknown>)?.animation)
              patch.animation = (worldEvent.data as Record<string, unknown>).animation;
            break;
          case 'agent:conversation': {
            // Inter-agent conversation — apply speaking state and track
            const data = worldEvent.data as Record<string, unknown>;
            const fromAgent = data.fromAgent as string;
            const toAgent = data.toAgent as string;
            if (fromAgent) {
              addEvent({
                agentId: fromAgent,
                patch: { speaking: true, activity: 'talking' },
              });
            }
            if (toAgent) {
              addEvent({
                agentId: toAgent,
                patch: { animation: 'listening', activity: 'idle' },
              });
            }
            const convo: AgentConversation = {
              id: `${fromAgent}-${Date.now()}`,
              fromAgent,
              toAgent,
              text: data.text as string,
              timestamp: worldEvent.timestamp as number,
            };
            addAgentConversation(convo);
            // Also dispatch for audio
            window.dispatchEvent(new MessageEvent('harbor:ws:message', { data: rawEvent.data }));
            break;
          }
        }

        if (Object.keys(patch).length > 0) {
          addEvent({ agentId: worldEvent.agentId as string, patch });
        }
      }

      // Handle user events
      if (worldEvent.type === 'user:chat' && (worldEvent.data as Record<string, unknown>)?.text) {
        const data = worldEvent.data as Record<string, unknown>;
        addChatMessage({
          id: `${worldEvent.userId}-${worldEvent.timestamp}`,
          sender: (data.userId as string) || 'User',
          text: data.text as string,
          timestamp: worldEvent.timestamp as number,
          isUser: true,
        });
      }
    }
  }, [token, setConnected, setConnectionStatus, updateState, addEvent, addChatMessage, addAgentConversation, logout]);

  const send = useCallback((type: string, data: unknown = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    attemptRef.current = 0;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { send };
}
