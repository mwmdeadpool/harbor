import { useStore } from './store';
import { useWebSocket } from './hooks/useWebSocket';
import { Login } from './components/Login';
import { Scene } from './components/Scene';
import { ChatOverlay } from './components/ChatOverlay';
import { HUD } from './components/HUD';

function AuthenticatedApp() {
  const { send } = useWebSocket();

  function handleChatSend(text: string) {
    send('user:chat', { text });

    // Optimistically add the message locally
    const msg = {
      id: `local-${Date.now()}`,
      sender: 'You',
      text,
      timestamp: Date.now(),
      isUser: true,
    };
    useStore.getState().addChatMessage(msg);
  }

  return (
    <>
      <Scene />
      <ChatOverlay onSend={handleChatSend} />
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
