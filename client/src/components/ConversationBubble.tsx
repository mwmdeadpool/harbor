/**
 * ConversationBubble — Renders inter-agent conversations as floating speech bubbles
 * positioned between the two agents in 3D space.
 */

import React, { useRef, useState, useEffect } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { AgentConversation, AgentState } from '../types';
import { getAgentColor } from '../types';

interface ConversationBubbleProps {
  conversation: AgentConversation;
  agents: Record<string, AgentState>;
}

export const ConversationBubble = React.memo(function ConversationBubble({
  conversation,
  agents,
}: ConversationBubbleProps) {
  const [visible, setVisible] = useState(true);
  const [opacity, setOpacity] = useState(1);
  const age = useRef(0);

  const from = agents[conversation.fromAgent];
  const to = agents[conversation.toAgent];
  if (!from || !to) return null;

  // Position the bubble between the two agents, slightly above
  const midX = (from.position.x + to.position.x) / 2;
  const midZ = (from.position.z + to.position.z) / 2;
  const midY = 2.2;

  // Fade out after 6 seconds
  useFrame((_, delta) => {
    age.current += delta;
    if (age.current > 4) {
      const fadeProgress = (age.current - 4) / 2; // 2 second fade
      setOpacity(Math.max(0, 1 - fadeProgress));
    }
    if (age.current > 6) {
      setVisible(false);
    }
  });

  if (!visible) return null;

  const color = getAgentColor(conversation.fromAgent);
  const truncatedText =
    conversation.text.length > 120 ? conversation.text.slice(0, 117) + '...' : conversation.text;

  return (
    <group position={[midX, midY, midZ]}>
      <Html center style={{ pointerEvents: 'none', userSelect: 'none', opacity }}>
        <div
          style={{
            background: 'rgba(15, 15, 30, 0.92)',
            border: `1px solid ${color}66`,
            borderRadius: '8px',
            padding: '8px 12px',
            maxWidth: '260px',
            fontFamily: 'monospace',
            fontSize: '12px',
          }}
        >
          <div
            style={{
              color,
              fontWeight: 'bold',
              fontSize: '10px',
              marginBottom: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {from.name} → {to.name}
          </div>
          <div style={{ color: '#ccccdd', lineHeight: '1.4' }}>{truncatedText}</div>
        </div>
      </Html>
    </group>
  );
});

/**
 * ConversationLayer — Renders all active inter-agent conversations.
 */
interface ConversationLayerProps {
  conversations: AgentConversation[];
  agents: Record<string, AgentState>;
}

export const ConversationLayer = React.memo(function ConversationLayer({
  conversations,
  agents,
}: ConversationLayerProps) {
  // Only show recent conversations (last 10 seconds)
  const [active, setActive] = useState<AgentConversation[]>([]);

  useEffect(() => {
    const now = Date.now();
    const recent = conversations.filter((c) => now - c.timestamp < 10_000);
    setActive(recent);
  }, [conversations]);

  return (
    <>
      {active.map((convo) => (
        <ConversationBubble key={convo.id} conversation={convo} agents={agents} />
      ))}
    </>
  );
});
