// ============================================================================
// AMBIENT SOUNDSCAPE & SFX ENGINE (Procedural Web Audio Synthesizer)
// Provides 100% offline, zero-asset synthesized soundscapes & page turn SFX.
// ============================================================================

export type AmbientPreset = 'rain' | 'campfire' | 'waves' | 'cafe' | 'off';

class AmbientSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private currentPreset: AmbientPreset = 'off';
  private volume: number = 0.5;
  private pageTurnSfxEnabled: boolean = true;
  private activeNodes: { stop?: () => void; disconnect?: () => void }[] = [];
  private sleepTimerId: any = null;
  private sleepExpiresAt: number | null = null;
  private listeners: Set<() => void> = new Set();

  private initContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.masterGain && this.ctx) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private stopCurrentPreset() {
    for (const node of this.activeNodes) {
      try {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      } catch {}
    }
    this.activeNodes = [];
  }

  public setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
    this.notify();
  }

  public getVolume(): number {
    return this.volume;
  }

  public getPreset(): AmbientPreset {
    return this.currentPreset;
  }

  public getSleepExpiresAt(): number | null {
    return this.sleepExpiresAt;
  }

  public setPageTurnSfxEnabled(enabled: boolean) {
    this.pageTurnSfxEnabled = enabled;
    this.notify();
  }

  public isPageTurnSfxEnabled(): boolean {
    return this.pageTurnSfxEnabled;
  }

  public setSleepTimer(minutes: number | null) {
    if (this.sleepTimerId) {
      clearTimeout(this.sleepTimerId);
      this.sleepTimerId = null;
      this.sleepExpiresAt = null;
    }

    if (minutes && minutes > 0) {
      this.sleepExpiresAt = Date.now() + minutes * 60 * 1000;
      this.sleepTimerId = setTimeout(() => {
        this.setPreset('off');
        this.sleepExpiresAt = null;
        this.sleepTimerId = null;
        this.notify();
      }, minutes * 60 * 1000);
    }

    this.notify();
  }

  public setPreset(preset: AmbientPreset) {
    if (this.currentPreset === preset && preset !== 'off') return;
    this.stopCurrentPreset();
    this.currentPreset = preset;

    if (preset === 'off') {
      this.notify();
      return;
    }

    const ctx = this.initContext();
    if (!this.masterGain) return;

    if (preset === 'rain') {
      this.startRainSynth(ctx, this.masterGain);
    } else if (preset === 'campfire') {
      this.startCampfireSynth(ctx, this.masterGain);
    } else if (preset === 'waves') {
      this.startWavesSynth(ctx, this.masterGain);
    } else if (preset === 'cafe') {
      this.startCafeSynth(ctx, this.masterGain);
    }

    this.notify();
  }

  // 🌧️ Synthesized Rain on Glass
  private startRainSynth(ctx: AudioContext, dest: GainNode) {
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, ctx.currentTime);
    filter.Q.setValueAtTime(0.8, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.45, ctx.currentTime);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    whiteNoise.start();

    this.activeNodes.push(whiteNoise, filter, gain);
  }

  // 🔥 Synthesized Campfire with Crackle
  private startCampfireSynth(ctx: AudioContext, dest: GainNode) {
    // 1. Low frequency warmth rumble
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5;
    }

    const brownNoise = ctx.createBufferSource();
    brownNoise.buffer = noiseBuffer;
    brownNoise.loop = true;

    const lowFilter = ctx.createBiquadFilter();
    lowFilter.type = 'lowpass';
    lowFilter.frequency.setValueAtTime(320, ctx.currentTime);

    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.6, ctx.currentTime);

    brownNoise.connect(lowFilter);
    lowFilter.connect(rumbleGain);
    rumbleGain.connect(dest);
    brownNoise.start();

    this.activeNodes.push(brownNoise, lowFilter, rumbleGain);

    // 2. Procedural wood crackles
    let isRunning = true;
    const scheduleCrackle = () => {
      if (!isRunning || this.currentPreset !== 'campfire') return;
      const crackleOsc = ctx.createBufferSource();
      const cBuf = ctx.createBuffer(1, 1024, ctx.sampleRate);
      const cData = cBuf.getChannelData(0);
      for (let j = 0; j < 1024; j++) cData[j] = (Math.random() * 2 - 1) * Math.exp(-j / 120);
      crackleOsc.buffer = cBuf;

      const cFilter = ctx.createBiquadFilter();
      cFilter.type = 'highpass';
      cFilter.frequency.setValueAtTime(2500 + Math.random() * 2000, ctx.currentTime);

      const cGain = ctx.createGain();
      cGain.gain.setValueAtTime(0.3 + Math.random() * 0.4, ctx.currentTime);

      crackleOsc.connect(cFilter);
      cFilter.connect(cGain);
      cGain.connect(dest);
      crackleOsc.start();

      const nextDelay = 150 + Math.random() * 900;
      setTimeout(scheduleCrackle, nextDelay);
    };

    scheduleCrackle();
    this.activeNodes.push({ stop: () => { isRunning = false; } });
  }

  // 🌊 Synthesized Ocean Surf & Waves
  private startWavesSynth(ctx: AudioContext, dest: GainNode) {
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = (Math.random() * 2 - 1) * 0.4;

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, ctx.currentTime);

    // LFO for surf wave cycle (8-second cycle)
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.12, ctx.currentTime); // ~8s swell

    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(350, ctx.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const waveGain = ctx.createGain();
    waveGain.gain.setValueAtTime(0.5, ctx.currentTime);

    noise.connect(filter);
    filter.connect(waveGain);
    waveGain.connect(dest);

    noise.start();
    lfo.start();

    this.activeNodes.push(noise, lfo, filter, waveGain, lfoGain);
  }

  // ☕ Cozy Cafe Ambient Room Tone
  private startCafeSynth(ctx: AudioContext, dest: GainNode) {
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.015 * white) / 1.015;
      lastOut = output[i];
      output[i] *= 2.8;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(450, ctx.currentTime);
    filter.Q.setValueAtTime(0.7, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, ctx.currentTime);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    noise.start();

    this.activeNodes.push(noise, filter, gain);
  }

  // 📖 Tactile Page Turn SFX
  public playPageTurnSfx() {
    if (!this.pageTurnSfxEnabled) return;
    try {
      const ctx = this.initContext();
      const bufferSize = Math.floor(ctx.sampleRate * 0.12);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        const progress = i / bufferSize;
        const env = Math.sin(progress * Math.PI) * Math.exp(-progress * 3.5);
        data[i] = (Math.random() * 2 - 1) * env * 0.25;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2200, ctx.currentTime);
      filter.Q.setValueAtTime(1.2, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(this.volume * 0.6, ctx.currentTime);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      source.start();
    } catch {}
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try { fn(); } catch {}
    });
  }
}

export const ambientSound = new AmbientSoundEngine();
