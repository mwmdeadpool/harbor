import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';

export function useWebSocket() {
  const token = useStore((s) => s.token);
  const setConnected = useStore((s) => s.setConnected);
  const updateState = useStore((s) => s.updateState);
  const addEvent = useStore((s) => s.addEvent);
  const addChatMessage = useStore((s) => s.addChatMessage);
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
        switch (msg.type) {
          case 'state:full':
            updateState(msg.data);
            break;
          case 'state:delta':
            addEvent(msg.data);
            break;
          case 'chat:message':
            addChatMessage(msg.data);
            break;
          case 'agent:speak':
            // Dispatch to global listener for audio playback
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
  }, [token, setConnected, updateState, addEvent, addChatMessage, logout]);

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
