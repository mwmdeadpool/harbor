import { useEffect, useCallback } from 'react';
import { useStore } from './store';
import { useWebSocket } from './hooks/useWebSocket';
import { useAudio } from './hooks/useAudio';
import { Login } from './components/Login';
import { Scene } from './components/Scene';
import { ChatOverlay } from './components/ChatOverlay';
import { HUD } from './components/HUD';
import { PushToTalk } from './components/PushToTalk';

function AuthenticatedApp() {
  const { send } = useWebSocket();
  const { playAgentAudio, ensureContext } = useAudio();
  const volume = useStore((s) => s.volume);

  // Initialize audio context on first user interaction
  useEffect(() => {
    function handleInteraction() {
      ensureContext();
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    }
    window.addEventListener('click', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, [ensureContext]);

  // Listen for agent:speak WebSocket events
  useEffect(() => {
    function handleWsMessage(event: MessageEvent) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'agent:speak' && msg.data?.audioUrl && msg.data?.agentId) {
          const worldState = useStore.getState().worldState;
          const agent = worldState?.agents[msg.data.agentId];
          const position = agent?.position ?? { x: 0, y: 1, z: 0 };
          playAgentAudio(msg.data.agentId, msg.data.audioUrl, position);
        }
      } catch {
        // ignore
      }
    }

    // We need access to the raw WebSocket — listen on the window for a custom event
    // dispatched by useWebSocket, or we can tap into the store's addEvent mechanism.
    // For now, register a handler on the global scope that useWebSocket can dispatch to.
    window.addEventListener('harbor:ws:message', handleWsMessage as EventListener);
    return () => {
      window.removeEventListener('harbor:ws:message', handleWsMessage as EventListener);
    };
  }, [playAgentAudio, volume]);

  const handleChatSend = useCallback(
    (text: string) => {
      send('user:chat', { text });

      const msg = {
        id: `local-${Date.now()}`,
        sender: 'You',
        text,
        timestamp: Date.now(),
        isUser: true,
      };
      useStore.getState().addChatMessage(msg);
    },
    [send],
  );

  return (
    <>
      <Scene />
      <ChatOverlay onSend={handleChatSend} />
      <PushToTalk onSend={handleChatSend} />
      <HUD />
    </>
  );
}

export function App() {
  const token = useStore((s) => s.token);

  if (!token) {
    return <Login />;
  }

  return <AuthenticatedApp />;
}
