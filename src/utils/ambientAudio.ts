/**
 * Web Audio Ambient Atmosphere Sound Engine for Graywood Reader.
 * Generates relaxing procedural ambient soundscapes (Rain, Soft Breeze, Fireside, Waves)
 * and interactive tactile sound effects (Page Turn) with zero external media files.
 */

export type AmbientSoundType = 'none' | 'rain' | 'breeze' | 'waves';

class AmbientAudioEngine {
  private ctx: AudioContext | null = null;
  private currentType: AmbientSoundType = 'none';
  private noiseNode: AudioNode | null = null;
  private gainNode: GainNode | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.25;

  private initContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode && this.ctx && !this.isMuted) {
      this.gainNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
    return this.isMuted;
  }

  public getSoundType(): AmbientSoundType {
    return this.currentType;
  }

  public stop(): void {
    if (this.noiseNode) {
      try {
        (this.noiseNode as any).stop?.();
        this.noiseNode.disconnect();
      } catch {}
      this.noiseNode = null;
    }
    this.currentType = 'none';
  }

  public play(type: AmbientSoundType): void {
    if (this.currentType === type && this.noiseNode) return;
    this.stop();

    if (type === 'none') return;
    const ctx = this.initContext();

    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    // Generate Pink / Brown Noise depending on soundscape
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      if (type === 'rain') {
        // Pink Noise for gentle rain
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else if (type === 'breeze') {
        // Soft low-passed atmospheric breeze
        b0 = 0.99 * b0 + white * 0.05;
        output[i] = b0 * 0.18;
      } else {
        // Waves: Brown Noise with slow resonant filter
        b0 = (b0 + (0.02 * white)) / 1.02;
        output[i] = b0 * 3.5;
      }
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    // Filter shaping
    const filter = ctx.createBiquadFilter();
    if (type === 'rain') {
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, ctx.currentTime);
    } else if (type === 'breeze') {
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(450, ctx.currentTime);
      filter.Q.setValueAtTime(1.2, ctx.currentTime);
    } else {
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(350, ctx.currentTime);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, ctx.currentTime);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    whiteNoise.start(0);

    this.noiseNode = whiteNoise;
    this.gainNode = gain;
    this.currentType = type;
  }

  /**
   * Play a subtle, tactile procedural paper page-turn swoosh sound.
   */
  public playPageTurn(): void {
    try {
      const ctx = this.initContext();
      if (this.isMuted) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.06 * this.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.08);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.08);
    } catch {}
  }
}

export const ambientAudio = new AmbientAudioEngine();
