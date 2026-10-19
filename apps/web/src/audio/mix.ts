import { KaraokeEngine, type EngineParams, type Stem } from './engine';

/** Renderiza o acompanhamento (stems + tom/velocidade/volumes) offline, na mesma engine do player. */
export async function renderBacking(
  vocals: Stem,
  instrumental: Stem,
  sampleRate: number,
  params: EngineParams,
  frames: number,
  onProgress?: (fraction: number) => void,
): Promise<Stem> {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);

  // caminho rápido (e exato): sem tom/velocidade basta somar os stems com os ganhos
  if (params.semitones === 0 && Math.abs(params.tempo - 1) < 1e-6) {
    const n = Math.min(frames, Math.max(vocals.l.length, instrumental.l.length));
    for (let i = 0; i < n; i++) {
      l[i] = (vocals.l[i] ?? 0) * params.vocalGain + (instrumental.l[i] ?? 0) * params.instrumentalGain;
      r[i] = (vocals.r[i] ?? 0) * params.vocalGain + (instrumental.r[i] ?? 0) * params.instrumentalGain;
    }
    return { l, r };
  }

  const engine = new KaraokeEngine(vocals, instrumental, sampleRate);
  engine.setParams(params);
  engine.playing = true;
  const block = 4096;
  const bl = new Float32Array(block);
  const br = new Float32Array(block);
  for (let pos = 0; pos < frames && !engine.ended; pos += block) {
    const n = Math.min(block, frames - pos);
    engine.render(bl, br, n);
    l.set(bl.subarray(0, n), pos);
    r.set(br.subarray(0, n), pos);
    if ((pos / block) % 32 === 0) {
      onProgress?.(pos / frames);
      await new Promise((res) => setTimeout(res, 0)); // devolve o controle para a UI
    }
  }
  onProgress?.(1);
  return { l, r };
}

/**
 * Soma a voz gravada (mono) ao acompanhamento. `offsetSamples` é quantas amostras do início do
 * microfone devem ser puladas para a voz casar com a música (compensa a latência de entrada/saída).
 */
export function mixTake(backing: Stem, mic: Float32Array, offsetSamples: number, micGain: number): Stem {
  const n = backing.l.length;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m = (mic[i + offsetSamples] ?? 0) * micGain;
    l[i] = softClip(backing.l[i] + m);
    r[i] = softClip(backing.r[i] + m);
  }
  return { l, r };
}

/** Limitador suave para a soma não estourar (identidade abaixo de 0,9). */
function softClip(x: number): number {
  const a = Math.abs(x);
  if (a <= 0.9) return x;
  return Math.sign(x) * (0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1));
}

/** WAV PCM 16-bit estéreo. */
export function encodeWav(stem: Stem, sampleRate: number): Blob {
  const n = stem.l.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const ch of [stem.l, stem.r]) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
