import { useState, useRef, useCallback } from 'react';
import type { VoiceState } from '../types';

function detectMimeType(): string | null {
  const candidates = ['audio/webm', 'audio/ogg', 'audio/wav'];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

interface UseVoiceOptions {
  onTranscription?: (text: string) => void;
  /** Called when TTS playback fails, with the text that was meant to be spoken */
  onTTSFallback?: (text: string) => void;
}

export function useVoice({ onTranscription, onTTSFallback }: UseVoiceOptions = {}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [micDisabled, setMicDisabled] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef<string | null>(null);

  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError('Voice recording is not supported in this browser');
      setMicDisabled(true);
      return;
    }

    if (micDisabled) {
      setError('Microphone access denied — use text input instead');
      return;
    }

    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = detectMimeType();
      mimeTypeRef.current = mimeType;

      const options: MediaRecorderOptions = {};
      if (mimeType) options.mimeType = mimeType;

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onerror = () => {
        setError('Recording error — use text input instead');
        setMicDisabled(true);
        setState('idle');
        // Clean up the stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };

      recorder.start();
      setState('recording');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Microphone permission denied — text-only mode');
        setMicDisabled(true);
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setError('No microphone found — text-only mode');
        setMicDisabled(true);
      } else {
        setError('Failed to start recording');
      }
      setState('idle');
    }
  }, [isSupported, micDisabled]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      setState('idle');
      return null;
    }

    return new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        try {
          const blob = new Blob(chunksRef.current, {
            type: mimeTypeRef.current || 'audio/webm',
          });
          chunksRef.current = [];

          // Stop all tracks
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          }

          resolve(blob);
        } catch {
          // Blob creation failed — shouldn't happen but be safe
          resolve(null);
        }
      };

      try {
        recorder.stop();
      } catch {
        // Recorder already stopped or in bad state
        setState('idle');
        resolve(null);
      }
    });
  }, []);

  const sendAudio = useCallback(
    async (blob: Blob) => {
      setState('processing');
      setError(null);

      try {
        const formData = new FormData();
        const ext = mimeTypeRef.current?.includes('ogg')
          ? 'ogg'
          : mimeTypeRef.current?.includes('wav')
            ? 'wav'
            : 'webm';
        formData.append('audio', blob, `recording.${ext}`);

        const res = await fetch('/media/stt', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          throw new Error(`STT failed: ${res.status}`);
        }

        const data = await res.json();
        const text = data.text?.trim();

        if (text && onTranscription) {
          onTranscription(text);
        }

        setState('idle');
        return text || null;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Transcription failed');
        setState('idle');
        return null;
      }
    },
    [onTranscription],
  );

  /**
   * Play TTS audio. If playback fails for any reason, invokes the
   * onTTSFallback callback with the text so the UI can show it instead.
   * Never throws.
   */
  const playTTS = useCallback(
    async (audioUrl: string, fallbackText?: string) => {
      try {
        setState('playing');
        const audio = new Audio(audioUrl);

        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error('Audio playback failed'));
          audio.play().catch(reject);
        });

        setState('idle');
      } catch {
        setState('idle');
        if (fallbackText && onTTSFallback) {
          onTTSFallback(fallbackText);
        }
      }
    },
    [onTTSFallback],
  );

  return {
    state,
    startRecording,
    stopRecording,
    sendAudio,
    playTTS,
    error,
    isSupported: isSupported && !micDisabled,
    micDisabled,
  };
}
