export type EventType =
  | 'agent:move'
  | 'agent:speak'
  | 'agent:gesture'
  | 'agent:status'
  | 'agent:conversation'
  | 'agent:react'
  | 'user:join'
  | 'user:leave'
  | 'user:chat'
  | 'room:update';

export interface WorldEvent {
  id?: number;
  sequence?: number;
  timestamp: number;
  type: EventType;
  agentId?: string;
  userId?: string;
  data: Record<string, unknown>;
}

export interface Position {
  x: number;
  y: number;
  z: number;
}

export type AgentActivity =
  | 'idle'
  | 'working'
  | 'talking'
  | 'thinking'
  | 'away'
  | 'presenting'
  | 'coding';

export interface AgentState {
  id: string;
  name: string;
  avatar: string;
  position: Position;
  rotation: number;
  zone: string;
  activity: AgentActivity;
  animation: string;
  speaking: boolean;
  lastActive: number;
  mood: string;
}

export interface UserPresence {
  online: boolean;
  lastSeen: number;
  zone: string;
  position: Position;
}

export interface Zone {
  id: string;
  name: string;
  center: Position;
  radius: number;
}

export interface RoomConfig {
  name: string;
  zones: Zone[];
}

export interface WorldState {
  sequence: number;
  timestamp: number;
  agents: Record<string, AgentState>;
  user: UserPresence;
  room: RoomConfig;
}

// Default room layout — grid pattern, each zone ~4 units apart
export const DEFAULT_ZONES: Zone[] = [
  {
    id: 'margot-desk',
    name: "Margot's Desk",
    center: { x: 0, y: 0, z: 0 },
    radius: 2,
  },
  {
    id: 'bud-desk',
    name: "Bud's Desk",
    center: { x: 4, y: 0, z: 0 },
    radius: 2,
  },
  {
    id: 'lou-desk',
    name: "Lou's Desk",
    center: { x: 8, y: 0, z: 0 },
    radius: 2,
  },
  {
    id: 'nygma-desk',
    name: "Nygma's Desk",
    center: { x: 0, y: 0, z: 4 },
    radius: 2,
  },
  {
    id: 'ivy-desk',
    name: "Ivy's Desk",
    center: { x: 4, y: 0, z: 4 },
    radius: 2,
  },
  {
    id: 'harvey-desk',
    name: "Harvey's Desk",
    center: { x: 8, y: 0, z: 4 },
    radius: 2,
  },
  {
    id: 'meeting-room',
    name: 'Meeting Room',
    center: { x: 4, y: 0, z: 8 },
    radius: 3,
  },
  { id: 'lounge', name: 'Lounge', center: { x: 0, y: 0, z: 8 }, radius: 3 },
  {
    id: 'user-corner',
    name: "User's Corner",
    center: { x: 8, y: 0, z: 8 },
    radius: 2,
  },
];

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  name: 'Harbor HQ',
  zones: DEFAULT_ZONES,
};

export const DEFAULT_AGENTS: AgentState[] = [
  {
    id: 'margot',
    name: 'Margot',
    avatar: 'margot.png',
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    zone: 'margot-desk',
    activity: 'idle',
    animation: 'idle',
    speaking: false,
    lastActive: Date.now(),
    mood: 'playful',
  },
  {
    id: 'bud',
    name: 'Bud',
    avatar: 'bud.png',
    position: { x: 4, y: 0, z: 0 },
    rotation: 0,
    zone: 'bud-desk',
    activity: 'idle',
    animation: 'idle',
    speaking: false,
    lastActive: Date.now(),
    mood: 'steady',
  },
  {
    id: 'lou',
    name: 'Lou',
    avatar: 'lou.png',
    position: { x: 8, y: 0, z: 0 },
    rotation: 0,
    zone: 'lou-desk',
    activity: 'idle',
    animation: 'idle',
    speaking: false,
    lastActive: Date.now(),
    mood: 'curious',
  },
  {
    id: 'nygma',
    name: 'Nygma',
    avatar: 'nygma.png',
    position: { x: 0, y: 0, z: 4 },
    rotation: 0,
    zone: 'nygma-desk',
    activity: 'idle',
    animation: 'idle',
    speaking: false,
    lastActive: Date.now(),
    mood: 'focused',
  },
  {
    id: 'ivy',
    name: 'Ivy',
    avatar: 'ivy.png',
    position: { x: 4, y: 0, z: 4 },
    rotation: 0,
    zone: 'ivy-desk',
    activity: 'idle',
    animation: 'idle',
    speaking: false,
    lastActive: Date.now(),
    mood: 'serene',
  },
  {
    id: 'harvey',
    name: 'Harvey',
    avatar: 'harvey.png',
    position: { x: 8, y: 0, z: 4 },
    rotation: 0,
    zone: 'harvey-desk',
    activity: 'idle',
    animation: 'idle',
    speaking: false,
    lastActive: Date.now(),
    mood: 'analytical',
  },
];
