/** Synthesised match audio (no sound files to download): crowd bed, whistle, kicks, goal roar. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private crowdGain!: GainNode;
  private noise!: AudioBuffer;
  private excitement = 0;
  enabled = true;

  /** Must be called from a user gesture (browser autoplay rules). */
  start(): void {
    if (this.ctx || !this.enabled) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      // Brown-ish noise reads as a distant crowd.
      b = (b + (Math.random() * 2 - 1) * 0.02) / 1.02;
      d[i] = b * 3.5 + (Math.random() * 2 - 1) * 0.04;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.25;
    src.connect(bp).connect(this.crowdGain).connect(this.master);
    src.start();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.ctx) void (on ? this.ctx.resume() : this.ctx.suspend());
    else if (on) this.start();
  }

  stop(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  /** 0..1, how close the ball is to a goal; the crowd swells with it. */
  setExcitement(x: number): void {
    if (!this.ctx) return;
    this.excitement += (x - this.excitement) * 0.05;
    this.crowdGain.gain.setTargetAtTime(0.18 + this.excitement * 0.35, this.ctx.currentTime, 0.3);
  }

  whistle(long = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = long ? 0.9 : 0.35;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2900;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 35;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 120;
    lfo.connect(lfoG).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.02);
    g.gain.setValueAtTime(0.18, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur);
    lfo.stop(t + dur);
  }

  kick(power: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25 + power * 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }

  thud(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(400, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.36);
  }

  roar(seconds = 3.5): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.4);
    g.gain.linearRampToValueAtTime(0, t + seconds);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + seconds);
  }

  groan(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(300, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.linearRampToValueAtTime(0, t + 1.3);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1.3);
  }
}
