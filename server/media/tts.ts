import pino from 'pino';
import type { VoiceInfo } from './types.js';

const log = pino({ name: 'harbor:media:tts' });

const FISH_AUDIO_URL = process.env.FISH_AUDIO_URL || 'https://api.fish.audio/v1/tts';
const FISH_AUDIO_KEY = process.env.FISH_AUDIO_KEY || '';

interface VoiceEntry {
  referenceId: string;
  label: string;
  agent: string;
}

const VOICE_MAP: Record<string, VoiceEntry> = {
  fish_margot: {
    referenceId: 'd07497a43c3b428fa6098b1acc51ee37',
    label: 'Margot (Harley Quinn, Brooklyn)',
    agent: 'margot',
  },
  fish_ivy: {
    referenceId: '1b42979c91f84595848fa1f27083388b',
    label: 'Ivy (Poison Ivy, BTAS)',
    agent: 'ivy',
  },
  fish_nygma: {
    referenceId: '7866ce79c5ea49fdb24b4d3f8a49e93b',
    label: 'Nygma (The Riddler, raspy)',
    agent: 'nygma',
  },
  fish_harvey: {
    referenceId: '924be022ee8341d7a1cc719ddf1f754c',
    label: 'Harvey (Two-Face, raspy intense)',
    agent: 'harvey',
  },
  fish_bud: {
    referenceId: '9a7e75ad341d4c0499887c457cd43b6d',
    label: 'Bud (Matthew, podcast professional)',
    agent: 'bud',
  },
  fish_lou: {
    referenceId: '504dc8fab6ed455484b66a279f37c073',
    label: 'Lou (Leena the Hyena)',
    agent: 'lou',
  },
};

const AGENT_VOICE_MAP: Record<string, string> = {
  margot: 'fish_margot',
  ivy: 'fish_ivy',
  nygma: 'fish_nygma',
  harvey: 'fish_harvey',
  bud: 'fish_bud',
  lou: 'fish_lou',
};

function resolveVoice(voice: string): string {
  if (VOICE_MAP[voice]) return voice;
  if (AGENT_VOICE_MAP[voice]) return AGENT_VOICE_MAP[voice];
  log.warn({ voice }, 'Unknown voice, falling back to fish_margot');
  return 'fish_margot';
}

function fishHeaders(): Record<string, string> {
  if (!FISH_AUDIO_KEY) {
    throw new Error('FISH_AUDIO_KEY env var is required');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${FISH_AUDIO_KEY}`,
  };
}

function fishBody(text: string, referenceId: string): string {
  return JSON.stringify({
    text,
    reference_id: referenceId,
    format: 'mp3',
    mp3_bitrate: 128,
    normalize: true,
    latency: 'normal',
  });
}

export async function synthesize(text: string, voice: string): Promise<Buffer> {
  const voiceId = resolveVoice(voice);
  const entry = VOICE_MAP[voiceId]!;

  const response = await fetch(FISH_AUDIO_URL, {
    method: 'POST',
    headers: fishHeaders(),
    body: fishBody(text, entry.referenceId),
  });

  if (!response.ok) {
    const body = await response.text();
    log.error({ status: response.status, body, voice: voiceId }, 'Fish Audio TTS error');
    throw new Error(`Fish Audio TTS error: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function* synthesizeStream(text: string, voice: string): AsyncGenerator<Buffer> {
  const voiceId = resolveVoice(voice);
  const entry = VOICE_MAP[voiceId]!;

  const response = await fetch(FISH_AUDIO_URL, {
    method: 'POST',
    headers: fishHeaders(),
    body: fishBody(text, entry.referenceId),
  });

  if (!response.ok) {
    const body = await response.text();
    log.error({ status: response.status, body, voice: voiceId }, 'Fish Audio TTS stream error');
    throw new Error(`Fish Audio TTS error: ${response.status}`);
  }

  if (!response.body) {
    throw new Error('TTS response has no body');
  }

  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield Buffer.from(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export function getVoices(): VoiceInfo[] {
  return Object.entries(VOICE_MAP).map(([id, entry]) => ({
    id,
    name: entry.label,
    agent: entry.agent,
    provider: 'fish-audio',
  }));
}
