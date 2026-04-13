import pino from 'pino';
import type { TranscriptionResult } from './types.js';

const log = pino({ name: 'harbor:media:stt' });

const WHISPER_URL = process.env.WHISPER_URL || 'http://localhost:8787/v1/audio/transcriptions';

/**
 * Transcribe an audio buffer using the local Whisper API.
 */
export async function transcribe(
  audioBuffer: Buffer,
  format?: string,
): Promise<TranscriptionResult> {
  const startTime = Date.now();

  try {
    const formData = new FormData();
    const arrayBuf = audioBuffer.buffer.slice(
      audioBuffer.byteOffset,
      audioBuffer.byteOffset + audioBuffer.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuf], {
      type: format ? `audio/${format}` : 'audio/webm',
    });
    formData.append('file', blob, `audio.${format || 'webm'}`);
    formData.append('model', 'whisper-1');

    const response = await fetch(WHISPER_URL, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      log.error({ status: response.status, body }, 'Whisper API error');
      return { text: '', duration_ms: Date.now() - startTime };
    }

    const result = (await response.json()) as { text?: string };
    const text = (result.text || '').trim();
    const duration_ms = Date.now() - startTime;

    log.info({ text: text.slice(0, 80), duration_ms }, 'Transcription complete');

    return { text, duration_ms };
  } catch (err) {
    log.error({ err }, 'Transcription failed');
    return { text: '', duration_ms: Date.now() - startTime };
  }
}
