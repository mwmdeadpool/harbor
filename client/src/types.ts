export interface AgentState {
  id: string;
  name: string;
  avatar: string;
  position: { x: number; y: number; z: number };
  rotation: number;
  zone: string;
  activity: string;
  animation: string;
  speaking: boolean;
  lastActive: number;
  mood: string;
}

export interface RoomConfig {
  width: number;
  depth: number;
  zones: Zone[];
}

export interface Zone {
  id: string;
  name: string;
  type: 'desk' | 'lounge' | 'meeting' | 'open';
  position: { x: number; y: number; z: number };
  size: { width: number; depth: number };
  color?: string;
}

export interface UserPresence {
  position: { x: number; y: number; z: number };
  rotation: number;
  lastActive: number;
}

export interface WorldState {
  agents: Record<string, AgentState>;
  room: RoomConfig;
  user: UserPresence | null;
  sequence: number;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  isUser: boolean;
}

export interface WSMessage {
  type: string;
  data: unknown;
}

// Agent color map
export const AGENT_COLORS: Record<string, string> = {
  margot: '#ff2244',
  bud: '#2266ff',
  lou: '#22cc66',
  nygma: '#9944ff',
  ivy: '#ff8822',
  harvey: '#888899',
};

export function getAgentColor(name: string): string {
  const key = name.toLowerCase();
  return AGENT_COLORS[key] ?? '#aaaaaa';
}
