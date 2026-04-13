import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import type { AgentConversation } from '../types';

export function useWebSocket() {
  const token = useStore((s) => s.token);
  const setConnected = useStore((s) => s.setConnected);
  const updateState = useStore((s) => s.updateState);
  const addEvent = useStore((s) => s.addEvent);
  const addChatMessage = useStore((s) => s.addChatMessage);
  const addAgentConversation = useStore((s) => s.addAgentConversation);
  const logout = useStore((s) => s.logout);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return;

    // Build WebSocket URL
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${proto}//${host}/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (mountedRef.current) {
        setConnected(true);
      }
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data);

        // Server sends: { type: 'state', data: worldState } for full state
        //               { type: 'event', data: worldEvent } for deltas
        switch (msg.type) {
          // Full state from server
          case 'state':
          case 'state:full':
            updateState(msg.data);
            break;

          // Event delta from server
          case 'event': {
            const worldEvent = msg.data;
            if (!worldEvent?.type) break;

            // Apply state change for agent events
            if (worldEvent.agentId) {
              const patch: Record<string, unknown> = {};
              switch (worldEvent.type) {
                case 'agent:move':
                  if (worldEvent.data.position) patch.position = worldEvent.data.position;
                  if (worldEvent.data.rotation !== undefined)
                    patch.rotation = worldEvent.data.rotation;
                  if (worldEvent.data.zone) patch.zone = worldEvent.data.zone;
                  break;
                case 'agent:speak':
                  patch.speaking = true;
                  patch.activity = 'talking';
                  // Dispatch for audio playback
                  window.dispatchEvent(new MessageEvent('harbor:ws:message', { data: event.data }));
                  break;
                case 'agent:status':
                case 'agent:react':
                  if (worldEvent.data.activity) patch.activity = worldEvent.data.activity;
                  if (worldEvent.data.mood) patch.mood = worldEvent.data.mood;
                  if (worldEvent.data.animation) patch.animation = worldEvent.data.animation;
                  break;
                case 'agent:gesture':
                  if (worldEvent.data.animation) patch.animation = worldEvent.data.animation;
                  break;
                case 'agent:conversation': {
                  // Inter-agent conversation — apply speaking state and track
                  const fromAgent = worldEvent.data.fromAgent as string;
                  const toAgent = worldEvent.data.toAgent as string;
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
                    text: worldEvent.data.text as string,
                    timestamp: worldEvent.timestamp,
                  };
                  addAgentConversation(convo);
                  // Also dispatch for audio
                  window.dispatchEvent(new MessageEvent('harbor:ws:message', { data: event.data }));
                  break;
                }
              }

              if (Object.keys(patch).length > 0) {
                addEvent({ agentId: worldEvent.agentId, patch });
              }
            }

            // Handle user events
            if (worldEvent.type === 'user:chat' && worldEvent.data?.text) {
              addChatMessage({
                id: `${worldEvent.userId}-${worldEvent.timestamp}`,
                sender: (worldEvent.data.userId as string) || 'User',
                text: worldEvent.data.text as string,
                timestamp: worldEvent.timestamp,
                isUser: true,
              });
            }
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
      // Auto-reconnect after 3 seconds
      reconnectTimer.current = setTimeout(() => {
        if (mountedRef.current && token) {
          connect();
        }
      }, 3000);
    };

    ws.onerror = () => {
      // onclose will fire after this, handling reconnect
      ws.close();
    };
  }, [token, setConnected, updateState, addEvent, addChatMessage, addAgentConversation, logout]);

  const send = useCallback((type: string, data: unknown = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
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
