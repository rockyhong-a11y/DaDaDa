/**
 * 오디오 그래프 루트. 음악 버스와 효과음 버스를 분리하고
 * 마스터에 리미터를 걸어 클리핑을 막는다.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly musicBus: GainNode;
  readonly sfxBus: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  /** 공용 노이즈 버퍼 (스네어·하이햇·바람소리에 재사용) */
  readonly noise: AudioBuffer;
  readonly reverb: ConvolverNode;
  private readonly reverbSend: GainNode;

  constructor() {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: 'interactive' });

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.72;
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.85;

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = makeImpulse(this.ctx, 2.4, 2.6);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0.22;

    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.reverbSend);
    this.sfxBus.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    this.noise = makeNoise(this.ctx, 2);
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  setMusicVolume(v: number): void {
    this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setSfxVolume(v: number): void {
    this.sfxBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  noiseSource(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }
}

function makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 1337;
  for (let i = 0; i < len; i++) {
    // xorshift 로 결정적 화이트 노이즈 생성
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    data[i] = (seed / 0x7fffffff) % 1;
  }
  return buf;
}

function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}
