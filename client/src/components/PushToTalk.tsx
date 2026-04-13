import { useRef, useEffect, useCallback } from 'react';
import { useVoice } from '../hooks/useVoice';
import { useStore } from '../store';
import type { VoiceState } from '../types';

interface PushToTalkProps {
  onSend: (text: string) => void;
}

const keyframesInjected = { current: false };

function injectKeyframes() {
  if (keyframesInjected.current) return;
  keyframesInjected.current = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ptt-pulse {
      0% { box-shadow: 0 0 0 0 rgba(255, 50, 50, 0.5); }
      70% { box-shadow: 0 0 0 16px rgba(255, 50, 50, 0); }
      100% { box-shadow: 0 0 0 0 rgba(255, 50, 50, 0); }
    }
    @keyframes ptt-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes ptt-wave1 {
      0%, 100% { height: 8px; }
      50% { height: 18px; }
    }
    @keyframes ptt-wave2 {
      0%, 100% { height: 12px; }
      50% { height: 6px; }
    }
    @keyframes ptt-wave3 {
      0%, 100% { height: 6px; }
      50% { height: 16px; }
    }
  `;
  document.head.appendChild(style);
}

function MicIcon({ state }: { state: VoiceState }) {
  if (state === 'processing') {
    return (
      <div
        style={{
          width: 22,
          height: 22,
          border: '2px solid transparent',
          borderTopColor: '#ffffff',
          borderRadius: '50%',
          animation: 'ptt-spin 0.8s linear infinite',
        }}
      />
    );
  }

  if (state === 'playing') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 22 }}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: 10,
              background: '#ffffff',
              borderRadius: 1,
              animation: `ptt-wave${i} 0.6s ease-in-out infinite`,
            }}
          />
        ))}
      </div>
    );
  }

  const fill = state === 'recording' ? '#ff3232' : '#cccccc';

  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={fill} strokeWidth="2">
      <rect x="9" y="1" width="6" height="12" rx="3" fill={state === 'recording' ? fill : 'none'} />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

function StatusText({ state, error }: { state: VoiceState; error: string | null }) {
  if (error) return <span style={{ color: '#ff5555', fontSize: 10 }}>{error}</span>;
  if (state === 'recording')
    return <span style={{ color: '#ff5555', fontSize: 10 }}>Recording...</span>;
  if (state === 'processing')
    return <span style={{ color: '#aaaacc', fontSize: 10 }}>Processing...</span>;
  if (state === 'playing')
    return <span style={{ color: '#aaaacc', fontSize: 10 }}>Playing...</span>;
  return null;
}

export function PushToTalk({ onSend }: PushToTalkProps) {
  const voiceEnabled = useStore((s) => s.voiceEnabled);
  const toggleMode = useRef<boolean>(false);
  const holdActive = useRef<boolean>(false);

  const handleTranscription = useCallback(
    (text: string) => {
      onSend(text);
    },
    [onSend],
  );

  const { state, startRecording, stopRecording, sendAudio, error, isSupported } = useVoice({
    onTranscription: handleTranscription,
  });

  useEffect(() => {
    injectKeyframes();
  }, []);

  const doStop = useCallback(async () => {
    const blob = await stopRecording();
    if (blob && blob.size > 0) {
      await sendAudio(blob);
    }
  }, [stopRecording, sendAudio]);

  // Mouse / touch handlers for hold-to-record
  const handlePointerDown = useCallback(() => {
    if (state === 'idle') {
      holdActive.current = true;
      toggleMode.current = false;
      startRecording();
    }
  }, [state, startRecording]);

  const handlePointerUp = useCallback(() => {
    if (holdActive.current && state === 'recording') {
      holdActive.current = false;
      doStop();
    }
  }, [state, doStop]);

  // Click handler for toggle mode (quick click without hold)
  const handleClick = useCallback(() => {
    if (state === 'recording' && !holdActive.current) {
      // Toggle off
      toggleMode.current = false;
      doStop();
    } else if (state === 'idle') {
      // If pointer wasn't held, start toggle mode
      toggleMode.current = true;
      startRecording();
    }
  }, [state, startRecording, doStop]);

  // Keyboard handler for spacebar
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space' || e.repeat) return;
      // Don't capture if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable)
        return;

      e.preventDefault();
      if (state === 'idle') {
        holdActive.current = true;
        startRecording();
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable)
        return;

      e.preventDefault();
      if (holdActive.current && state === 'recording') {
        holdActive.current = false;
        doStop();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [state, startRecording, doStop]);

  if (!voiceEnabled) return null;

  const isRecording = state === 'recording';
  const isDisabled = !isSupported || state === 'processing';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        zIndex: 110,
        pointerEvents: 'auto',
      }}
    >
      <StatusText state={state} error={error} />
      <button
        onMouseDown={handlePointerDown}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchEnd={handlePointerUp}
        onClick={handleClick}
        disabled={isDisabled}
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          border: isRecording ? '2px solid #ff3232' : '2px solid rgba(120, 80, 255, 0.3)',
          background: isRecording ? 'rgba(255, 50, 50, 0.2)' : 'rgba(15, 15, 30, 0.75)',
          backdropFilter: 'blur(8px)',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
          opacity: isDisabled ? 0.4 : 1,
          animation: isRecording ? 'ptt-pulse 1.5s infinite' : 'none',
        }}
        title={!isSupported ? 'Voice not supported' : 'Hold to talk, or click to toggle'}
      >
        <MicIcon state={state} />
      </button>
    </div>
  );
}
