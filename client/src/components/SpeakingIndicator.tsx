import { useEffect, useRef } from 'react';
import { Html } from '@react-three/drei';
import { getAgentColor } from '../types';

interface SpeakingIndicatorProps {
  agentName: string;
  visible: boolean;
}

const keyframesInjected = { current: false };

function injectKeyframes() {
  if (keyframesInjected.current) return;
  keyframesInjected.current = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes si-bar1 {
      0%, 100% { height: 4px; }
      50% { height: 14px; }
    }
    @keyframes si-bar2 {
      0%, 100% { height: 10px; }
      50% { height: 4px; }
    }
    @keyframes si-bar3 {
      0%, 100% { height: 6px; }
      50% { height: 16px; }
    }
    @keyframes si-bar4 {
      0%, 100% { height: 12px; }
      50% { height: 6px; }
    }
    @keyframes si-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes si-fade-out {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(4px); }
    }
  `;
  document.head.appendChild(style);
}

export function SpeakingIndicator({ agentName, visible }: SpeakingIndicatorProps) {
  const color = getAgentColor(agentName);
  const containerRef = useRef<HTMLDivElement>(null);
  const wasVisible = useRef(false);

  useEffect(() => {
    injectKeyframes();
  }, []);

  useEffect(() => {
    wasVisible.current = visible;
  }, [visible]);

  if (!visible && !wasVisible.current) return null;

  const animations = [
    'si-bar1 0.5s ease-in-out infinite',
    'si-bar2 0.6s ease-in-out infinite',
    'si-bar3 0.45s ease-in-out infinite',
    'si-bar4 0.55s ease-in-out infinite',
  ];

  return (
    <Html position={[0, 1.7, 0]} center style={{ pointerEvents: 'none' }}>
      <div
        ref={containerRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          height: 20,
          padding: '2px 6px',
          animation: visible ? 'si-fade-in 0.2s ease forwards' : 'si-fade-out 0.2s ease forwards',
        }}
      >
        {animations.map((anim, i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: 8,
              borderRadius: 1,
              background: color,
              boxShadow: `0 0 4px ${color}88`,
              animation: visible ? anim : 'none',
            }}
          />
        ))}
      </div>
    </Html>
  );
}
