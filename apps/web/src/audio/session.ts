import type { Stem } from './engine';

/**
 * Sessão de gravação: vários "trechos" (segmentos) gravados em momentos diferentes da música,
 * com pausa, retomada e saltos. Cada trecho aponta para uma janela do microfone guardada
 * por frame do AudioContext, então dá para refazer o alinhamento, cortar e remixar depois.
 */

export interface Segment {
  id: number;
  /** posição da música (frames do stem) em que o trecho começou a tocar */
  mediaStart: number;
  /** janela no relógio do AudioContext (frames) */
  startFrame: number;
  stopFrame: number;
  /** cortes aplicados ao trecho (frames de saída) */
  trimStart: number;
  trimEnd: number;
  /** volume da voz neste trecho (0..2) */
  gain: number;
  enabled: boolean;
}

/** Microfone guardado em blocos carimbados com o frame do AudioContext. */
export class MicStore {
  private chunks: { frame: number; data: Float32Array }[] = [];

  add(frame: number, data: Float32Array): void {
    this.chunks.push({ frame, data });
  }

  get isEmpty(): boolean {
    return this.chunks.length === 0;
  }

  /** `length` amostras a partir do frame `start`; onde não houve captura vem silêncio. */
  slice(start: number, length: number): Float32Array {
    const out = new Float32Array(Math.max(length, 0));
    const end = start + out.length;
    for (const c of this.chunks) {
      const cEnd = c.frame + c.data.length;
      if (cEnd <= start || c.frame >= end) continue;
      const from = Math.max(start, c.frame);
      const to = Math.min(end, cEnd);
      out.set(c.data.subarray(from - c.frame, to - c.frame), from - start);
    }
    return out;
  }
}

const MIN_SEGMENT_SECONDS = 0.25;

export class RecordingSession {
  segments: Segment[] = [];
  readonly store = new MicStore();
  private active: Segment | null = null;
  private nextId = 1;

  constructor(
    readonly sampleRate: number,
    /** velocidade e tom usados nesta sessão (valem para todos os trechos) */
    readonly tempo: number,
    readonly semitones: number,
  ) {}

  get hasSegments(): boolean {
    return this.segments.length > 0;
  }

  get isRecording(): boolean {
    return this.active !== null;
  }

  /** Começa um trecho. Se já havia um aberto (salto na música), fecha o anterior no mesmo frame. */
  begin(frame: number, mediaStart: number): void {
    if (this.active) this.end(frame);
    this.active = { id: this.nextId++, mediaStart, startFrame: frame, stopFrame: frame, trimStart: 0, trimEnd: 0, gain: 1, enabled: true };
  }

  /** Fecha o trecho aberto; descarta se ficou curto demais. */
  end(frame: number): Segment | null {
    const seg = this.active;
    this.active = null;
    if (!seg) return null;
    seg.stopFrame = Math.max(frame, seg.startFrame);
    if (seg.stopFrame - seg.startFrame < MIN_SEGMENT_SECONDS * this.sampleRate) return null;
    this.segments.push(seg);
    return seg;
  }

  remove(id: number): void {
    this.segments = this.segments.filter((s) => s.id !== id);
  }

  /** Início do trecho na linha do tempo de saída (frames). */
  outStart(seg: Segment): number {
    return Math.round(seg.mediaStart / this.tempo);
  }

  length(seg: Segment): number {
    return seg.stopFrame - seg.startFrame;
  }

  /** Janela [a, b) do trecho na linha do tempo de saída, já com os cortes. */
  window(seg: Segment): [number, number] {
    const a = this.outStart(seg) + seg.trimStart;
    const b = this.outStart(seg) + this.length(seg) - seg.trimEnd;
    return [a, Math.max(a, b)];
  }

  /** Total gravado (s), contando só trechos ativos e sem repetir regiões sobrepostas. */
  recordedSeconds(): number {
    return mergeRegions(this.activeWindows()).reduce((n, [a, b]) => n + (b - a), 0) / this.sampleRate;
  }

