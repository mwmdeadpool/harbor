import express from 'express';
import multer from 'multer';
import pino from 'pino';

import { transcribe } from './stt.js';
import { synthesize, synthesizeStream, getVoices } from './tts.js';

const log = pino({ name: 'harbor:media' });
const PORT = parseInt(process.env.MEDIA_PORT || '3334', 10);
const CORS_ORIGIN = process.env.HARBOR_CLIENT_ORIGIN || '*';

const app = express();
app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Multer for audio upload (in-memory, 10MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// --- Health check ---

app.get('/media/health', async (_req, res) => {
  let sttOk = false;
  let ttsOk = false;

  try {
    const whisperUrl = process.env.WHISPER_URL || 'http://localhost:8787/v1/audio/transcriptions';
    const sttResp = await fetch(whisperUrl, { method: 'GET' }).catch(() => null);
    sttOk = sttResp !== null && sttResp.status < 500;
  } catch {
    // leave false
  }

  try {
    const fishUrl = process.env.FISH_AUDIO_URL || 'http://localhost:8765/v1/tts';
    const ttsResp = await fetch(fishUrl, { method: 'GET' }).catch(() => null);
    ttsOk = ttsResp !== null && ttsResp.status < 500;
  } catch {
    // leave false
  }

  res.json({ status: 'ok', stt: sttOk, tts: ttsOk });
});

// --- Voices ---

app.get('/media/voices', (_req, res) => {
  res.json(getVoices());
});

// --- STT ---

app.post('/media/stt', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No audio file provided (field name: audio)' });
    return;
  }

  try {
    const format = req.body?.format || req.file.mimetype?.split('/')[1] || undefined;
    const result = await transcribe(req.file.buffer, format);
    res.json(result);
  } catch (err) {
    log.error({ err }, 'STT endpoint error');
    res.status(500).json({ error: 'Transcription failed' });
  }
});

// --- TTS ---

app.post('/media/tts', async (req, res) => {
  const { text, voice } = req.body || {};

  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  if (!voice || typeof voice !== 'string') {
    res.status(400).json({ error: 'voice is required' });
    return;
  }

  // Check Accept header for streaming preference
  const wantsStream = req.headers.accept?.includes('audio/');

  try {
    if (wantsStream) {
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Transfer-Encoding', 'chunked');

      for await (const chunk of synthesizeStream(text, voice)) {
        res.write(chunk);
      }
      res.end();
    } else {
      const audioBuffer = await synthesize(text, voice);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', audioBuffer.length.toString());
      res.send(audioBuffer);
    }
  } catch (err) {
    log.error({ err }, 'TTS endpoint error');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Speech synthesis failed' });
    }
  }
});

// --- Start server ---

app.listen(PORT, () => {
  log.info(`Harbor Media Service running on port ${PORT}`);
  log.info(`Health check: http://localhost:${PORT}/media/health`);
  log.info(`Voices: http://localhost:${PORT}/media/voices`);
});
