import { useRef, useCallback, useState } from 'react';

interface ActiveSource {
  source: AudioBufferSourceNode;
  panner: PannerNode;
  gain: GainNode;
}

export function useAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<Map<string, ActiveSource>>(new Map());
  const volumeRef = useRef(0.8);
  const [isReady, setIsReady] = useState(false);

  const ensureContext = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
      setIsReady(true);
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const playBuffer = useCallback(
    async (
      agentId: string,
      arrayBuffer: ArrayBuffer,
      position: { x: number; y: number; z: number },
    ) => {
      try {
        const ctx = ensureContext();

        // Stop any existing audio for this agent
        const existing = sourcesRef.current.get(agentId);
        if (existing) {
          try {
            existing.source.stop();
          } catch {
            // already stopped
          }
          sourcesRef.current.delete(agentId);
        }

        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;

        // Spatial panner
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.maxDistance = 50;
        panner.rolloffFactor = 1;
        panner.setPosition(position.x, position.y, position.z);

        // Gain for volume control
        const gain = ctx.createGain();
        gain.gain.value = volumeRef.current;

        source.connect(panner);
        panner.connect(gain);
        gain.connect(ctx.destination);

        sourcesRef.current.set(agentId, { source, panner, gain });

        source.onended = () => {
          sourcesRef.current.delete(agentId);
        };

        source.start();
      } catch (err) {
        console.warn('[harbor:audio] playback failed', { agentId, err });
      }
    },
    [ensureContext],
  );

  const playAgentAudio = useCallback(
    async (agentId: string, audioUrl: string, position: { x: number; y: number; z: number }) => {
      try {
        const response = await fetch(audioUrl);
        if (!response.ok) {
          console.warn('[harbor:audio] fetch failed', {
            agentId,
            url: audioUrl,
            status: response.status,
          });
          return;
        }
        const arrayBuffer = await response.arrayBuffer();
        await playBuffer(agentId, arrayBuffer, position);
      } catch (err) {
        console.warn('[harbor:audio] playAgentAudio failed', { agentId, err });
      }
    },
    [playBuffer],
  );

  const playAgentText = useCallback(
    async (agentId: string, text: string, position: { x: number; y: number; z: number }) => {
      try {
        const response = await fetch('/media/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice: agentId }),
        });
        if (!response.ok) {
          console.warn('[harbor:audio] tts request failed', { agentId, status: response.status });
          return;
        }
        const arrayBuffer = await response.arrayBuffer();
        await playBuffer(agentId, arrayBuffer, position);
      } catch (err) {
        console.warn('[harbor:audio] playAgentText failed', { agentId, err });
      }
    },
    [playBuffer],
  );

  const stopAll = useCallback(() => {
    for (const [id, active] of sourcesRef.current) {
      try {
        active.source.stop();
      } catch {
        // already stopped
      }
      sourcesRef.current.delete(id);
    }
  }, []);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    volumeRef.current = clamped;
    for (const active of sourcesRef.current.values()) {
      active.gain.gain.value = clamped;
    }
  }, []);

  const updateListenerPosition = useCallback((position: { x: number; y: number; z: number }) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const listener = ctx.listener;
    if (listener.positionX) {
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
    }
  }, []);

  return {
    playAgentAudio,
    playAgentText,
    stopAll,
    setVolume,
    updateListenerPosition,
    isReady,
    ensureContext,
  };
}
