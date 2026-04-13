import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useStore } from '../store';

interface ChatOverlayProps {
  onSend: (text: string) => void;
}

const styles = {
  container: {
    position: 'fixed' as const,
    bottom: '16px',
    left: '16px',
    width: '420px',
    maxHeight: '360px',
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'rgba(15, 15, 30, 0.85)',
    border: '1px solid rgba(120, 80, 255, 0.2)',
    borderRadius: '10px',
    backdropFilter: 'blur(12px)',
    overflow: 'hidden',
    fontFamily: "'Segoe UI', -apple-system, sans-serif",
    zIndex: 100,
  },
  header: {
    padding: '8px 14px',
    fontSize: '11px',
    fontWeight: 600 as const,
    color: '#7755cc',
    textTransform: 'uppercase' as const,
    letterSpacing: '1.5px',
    borderBottom: '1px solid rgba(120, 80, 255, 0.1)',
  },
  messages: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    maxHeight: '280px',
  },
  inputRow: {
    display: 'flex',
    borderTop: '1px solid rgba(120, 80, 255, 0.15)',
  },
  input: {
    flex: 1,
    padding: '12px 14px',
    background: 'transparent',
    border: 'none',
    color: '#e0e0e0',
    fontSize: '14px',
    outline: 'none',
    fontFamily: 'inherit',
  },
  sendBtn: {
    padding: '12px 16px',
    background: 'transparent',
    border: 'none',
    color: '#7755cc',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600 as const,
    transition: 'color 0.2s',
  },
};

export function ChatOverlay({ onSend }: ChatOverlayProps) {
  const messages = useStore((s) => s.chatMessages);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>Chat</div>
      <div ref={messagesContainerRef} style={styles.messages}>
        {messages.length === 0 && (
          <div
            style={{
              color: '#555566',
              fontSize: '13px',
              padding: '12px 0',
              textAlign: 'center',
            }}
          >
            No messages yet. Say something.
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.isUser ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '6px',
                marginBottom: '2px',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: msg.isUser ? '#7755cc' : '#cc7755',
                }}
              >
                {msg.sender}
              </span>
              <span style={{ fontSize: '10px', color: '#555566' }}>
                {formatTime(msg.timestamp)}
              </span>
            </div>
            <div
              style={{
                background: msg.isUser
                  ? 'rgba(120, 80, 255, 0.15)'
                  : 'rgba(255, 255, 255, 0.06)',
                border: msg.isUser
                  ? '1px solid rgba(120, 80, 255, 0.25)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '8px 12px',
                maxWidth: '320px',
                fontSize: '13px',
                lineHeight: '1.4',
                color: '#d0d0e0',
                wordBreak: 'break-word',
              }}
            >
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div style={styles.inputRow}>
        <input
          style={styles.input}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
        />
        <button
          style={{
            ...styles.sendBtn,
            opacity: input.trim() ? 1 : 0.4,
          }}
          onClick={handleSend}
          disabled={!input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
