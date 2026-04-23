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
  const { playAgentAudio, playAgentText, ensureContext } = useAudio();
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
        const worldState = useStore.getState().worldState;
        console.log('[harbor:audio] ws handler received', {
          outerType: msg.type,
          innerType: msg.data?.type,
          agentId: msg.data?.agentId,
          hasAudioUrl: !!msg.data?.data?.audioUrl,
          hasText: !!msg.data?.data?.text,
        });

        // Agent speaks to user / room
        if (msg.type === 'event' && msg.data?.type === 'agent:speak') {
          const agentId = msg.data.agentId as string | undefined;
          const data = msg.data.data as { audioUrl?: string; text?: string } | undefined;
          if (!agentId) return;
          const agent = worldState?.agents[agentId];
          const position = agent?.position ?? { x: 0, y: 1, z: 0 };
          if (data?.audioUrl) {
            playAgentAudio(agentId, data.audioUrl, position);
          } else if (data?.text) {
            playAgentText(agentId, data.text, position);
          }
          return;
        }

        // Inter-agent dialogue — speaker is fromAgent
        if (msg.type === 'event' && msg.data?.type === 'agent:conversation') {
          const data = msg.data.data as { fromAgent?: string; text?: string } | undefined;
          const fromAgent = data?.fromAgent;
          const text = data?.text;
          if (!fromAgent || !text) return;
          const agent = worldState?.agents[fromAgent];
          const position = agent?.position ?? { x: 0, y: 1, z: 0 };
          playAgentText(fromAgent, text, position);
          return;
        }

        // Legacy flat shape (defensive)
        if (msg.type === 'agent:speak' && msg.data?.agentId) {
          const agentId = msg.data.agentId as string;
          const agent = worldState?.agents[agentId];
          const position = agent?.position ?? { x: 0, y: 1, z: 0 };
          if (msg.data.audioUrl) {
            playAgentAudio(agentId, msg.data.audioUrl, position);
          } else if (msg.data.text) {
            playAgentText(agentId, msg.data.text, position);
          }
        }
      } catch (err) {
        console.warn('[harbor:audio] ws handler threw', err);
      }
    }

    // We need access to the raw WebSocket — listen on the window for a custom event
    // dispatched by useWebSocket, or we can tap into the store's addEvent mechanism.
    // For now, register a handler on the global scope that useWebSocket can dispatch to.
    window.addEventListener('harbor:ws:message', handleWsMessage as EventListener);
    return () => {
      window.removeEventListener('harbor:ws:message', handleWsMessage as EventListener);
    };
  }, [playAgentAudio, playAgentText, volume]);

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
