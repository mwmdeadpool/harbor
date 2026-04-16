import { useRef, useEffect, useCallback, useState } from 'react';
import { VisemeAnalyzer, type VisemeWeights } from '../audio/VisemeAnalyzer';

const SILENT: VisemeWeights = { aa: 0, oh: 0, ee: 0, ss: 0, silence: 1 };

/**
 * React hook that drives per-frame viseme weights from a VisemeAnalyzer.
 *
 * @param enabled  Whether to run the analysis loop.
 * @returns { visemes, analyzer } — current weights + the analyzer instance
 *          (so callers can connect audio sources to it).
 */
export function useVisemes(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<VisemeAnalyzer | null>(null);
  const rafRef = useRef<number>(0);
  const [visemes, setVisemes] = useState<VisemeWeights>(SILENT);

  // Lazily create AudioContext + Analyzer on first enable
  useEffect(() => {
    if (!enabled) return;

    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        // AudioContext unavailable — stay in amplitude-only / silent mode
        return;
      }
    }
    if (!analyzerRef.current) {
      analyzerRef.current = new VisemeAnalyzer(ctxRef.current);
    }
  }, [enabled]);

  // Animation loop
  useEffect(() => {
    if (!enabled) {
      setVisemes(SILENT);
      return;
    }

    let active = true;

    const tick = () => {
      if (!active) return;
      const a = analyzerRef.current;
      if (a && a.isConnected) {
        setVisemes(a.getVisemes());
      } else if (a) {
        // Fallback: amplitude-only mode — map amplitude to aa
        const amp = a.getAmplitude();
        if (amp > 0.01) {
          setVisemes({ aa: amp, oh: 0, ee: 0, ss: 0, silence: 0 });
        } else {
          setVisemes(SILENT);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      analyzerRef.current?.disconnect();
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  const getAnalyzer = useCallback(() => analyzerRef.current, []);

  return { visemes, getAnalyzer };
}
