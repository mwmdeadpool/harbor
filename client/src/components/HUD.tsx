import { useStore } from '../store';
import type { ConnectionStatus } from '../store';

function dotColor(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return '#44cc66';
    case 'connecting':
    case 'reconnecting':
      return '#ccaa44';
    case 'disconnected':
    default:
      return '#cc4444';
  }
}

function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting...';
    case 'reconnecting':
      return 'Reconnecting...';
    case 'disconnected':
    default:
      return 'Disconnected';
  }
}

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
  dot: (status: ConnectionStatus) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: dotColor(status),
    boxShadow: `0 0 6px ${dotColor(status)}`,
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
  const connectionStatus = useStore((s) => s.connectionStatus);
  const worldState = useStore((s) => s.worldState);

  const agentCount = worldState ? Object.keys(worldState.agents).length : 0;
  const sequence = worldState?.sequence ?? 0;

  return (
    <div style={styles.container}>
      {/* Connection status */}
      <div style={styles.badge}>
        <div style={styles.dot(connectionStatus)} />
        <span style={styles.value}>{statusLabel(connectionStatus)}</span>
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
