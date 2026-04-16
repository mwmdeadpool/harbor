/**
 * VisemeAnalyzer — Real-time frequency-to-viseme mapper.
 *
 * Connects to a Web Audio graph via an AnalyserNode and maps frequency bands
 * to simplified viseme weights every frame.
 *
 * Frequency → viseme mapping:
 *   100–500 Hz  → aa  (jaw open)
 *   500–1500 Hz → oh  (lip round)
 *   1500–4000 Hz → ee (lip spread)
 *   4000–8000 Hz → ss (consonants)
 */

export interface VisemeWeights {
  aa: number;
  oh: number;
  ee: number;
  ss: number;
  silence: number;
}

export class VisemeAnalyzer {
  private analyser: AnalyserNode;
  private freqData: Uint8Array<ArrayBuffer>;
  private sampleRate: number;
  private binCount: number;
  private connected = false;

  constructor(private ctx: AudioContext) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.binCount = this.analyser.frequencyBinCount;
    this.freqData = new Uint8Array(this.binCount);
    this.sampleRate = ctx.sampleRate;
  }

  /** Connect an audio source to the analyser. */
  connect(source: AudioNode): void {
    source.connect(this.analyser);
    this.connected = true;
  }

  /** Disconnect and clean up. */
  disconnect(): void {
    try {
      this.analyser.disconnect();
    } catch {
      // already disconnected — safe to ignore
    }
    this.connected = false;
  }

  /**
   * Return average energy (0-1) for a given frequency range across the
   * current analyser snapshot.
   */
  private bandEnergy(lowHz: number, highHz: number): number {
    const hzPerBin = this.sampleRate / (this.binCount * 2);
    const lo = Math.max(0, Math.floor(lowHz / hzPerBin));
    const hi = Math.min(this.binCount - 1, Math.ceil(highHz / hzPerBin));
    if (hi <= lo) return 0;

    let sum = 0;
    for (let i = lo; i <= hi; i++) {
      sum += this.freqData[i];
    }
    // Normalize: each bin is 0-255
    return sum / ((hi - lo + 1) * 255);
  }

  /** Snapshot current viseme weights (call once per frame). */
  getVisemes(): VisemeWeights {
    if (!this.connected) {
      return { aa: 0, oh: 0, ee: 0, ss: 0, silence: 1 };
    }

    this.analyser.getByteFrequencyData(this.freqData);

    const aa = this.bandEnergy(100, 500);
    const oh = this.bandEnergy(500, 1500);
    const ee = this.bandEnergy(1500, 4000);
    const ss = this.bandEnergy(4000, 8000);

    const maxWeight = Math.max(aa, oh, ee, ss);
    const silence = maxWeight < 0.05 ? 1 : Math.max(0, 1 - maxWeight * 2);

    return { aa, oh, ee, ss, silence };
  }

  /** Overall amplitude 0-1 (fallback when frequency analysis unavailable). */
  getAmplitude(): number {
    if (!this.connected) return 0;

    this.analyser.getByteFrequencyData(this.freqData);

    let sum = 0;
    for (let i = 0; i < this.binCount; i++) {
      sum += this.freqData[i];
    }
    return sum / (this.binCount * 255);
  }

  /** Whether a source is currently connected. */
  get isConnected(): boolean {
    return this.connected;
  }
}
