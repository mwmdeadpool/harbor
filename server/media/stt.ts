import pino from 'pino';
import net from 'node:net';
import { spawn } from 'node:child_process';
import type { TranscriptionResult } from './types.js';

const log = pino({ name: 'harbor:media:stt' });

const PARAKEET_URL = process.env.PARAKEET_URL || 'tcp://192.168.10.2:10300';
const STT_TIMEOUT_MS = parseInt(process.env.STT_TIMEOUT_MS || '15000', 10);
const CHUNK_BYTES = 4096;
const SAMPLE_RATE = 16000;

interface WyomingEvent {
  type: string;
  data?: Record<string, unknown>;
  payload_length?: number;
  payload?: Buffer;
}

function parseWyomingUrl(url: string): { host: string; port: number } {
  const match = url.match(/^tcp:\/\/([^:]+):(\d+)$/);
  if (!match) throw new Error(`Invalid Wyoming URL: ${url}`);
  return { host: match[1]!, port: parseInt(match[2]!, 10) };
}

function transcodeToPcm(buffer: Buffer, format?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const inputFmt = format === 'wav' ? 'wav' : format === 'mp3' ? 'mp3' : 'webm';
    const ff = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      inputFmt,
      '-i',
      'pipe:0',
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '1',
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      'pipe:1',
    ]);

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (c) => errChunks.push(c));
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errChunks).toString()}`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    ff.stdin.end(buffer);
  });
}

function encodeEvent(type: string, data?: Record<string, unknown>, payload?: Buffer): Buffer {
  const header: Record<string, unknown> = { type };
  let dataBytes: Buffer | null = null;
  if (data !== undefined) {
    dataBytes = Buffer.from(JSON.stringify(data), 'utf8');
    header.data_length = dataBytes.length;
  }
  if (payload && payload.length > 0) {
    header.payload_length = payload.length;
  }
  const parts: Buffer[] = [Buffer.from(JSON.stringify(header) + '\n', 'utf8')];
  if (dataBytes) parts.push(dataBytes);
  if (payload && payload.length > 0) parts.push(payload);
  return Buffer.concat(parts);
}

class WyomingParser {
  private buf: Buffer = Buffer.alloc(0);
  private pending: { type: string; data_length: number; payload_length: number } | null = null;

  feed(chunk: Buffer): WyomingEvent[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const events: WyomingEvent[] = [];

    while (true) {
      if (!this.pending) {
        const nl = this.buf.indexOf(0x0a);
        if (nl < 0) break;
        const line = this.buf.subarray(0, nl).toString('utf8');
        this.buf = this.buf.subarray(nl + 1);
        let parsed: { type?: string; data_length?: number; payload_length?: number };
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (!parsed.type) continue;
        this.pending = {
          type: parsed.type,
          data_length: parsed.data_length || 0,
          payload_length: parsed.payload_length || 0,
        };
      }

      const need = this.pending.data_length + this.pending.payload_length;
      if (this.buf.length < need) break;

      let data: Record<string, unknown> | undefined;
      if (this.pending.data_length > 0) {
        const dataBytes = this.buf.subarray(0, this.pending.data_length);
        this.buf = this.buf.subarray(this.pending.data_length);
        try {
          data = JSON.parse(dataBytes.toString('utf8'));
        } catch {
          data = undefined;
        }
      }

      let payload: Buffer | undefined;
      if (this.pending.payload_length > 0) {
        payload = this.buf.subarray(0, this.pending.payload_length);
        this.buf = this.buf.subarray(this.pending.payload_length);
      }

      events.push({ type: this.pending.type, data, payload });
      this.pending = null;
    }

    return events;
  }
}

async function transcribeViaWyoming(pcm: Buffer): Promise<string> {
  const { host, port } = parseWyomingUrl(PARAKEET_URL);

  return new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const parser = new WyomingParser();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`Wyoming STT timeout after ${STT_TIMEOUT_MS}ms`));
    }, STT_TIMEOUT_MS);

    const finish = (err: Error | null, text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      if (err) reject(err);
      else resolve(text);
    };

    socket.on('error', (err) => finish(err, ''));
    socket.on('close', () => finish(new Error('Wyoming socket closed before transcript'), ''));

    socket.on('data', (chunk) => {
      for (const evt of parser.feed(chunk)) {
        if (evt.type === 'transcript') {
          const text = ((evt.data?.text as string) || '').trim();
          finish(null, text);
          return;
        }
      }
    });

    socket.on('connect', () => {
      socket.write(encodeEvent('transcribe', { language: 'en' }));
      socket.write(
        encodeEvent('audio-start', {
          rate: SAMPLE_RATE,
          width: 2,
          channels: 1,
          timestamp: 0,
        }),
      );

      let offset = 0;
      let timestampMs = 0;
      while (offset < pcm.length) {
        const end = Math.min(offset + CHUNK_BYTES, pcm.length);
        const chunkPayload = pcm.subarray(offset, end);
        socket.write(
          encodeEvent(
            'audio-chunk',
            {
              rate: SAMPLE_RATE,
              width: 2,
              channels: 1,
              timestamp: timestampMs,
            },
            chunkPayload,
          ),
        );
        offset = end;
        timestampMs += Math.floor((chunkPayload.length / 2 / SAMPLE_RATE) * 1000);
      }

      socket.write(encodeEvent('audio-stop', { timestamp: timestampMs }));
    });
  });
}

export async function transcribe(
  audioBuffer: Buffer,
  format?: string,
): Promise<TranscriptionResult> {
  const startTime = Date.now();

  try {
    const pcm = await transcodeToPcm(audioBuffer, format);
    if (pcm.length === 0) {
      log.warn({ format }, 'Transcode produced empty PCM');
      return { text: '', duration_ms: Date.now() - startTime };
    }

    const text = await transcribeViaWyoming(pcm);
    const duration_ms = Date.now() - startTime;
    log.info(
      { text: text.slice(0, 80), duration_ms, pcm_bytes: pcm.length },
      'Transcription complete',
    );
    return { text, duration_ms };
  } catch (err) {
    log.error({ err }, 'Transcription failed');
    return { text: '', duration_ms: Date.now() - startTime };
  }
}
