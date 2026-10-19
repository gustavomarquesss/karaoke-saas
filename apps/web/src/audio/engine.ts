import { SimpleFilter, SoundTouch } from 'soundtouchjs';

/**
 * Motor de áudio do karaokê (sem dependência de Web Audio, roda no AudioWorklet e no Node).
 *
 * Cada stem passa por seu próprio SoundTouch com parâmetros idênticos e é consumido em
 * lockstep, então os dois ficam sempre alinhados; os ganhos entram DEPOIS do
 * processamento, o que torna o volume instantâneo.
 */

export interface Stem {
  l: Float32Array;
  r: Float32Array;
}

export interface EngineParams {
  /** velocidade sem alterar o tom (1 = normal) */
  tempo: number;
  /** transposição em semitons sem alterar a velocidade */
  semitones: number;
  vocalGain: number;
  instrumentalGain: number;
}

class StemSource {
  constructor(private stem: Stem) {}
  get length(): number {
    return this.stem.l.length;
  }
  /** Interface esperada pelo SimpleFilter: escreve estéreo intercalado e devolve nº de frames. */
  extract(target: Float32Array, numFrames: number, position: number): number {
    const { l, r } = this.stem;
    const n = Math.max(0, Math.min(numFrames, l.length - position));
    for (let i = 0; i < n; i++) {
      target[2 * i] = l[position + i];
      target[2 * i + 1] = r[position + i];
    }
    return n;
  }
}

class Channel {
  readonly st = new SoundTouch();
  readonly filter: SimpleFilter;
  readonly source: StemSource;
  gain = 1;
  current = 1;
  buf = new Float32Array(0);

  constructor(stem: Stem) {
    this.source = new StemSource(stem);
    this.filter = new SimpleFilter(this.source, this.st);
  }
}

export class KaraokeEngine {
  private vocals: Channel;
  private instrumental: Channel;
  private params: EngineParams = { tempo: 1, semitones: 0, vocalGain: 1, instrumentalGain: 1 };
  playing = false;
  private media = 0;
  ended = false;

  constructor(vocals: Stem, instrumental: Stem, readonly sampleRate: number) {
    this.vocals = new Channel(vocals);
    this.instrumental = new Channel(instrumental);
    this.setParams(this.params);
  }

  get totalFrames(): number {
    return Math.max(this.vocals.source.length, this.instrumental.source.length);
  }

  setParams(p: Partial<EngineParams>): void {
    this.params = { ...this.params, ...p };
    for (const ch of [this.vocals, this.instrumental]) {
      ch.st.tempo = this.params.tempo;
      ch.st.pitchSemitones = this.params.semitones;
    }
    this.vocals.gain = this.params.vocalGain;
    this.instrumental.gain = this.params.instrumentalGain;
  }

  seek(frame: number): void {
    const f = Math.max(0, Math.min(Math.floor(frame), this.totalFrames));
    for (const ch of [this.vocals, this.instrumental]) ch.filter.sourcePosition = f;
    this.media = f;
    this.ended = false;
  }

  /**
   * Posição (em frames da música original) do que está sendo ouvido agora.
   * Integra os frames de SAÍDA × tempo desde o último seek: não depende dos buffers internos
   * do SoundTouch (cuja latência varia com tom/velocidade) e não acumula erro.
   */
  get positionFrames(): number {
    return this.media;
  }

  /** Gera `n` frames estéreo em outL/outR. */
  render(outL: Float32Array, outR: Float32Array, n: number): void {
    if (!this.playing) {
      outL.fill(0, 0, n);
      outR.fill(0, 0, n);
      return;
    }
    const v = this.pull(this.vocals, n);
    const i = this.pull(this.instrumental, n);
    if (v === 0 && i === 0 && this.vocals.filter.sourcePosition >= this.totalFrames) {
      this.ended = true;
      this.playing = false;
    }
    this.media += Math.max(v, i) * this.params.tempo;
    const vb = this.vocals.buf;
    const ib = this.instrumental.buf;
    // rampa linear até o ganho-alvo dentro do bloco, para não estalar ao mexer no volume
    const v0 = this.vocals.current;
    const i0 = this.instrumental.current;
    const v1 = (this.vocals.current = this.vocals.gain);
    const i1 = (this.instrumental.current = this.instrumental.gain);
    for (let k = 0; k < n; k++) {
      const t = (k + 1) / n;
      const vg = v0 + (v1 - v0) * t;
      const ig = i0 + (i1 - i0) * t;
      outL[k] = vb[2 * k] * vg + ib[2 * k] * ig;
      outR[k] = vb[2 * k + 1] * vg + ib[2 * k + 1] * ig;
    }
  }

  private pull(ch: Channel, n: number): number {
    if (ch.buf.length < n * 2) ch.buf = new Float32Array(n * 2);
    ch.buf.fill(0, 0, n * 2);
    return ch.filter.extract(ch.buf, n);
  }
}

