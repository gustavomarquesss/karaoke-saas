import workletUrl from './processor.ts?worker&url';

export interface PlayerSources {
  vocals: string;
  instrumental: string;
}

const SAMPLE_RATE = 44100;

type Stem = { l: Float32Array; r: Float32Array };

/** Controla o AudioWorklet: carga dos stems, transporte e tempo de reprodução interpolado. */
export class KaraokePlayer {
  private lastFrame = 0;
  private lastAt = 0;
  private playing = false;
  private tempo = 1;
  duration = 0;
  onEnded?: () => void;
  onPlayingChange?: (playing: boolean) => void;
  /** a música começou a sair no frame `frame` do AudioContext (posição `media` em frames) */
  onStarted?: (frame: number, media: number) => void;
  /** a reprodução parou (pausa ou fim) no frame `frame` do AudioContext */
  onStopped?: (frame: number) => void;
  readonly sampleRate = SAMPLE_RATE;
  /** frame do AudioContext da última parada */
  lastStopFrame = 0;

  private constructor(
    private ctx: AudioContext,
    private node: AudioWorkletNode,
  ) {
    node.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'pos') {
        this.lastFrame = m.frame;
        this.lastAt = m.at;
        if (m.playing !== this.playing) {
          this.playing = m.playing;
          this.onPlayingChange?.(m.playing);
        }
        if (!m.playing && m.cf !== undefined) {
          this.lastStopFrame = m.cf;
          this.onStopped?.(m.cf);
        }
      } else if (m.type === 'started') {
        this.onStarted?.(m.frame, m.media);
      } else if (m.type === 'ended') {
        this.onEnded?.();
      }
    };
  }

  static async create(src: PlayerSources, signal?: AbortSignal): Promise<KaraokePlayer> {
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'karaoke-processor', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(ctx.destination);
      const [vocals, instrumental] = await Promise.all([decode(ctx, src.vocals, signal), decode(ctx, src.instrumental, signal)]);
      const player = new KaraokePlayer(ctx, node);
      const ready = new Promise<void>((resolve) => {
        const handler = node.port.onmessage!;
        node.port.onmessage = (e) => {
          if (e.data.type === 'ready') {
            node.port.onmessage = handler;
            resolve();
          } else handler.call(node.port, e);
        };
      });
      // a duração precisa ser lida ANTES de transferir os buffers (depois eles ficam com tamanho 0)
      player.duration = Math.max(vocals.l.length, instrumental.l.length) / SAMPLE_RATE;
      node.port.postMessage({ type: 'load', vocals, instrumental }, [vocals.l.buffer, vocals.r.buffer, instrumental.l.buffer, instrumental.r.buffer]);
      await ready;
      return player;
    } catch (err) {
      void ctx.close();
      throw err;
    }
  }

  /** Posição atual (s), interpolada entre as mensagens do worklet e corrigida pela latência de saída. */
  get currentTime(): number {
    let frames = this.lastFrame;
    if (this.playing) frames += (this.ctx.currentTime - this.lastAt) * SAMPLE_RATE * this.tempo;
    const latency = this.playing ? ((this.ctx.outputLatency || 0) + this.ctx.baseLatency) * this.tempo : 0;
    return Math.max(0, Math.min(frames / SAMPLE_RATE - latency, this.duration));
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  async play(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.lastAt = this.ctx.currentTime;
    this.node.port.postMessage({ type: 'play' });
    this.playing = true;
    this.onPlayingChange?.(true);
  }

  pause(): void {
    const t = this.currentTime;
    this.node.port.postMessage({ type: 'pause' });
    this.lastFrame = t * SAMPLE_RATE;
    this.playing = false;
    this.onPlayingChange?.(false);
  }

  seek(seconds: number): void {
    const t = Math.max(0, Math.min(seconds, this.duration));
    this.node.port.postMessage({ type: 'seek', frame: Math.round(t * SAMPLE_RATE) });
    this.lastFrame = t * SAMPLE_RATE;
    this.lastAt = this.ctx.currentTime;
  }

  setTempo(tempo: number): void {
    // a posição atual vira a nova âncora para a interpolação não saltar
    this.lastFrame = this.currentTime * SAMPLE_RATE;
    this.lastAt = this.ctx.currentTime;
    this.tempo = tempo;
    this.node.port.postMessage({ type: 'params', tempo });
  }
  setSemitones(semitones: number): void {
    this.node.port.postMessage({ type: 'params', semitones });
  }
  setVocalVolume(v: number): void {
    this.node.port.postMessage({ type: 'params', vocalGain: v });
  }
  setInstrumentalVolume(v: number): void {
    this.node.port.postMessage({ type: 'params', instrumentalGain: v });
  }

  get audioContext(): AudioContext {
    return this.ctx;
  }
  /** Saída do player (para gravação / analisadores). */
  get output(): AudioNode {
    return this.node;
  }

  async dispose(): Promise<void> {
    this.node.port.postMessage({ type: 'pause' });
    this.node.disconnect();
    await this.ctx.close();
  }
}

export async function decode(ctx: AudioContext, url: string, signal?: AbortSignal): Promise<Stem> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Falha ao baixar ${url} (${res.status})`);
  const buf = await ctx.decodeAudioData(await res.arrayBuffer());
  const l = new Float32Array(buf.getChannelData(0));
  const r = buf.numberOfChannels > 1 ? new Float32Array(buf.getChannelData(1)) : l.slice();
  return { l, r };
}
