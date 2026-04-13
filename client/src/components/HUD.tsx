import { useStore } from '../store';

const styles = {
  container: {
    position: 'fixed' as const,
    top: '16px',
    right: '16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    alignItems: 'flex-end',
    fontFamily: "'Segoe UI', -apple-system, sans-serif",
    zIndex: 100,
    pointerEvents: 'none' as const,
  },
  badge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(15, 15, 30, 0.8)',
    border: '1px solid rgba(120, 80, 255, 0.15)',
    borderRadius: '6px',
    padding: '6px 12px',
    backdropFilter: 'blur(8px)',
    fontSize: '12px',
    color: '#aaaacc',
  },
  dot: (connected: boolean) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: connected ? '#44cc66' : '#cc4444',
    boxShadow: connected
      ? '0 0 6px #44cc66'
      : '0 0 6px #cc4444',
  }),
  label: {
    fontSize: '10px',
    color: '#666688',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  },
  value: {
    fontSize: '13px',
    color: '#ccccee',
    fontWeight: 600 as const,
    fontVariantNumeric: 'tabular-nums' as const,
  },
};

export function HUD() {
  const connected = useStore((s) => s.connected);
  const worldState = useStore((s) => s.worldState);

  const agentCount = worldState ? Object.keys(worldState.agents).length : 0;
  const sequence = worldState?.sequence ?? 0;

  return (
    <div style={styles.container}>
      {/* Connection status */}
      <div style={styles.badge}>
        <div style={styles.dot(connected)} />
        <span style={styles.value}>{connected ? 'Connected' : 'Disconnected'}</span>
      </div>

      {/* Agent count */}
      <div style={styles.badge}>
        <span style={styles.label}>Agents</span>
        <span style={styles.value}>{agentCount}</span>
      </div>

      {/* Sequence */}
      <div style={styles.badge}>
        <span style={styles.label}>Seq</span>
        <span style={styles.value}>#{sequence}</span>
      </div>
    </div>
  );
}
