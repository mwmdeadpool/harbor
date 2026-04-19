import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

interface Options {
  intervalMs?: number;
  enabled?: boolean;
}

export function usePanelData<T>(
  path: string,
  { intervalMs = 30_000, enabled = true }: Options = {},
) {
  const token = useStore((s) => s.token);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !token) return;

    let cancelled = false;

    async function tick() {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(path, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const body = (await res.json()) as T;
        if (!cancelled) {
          setData(body);
          setError(null);
        }
      } catch (err) {
        if (cancelled || (err as Error).name === 'AbortError') return;
        setError((err as Error).message);
      }
    }

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [path, intervalMs, enabled, token]);

  return { data, error };
}

export function usePanelImage(path: string, intervalMs = 5_000, enabled = true) {
  const token = useStore((s) => s.token);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !token) return;

    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(path, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const next = URL.createObjectURL(blob);
        if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = next;
        setUrl(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
      }
    }

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (lastUrlRef.current) {
        URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = null;
      }
    };
  }, [path, intervalMs, enabled, token]);

  return { url, error };
}
