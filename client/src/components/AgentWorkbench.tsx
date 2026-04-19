import React, { useMemo } from 'react';
import { Text } from '@react-three/drei';
import { usePanelData } from '../hooks/usePanelData';
import { useStore } from '../store';

interface AgentTask {
  agentId: string;
  name: string;
  activity: string;
  mood: string;
  detail: string;
  updatedAt: number;
}

interface TasksResponse {
  tasks: AgentTask[];
}

const SCREEN_COLORS: Record<string, string> = {
  margot: '#ff2244',
  bud: '#2266ff',
  lou: '#22cc66',
  nygma: '#9944ff',
  ivy: '#ff8822',
  harvey: '#888899',
};

interface ReadoutProps {
  task: AgentTask;
  position: [number, number, number];
  color: string;
}

const TaskReadout = React.memo(function TaskReadout({ task, position, color }: ReadoutProps) {
  // Float above the desk monitor — behind the agent, facing the camera.
  const deskDepth = 2;
  const panelWidth = 1.2;
  const panelHeight = 0.4;
  return (
    <group position={position}>
      {/* Small floating plaque */}
      <mesh position={[0, 0, -(deskDepth / 2 - 0.1)]}>
        <planeGeometry args={[panelWidth, panelHeight]} />
        <meshStandardMaterial
          color="#0c0c18"
          emissive={color}
          emissiveIntensity={0.15}
          transparent
          opacity={0.88}
        />
      </mesh>
      <Text
        position={[0, 0.07, -(deskDepth / 2 - 0.09)]}
        fontSize={0.09}
        color={color}
        anchorX="center"
        anchorY="middle"
        maxWidth={panelWidth - 0.1}
      >
        {task.activity.toUpperCase()}
      </Text>
      <Text
        position={[0, -0.08, -(deskDepth / 2 - 0.09)]}
        fontSize={0.06}
        color="#ccccee"
        anchorX="center"
        anchorY="middle"
        maxWidth={panelWidth - 0.1}
      >
        {task.detail}
      </Text>
    </group>
  );
});

export function AgentWorkbenches() {
  const { data } = usePanelData<TasksResponse>('/api/panel/tasks', { intervalMs: 15_000 });
  const worldState = useStore((s) => s.worldState);
  const tasks = data?.tasks || [];

  const taskByAgent = useMemo(() => {
    const m = new Map<string, AgentTask>();
    for (const t of tasks) m.set(t.agentId, t);
    return m;
  }, [tasks]);

  // Prefer world-state agent positions (reflect real movement); fall back to DEFAULT_ROOM desk positions
  const deskPositions = useMemo(() => {
    const defaults: Record<string, [number, number, number]> = {
      margot: [-8, 1.55, -6],
      bud: [-3, 1.55, -6],
      lou: [2, 1.55, -6],
      nygma: [7, 1.55, -6],
      ivy: [-8, 1.55, -1],
      harvey: [-3, 1.55, -1],
    };
    if (!worldState?.agents) return defaults;
    const merged = { ...defaults };
    for (const agent of Object.values(worldState.agents)) {
      const id = agent.id.toLowerCase();
      if (defaults[id]) {
        // Keep the desk anchor, just let future tooling tweak if needed
        merged[id] = defaults[id];
      }
    }
    return merged;
  }, [worldState]);

  return (
    <group>
      {Array.from(taskByAgent.entries()).map(([id, task]) => {
        const pos = deskPositions[id.toLowerCase()];
        if (!pos) return null;
        const color = SCREEN_COLORS[id.toLowerCase()] || '#ffffff';
        return <TaskReadout key={id} task={task} position={pos} color={color} />;
      })}
    </group>
  );
}
