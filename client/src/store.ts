import { create } from 'zustand';
import type { WorldState, ChatMessage, AgentState, AgentConversation } from './types';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface HarborStore {
  // Auth
  token: string | null;
  login: (token: string) => void;
  logout: () => void;

  // World
  worldState: WorldState | null;
  updateState: (state: WorldState) => void;
  addEvent: (event: { agentId: string; patch: Partial<AgentState> }) => void;

  // Chat
  chatMessages: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;

  // Conversations (inter-agent)
  agentConversations: AgentConversation[];
  addAgentConversation: (convo: AgentConversation) => void;

  // Voice / Audio
  volume: number;
  setVolume: (volume: number) => void;
  voiceEnabled: boolean;
  toggleVoice: () => void;

  // Connection
  connected: boolean;
  setConnected: (connected: boolean) => void;
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;
}

const STORAGE_KEY = 'harbor_token';

function loadToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export const useStore = create<HarborStore>((set) => ({
  // Auth
  token: loadToken(),
  login: (token: string) => {
    saveToken(token);
    set({ token });
  },
  logout: () => {
    saveToken(null);
    set({ token: null, worldState: null, chatMessages: [], connected: false, connectionStatus: 'disconnected' as ConnectionStatus });
  },

  // World
  worldState: null,
  updateState: (state: WorldState) => set({ worldState: state }),
  addEvent: (event) =>
    set((s) => {
      if (!s.worldState) return s;
      const agent = s.worldState.agents[event.agentId];
      if (!agent) return s;
      return {
        worldState: {
          ...s.worldState,
          agents: {
            ...s.worldState.agents,
            [event.agentId]: { ...agent, ...event.patch },
          },
          sequence: s.worldState.sequence + 1,
        },
      };
    }),

  // Chat
  chatMessages: [],
  addChatMessage: (msg: ChatMessage) =>
    set((s) => ({
      chatMessages: [...s.chatMessages.slice(-49), msg],
    })),

  // Conversations
  agentConversations: [],
  addAgentConversation: (convo: AgentConversation) =>
    set((s) => ({
      agentConversations: [...s.agentConversations.slice(-19), convo],
    })),

  // Voice / Audio
  volume: 0.8,
  setVolume: (volume: number) => set({ volume: Math.max(0, Math.min(1, volume)) }),
  voiceEnabled: true,
  toggleVoice: () => set((s) => ({ voiceEnabled: !s.voiceEnabled })),

  // Connection
  connected: false,
  setConnected: (connected: boolean) => set({ connected }),
  connectionStatus: 'disconnected' as ConnectionStatus,
  setConnectionStatus: (connectionStatus: ConnectionStatus) => set({ connectionStatus }),
}));
