export interface TranscriptionResult {
  text: string;
  duration_ms: number;
}

export interface VoiceInfo {
  id: string;
  name: string;
  agent: string;
  provider: 'fish-audio' | 'chatterbox';
  sample_url?: string;
}

export interface TTSRequest {
  text: string;
  voice: string;
}