  activeWindows(): [number, number][] {
    return this.segments.filter((s) => s.enabled).map((s) => this.window(s));
  }
}

/** Une janelas que se tocam ou sobrepõem (ordenadas). */
export function mergeRegions(windows: [number, number][]): [number, number][] {
  const sorted = windows.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export interface MixOptions {
  /** quanto a voz chega depois da música (latência), em frames */
  latencyFrames: number;
  micGain: number;
  /** "full": música inteira; "segments": só os trechos gravados, em sequência */
  mode: 'full' | 'segments';
}

const MIC_FADE_SECONDS = 0.01;
const JOIN_FADE_SECONDS = 0.1;

/**
 * Monta a faixa de voz (mono, seca) na linha do tempo da música. A voz de cada trecho entra na
 * posição dele; quando dois trechos se sobrepõem (regravação), o MAIS NOVO substitui o antigo,
 * com um fade curto para não estalar. Os efeitos (reverb etc.) são aplicados DEPOIS, sobre esta faixa.
 */
export function buildMicTrack(session: RecordingSession, length: number, latencyFrames: number): Float32Array {
  const mic = new Float32Array(length);
  const fade = Math.max(1, Math.round(MIC_FADE_SECONDS * session.sampleRate));
  for (const seg of session.segments) {
    if (!seg.enabled) continue;
    let [a, b] = session.window(seg);
    a = Math.max(a, 0);
    b = Math.min(b, length);
    if (b <= a) continue;
    const slice = session.store.slice(seg.startFrame + (a - session.outStart(seg)) + latencyFrames, b - a);
    for (let i = a; i < b; i++) {
      const w = Math.min(1, (i - a + 1) / fade, (b - i) / fade);
      mic[i] = mic[i] * (1 - w) + slice[i - a] * seg.gain * w;
    }
  }
  return mic;
}

/** Soma a voz (já com efeitos, estéreo) à música e, no modo "segments", recorta só o que foi gravado. */
export function combine(session: RecordingSession, backing: Stem, voice: Stem, o: Pick<MixOptions, 'micGain' | 'mode'>): Stem {
  const n = backing.l.length;
  const sr = session.sampleRate;
  const full = { l: new Float32Array(n), r: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    full.l[i] = softClip(backing.l[i] + (voice.l[i] ?? 0) * o.micGain);
    full.r[i] = softClip(backing.r[i] + (voice.r[i] ?? 0) * o.micGain);
  }
  if (o.mode === 'full') return full;

  const regions = mergeRegions(session.activeWindows().map(([a, b]) => [Math.max(a, 0), Math.min(b, n)] as [number, number]));
  const total = regions.reduce((s, [a, b]) => s + (b - a), 0);
  const out = { l: new Float32Array(total), r: new Float32Array(total) };
  let pos = 0;
  for (const [a, b] of regions) {
    const len = b - a;
    const f = Math.min(Math.round(JOIN_FADE_SECONDS * sr), Math.floor(len / 2));
    for (let i = 0; i < len; i++) {
      const g = f > 0 ? Math.min(1, (i + 1) / f, (len - i) / f) : 1;
      out.l[pos + i] = full.l[a + i] * g;
      out.r[pos + i] = full.r[a + i] * g;
    }
    pos += len;
  }
  return out;
}

/** Atalho sem efeitos: voz seca (mono) + música. */
export function mixSession(session: RecordingSession, backing: Stem, o: MixOptions): Stem {
  const mic = buildMicTrack(session, backing.l.length, o.latencyFrames);
  return combine(session, backing, { l: mic, r: mic }, o);
}

/** Limitador suave: identidade abaixo de 0,9. */
function softClip(x: number): number {
  const a = Math.abs(x);
  if (a <= 0.9) return x;
  return Math.sign(x) * (0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1));
}
