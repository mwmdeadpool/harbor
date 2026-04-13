import pino from 'pino';
import type { VoiceInfo } from './types.js';

const log = pino({ name: 'harbor:media:tts' });

const FISH_AUDIO_URL = process.env.FISH_AUDIO_URL || 'http://localhost:8765/v1/tts';
const CHATTERBOX_URL = process.env.CHATTERBOX_URL || 'http://localhost:8766/synthesize';

/** Voice ID to provider + voice_id mapping */
const VOICE_MAP: Record<string, { provider: 'fish-audio' | 'chatterbox'; voiceId: string }> = {
  fish_margot: { provider: 'fish-audio', voiceId: 'fish_margot' },
  fish_nygma: { provider: 'fish-audio', voiceId: 'fish_nygma' },
  fish_ivy: { provider: 'fish-audio', voiceId: 'fish_ivy' },
  chatterbox_bud: { provider: 'chatterbox', voiceId: 'chatterbox_bud' },
  chatterbox_lou: { provider: 'chatterbox', voiceId: 'chatterbox_lou' },
  chatterbox_harvey: { provider: 'chatterbox', voiceId: 'chatterbox_harvey' },
};

/** Agent name to default voice ID */
const AGENT_VOICE_MAP: Record<string, string> = {
  margot: 'fish_margot',
  bud: 'chatterbox_bud',
  lou: 'chatterbox_lou',
  nygma: 'fish_nygma',
  ivy: 'fish_ivy',
  harvey: 'chatterbox_harvey',
};

/**
 * Resolve a voice identifier — accepts either a voice ID (fish_margot)
 * or an agent name (margot) and returns the canonical voice ID.
 */
function resolveVoice(voice: string): string {
  if (VOICE_MAP[voice]) return voice;
  if (AGENT_VOICE_MAP[voice]) return AGENT_VOICE_MAP[voice];
  log.warn({ voice }, 'Unknown voice, falling back to fish_margot');
  return 'fish_margot';
}

/**
 * Synthesize speech from text, returning the full audio buffer.
 */
export async function synthesize(text: string, voice: string): Promise<Buffer> {
  const voiceId = resolveVoice(voice);
  const mapping = VOICE_MAP[voiceId]!;

  if (mapping.provider === 'fish-audio') {
    return synthesizeFishAudio(text, mapping.voiceId);
  } else {
    return synthesizeChatterbox(text, mapping.voiceId);
  }
}

/**
 * Synthesize speech from text, yielding audio chunks as they arrive (streaming).
 */
export async function* synthesizeStream(text: string, voice: string): AsyncGenerator<Buffer> {
  const voiceId = resolveVoice(voice);
  const mapping = VOICE_MAP[voiceId]!;

  let url: string;
  let body: string;
  let headers: Record<string, string>;

  if (mapping.provider === 'fish-audio') {
    url = FISH_AUDIO_URL;
    body = JSON.stringify({
      text,
      voice_id: mapping.voiceId,
      format: 'wav',
      sample_rate: 44100,
    });
    headers = { 'Content-Type': 'application/json' };
  } else {
    url = CHATTERBOX_URL;
    body = JSON.stringify({ text, voice: mapping.voiceId });
    headers = { 'Content-Type': 'application/json' };
  }

  const response = await fetch(url, { method: 'POST', headers, body });

  if (!response.ok) {
    const errBody = await response.text();
    log.error({ status: response.status, body: errBody, provider: mapping.provider }, 'TTS error');
    throw new Error(`TTS service error (${mapping.provider}): ${response.status}`);
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

async function synthesizeFishAudio(text: string, voiceId: string): Promise<Buffer> {
  const response = await fetch(FISH_AUDIO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice_id: voiceId,
      format: 'wav',
      sample_rate: 44100,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    log.error({ status: response.status, body }, 'Fish Audio TTS error');
    throw new Error(`Fish Audio TTS error: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function synthesizeChatterbox(text: string, voiceId: string): Promise<Buffer> {
  const response = await fetch(CHATTERBOX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: voiceId }),
  });

  if (!response.ok) {
    const body = await response.text();
    log.error({ status: response.status, body }, 'ChatterboxTTS error');
    throw new Error(`ChatterboxTTS error: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Return the list of available voices with agent mappings.
 */
export function getVoices(): VoiceInfo[] {
  return [
    {
      id: 'fish_margot',
      name: 'Margot',
      agent: 'margot',
      provider: 'fish-audio',
    },
    {
      id: 'chatterbox_bud',
      name: 'Bud',
      agent: 'bud',
      provider: 'chatterbox',
    },
    {
      id: 'chatterbox_lou',
      name: 'Lou',
      agent: 'lou',
      provider: 'chatterbox',
    },
    {
      id: 'fish_nygma',
      name: 'Nygma',
      agent: 'nygma',
      provider: 'fish-audio',
    },
    {
      id: 'fish_ivy',
      name: 'Ivy',
      agent: 'ivy',
      provider: 'fish-audio',
    },
    {
      id: 'chatterbox_harvey',
      name: 'Harvey',
      agent: 'harvey',
      provider: 'chatterbox',
    },
  ];
}
