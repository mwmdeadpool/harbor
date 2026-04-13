import { useState, type FormEvent } from 'react';
import { useStore } from '../store';

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100vw',
    height: '100vh',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  } as React.CSSProperties,
  card: {
    background: 'rgba(30, 30, 50, 0.9)',
    border: '1px solid rgba(120, 80, 255, 0.3)',
    borderRadius: '12px',
    padding: '40px',
    width: '360px',
    boxShadow: '0 0 40px rgba(120, 80, 255, 0.15), 0 8px 32px rgba(0,0,0,0.4)',
    backdropFilter: 'blur(12px)',
  } as React.CSSProperties,
  title: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#e0e0e0',
    marginBottom: '8px',
    textAlign: 'center' as const,
    letterSpacing: '2px',
  } as React.CSSProperties,
  subtitle: {
    fontSize: '13px',
    color: '#888',
    textAlign: 'center' as const,
    marginBottom: '32px',
  } as React.CSSProperties,
  inputGroup: {
    marginBottom: '20px',
  } as React.CSSProperties,
  label: {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: '#999',
    marginBottom: '6px',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '12px 14px',
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontSize: '15px',
    outline: 'none',
    transition: 'border-color 0.2s',
  } as React.CSSProperties,
  button: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #7850ff 0%, #5533cc 100%)',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '8px',
    transition: 'opacity 0.2s, transform 0.1s',
    letterSpacing: '0.5px',
  } as React.CSSProperties,
  error: {
    background: 'rgba(255, 50, 50, 0.15)',
    border: '1px solid rgba(255, 50, 50, 0.3)',
    borderRadius: '6px',
    padding: '10px 14px',
    color: '#ff6666',
    fontSize: '13px',
    marginBottom: '16px',
    textAlign: 'center' as const,
  } as React.CSSProperties,
};

export function Login() {
  const login = useStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Login failed (${res.status})`);
      }

      const data = await res.json();
      if (data.token) {
        login(data.token);
      } else {
        throw new Error('No token in response');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <div style={styles.title}>HARBOR</div>
        <div style={styles.subtitle}>Agent Workspace</div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.inputGroup}>
          <label style={styles.label}>Username</label>
          <input
            style={styles.input}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </div>

        <div style={styles.inputGroup}>
          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <button
          style={{
            ...styles.button,
            opacity: loading ? 0.7 : 1,
          }}
          type="submit"
          disabled={loading}
        >
          {loading ? 'Connecting...' : 'Enter Harbor'}
        </button>
      </form>
    </div>
  );
}
