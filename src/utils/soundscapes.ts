// ============================================================================
// AMBIENT SOUNDSCAPES & PROCEDURAL AUDIO SYNTHESIZER
// ============================================================================
// Built on the native Web Audio API. Synthesizes atmospheric background
// soundscapes (Rain, Campfire, Lo-Fi) and realistic tactile page-turn SFX
// with 0 external network dependencies.
// ============================================================================

export type SoundscapePreset = 'rain' | 'campfire' | 'lofi' | 'off';

class SoundscapeEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeNodes: AudioNode[] = [];
  private noiseNode: AudioBufferSourceNode | null = null;
  private activeIntervals: number[] = [];
  private currentPreset: SoundscapePreset = 'off';
  private volume: number = 0.5;
  private sleepTimerId: number | null = null;
  private sleepExpiresAt: number | null = null;

  private initContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (!this.masterGain) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /**
   * Generates a 5-second looping buffer of pink/brown noise
   */
  private createNoiseBuffer(type: 'pink' | 'brown' | 'white'): AudioBuffer {
    const ctx = this.initContext();
    const bufferSize = ctx.sampleRate * 5;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let lastOut = 0.0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;

      if (type === 'pink') {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else if (type === 'brown') {
        output[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5;
      } else {
        output[i] = white * 0.2;
      }
    }
    return buffer;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public getCurrentPreset(): SoundscapePreset {
    return this.currentPreset;
  }

  public stop(): void {
    this.activeIntervals.forEach(id => clearInterval(id));
    this.activeIntervals = [];

    if (this.noiseNode) {
      try { this.noiseNode.stop(); } catch {}
      try { this.noiseNode.disconnect(); } catch {}
      this.noiseNode = null;
    }

    this.activeNodes.forEach(node => {
      try { node.disconnect(); } catch {}
    });
    this.activeNodes = [];
    this.currentPreset = 'off';
  }

  public playPreset(preset: SoundscapePreset): void {
    this.stop();
    if (preset === 'off') return;

    const ctx = this.initContext();
    this.currentPreset = preset;

    if (preset === 'rain') {
      this.buildRainSoundscape(ctx);
    } else if (preset === 'campfire') {
      this.buildCampfireSoundscape(ctx);
    } else if (preset === 'lofi') {
      this.buildLofiSoundscape(ctx);
    }
  }

  /**
   * 🌧️ Rain Soundscape: Continuous filtered pink noise + randomized rain drop taps
   */
  private buildRainSoundscape(ctx: AudioContext): void {
    const buffer = this.createNoiseBuffer('pink');
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    // Filter to simulate sound hitting glass/window
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, ctx.currentTime);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    noise.start();

    this.noiseNode = noise;
    this.activeNodes.push(filter, gain);

    // Random droplet splashes
    const dropletInterval = window.setInterval(() => {
      if (this.currentPreset !== 'rain' || !this.ctx) return;
      try {
        const osc = this.ctx.createOscillator();
        const dropGain = this.ctx.createGain();
        const freq = 1200 + Math.random() * 1400;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.4, this.ctx.currentTime + 0.08);

        dropGain.gain.setValueAtTime(0.04 * Math.random(), this.ctx.currentTime);
        dropGain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.08);

        osc.connect(dropGain);
        dropGain.connect(this.masterGain!);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.09);
      } catch {}
    }, 180);

    this.activeIntervals.push(dropletInterval);
  }

  /**
   * 🌲 Campfire Soundscape: Deep warm brown noise + randomized crackles
   */
  private buildCampfireSoundscape(ctx: AudioContext): void {
    const buffer = this.createNoiseBuffer('brown');
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6, ctx.currentTime);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    noise.start();

    this.noiseNode = noise;
    this.activeNodes.push(filter, gain);

    // Crackle & Pop generator
    const crackleInterval = window.setInterval(() => {
      if (this.currentPreset !== 'campfire' || !this.ctx) return;
      try {
        const osc = this.ctx.createOscillator();
        const crackleGain = this.ctx.createGain();
        const freq = 300 + Math.random() * 2200;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        crackleGain.gain.setValueAtTime(0.08 * Math.random(), this.ctx.currentTime);
        crackleGain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.03);

        osc.connect(crackleGain);
        crackleGain.connect(this.masterGain!);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.035);
      } catch {}
    }, 90);

    this.activeIntervals.push(crackleInterval);
  }

  /**
   * ☕ Lo-Fi Soundscape: Vinyl crackle + soothing mellow tape atmosphere
   */
  private buildLofiSoundscape(ctx: AudioContext): void {
    const buffer = this.createNoiseBuffer('pink');
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(650, ctx.currentTime);
    filter.Q.setValueAtTime(1.5, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, ctx.currentTime);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    noise.start();

    this.noiseNode = noise;
    this.activeNodes.push(filter, gain);
  }

  /**
   * 📖 Tactile Page Turn SFX
   */
  public playPageTurn(): void {
    try {
      const ctx = this.initContext();
      const buffer = this.createNoiseBuffer('white');
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1400, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.15);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.25 * this.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start();
      noise.stop(ctx.currentTime + 0.16);
    } catch {}
  }

  /**
   * Sleep Timer (in minutes)
   */
  public setSleepTimer(minutes: number, onExpire?: () => void): void {
    if (this.sleepTimerId) {
      window.clearTimeout(this.sleepTimerId);
      this.sleepTimerId = null;
      this.sleepExpiresAt = null;
    }

    if (minutes <= 0) return;

    this.sleepExpiresAt = Date.now() + minutes * 60 * 1000;
    this.sleepTimerId = window.setTimeout(() => {
      this.stop();
      this.sleepExpiresAt = null;
      this.sleepTimerId = null;
      if (onExpire) onExpire();
    }, minutes * 60 * 1000);
  }

  public getRemainingSleepMinutes(): number | null {
    if (!this.sleepExpiresAt) return null;
    const remainingMs = this.sleepExpiresAt - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 60000) : null;
  }
}

export const soundscapes = new SoundscapeEngine();
