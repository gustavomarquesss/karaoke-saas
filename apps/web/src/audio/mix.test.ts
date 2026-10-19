import { describe, expect, it } from 'vitest';
import { encodeWav, mixTake, renderBacking } from './mix';

const SR = 44100;
const stem = (v: number, n = SR) => ({ l: new Float32Array(n).fill(v), r: new Float32Array(n).fill(v) });
const params = { tempo: 1, semitones: 0, vocalGain: 0, instrumentalGain: 1 };

describe('renderBacking', () => {
  it('sem tom/velocidade soma os stems com os ganhos', async () => {
    const out = await renderBacking(stem(0.5), stem(0.25), SR, { ...params, vocalGain: 1 }, SR);
    expect(out.l[100]).toBeCloseTo(0.75);
    const guideOff = await renderBacking(stem(0.5), stem(0.25), SR, params, SR);
    expect(guideOff.l[100]).toBeCloseTo(0.25);
  });

  it('com velocidade 0,5× produz o dobro de áudio útil', async () => {
    const out = await renderBacking(stem(0, 2 * SR), stem(0.3, 2 * SR), SR, { ...params, tempo: 0.5 }, 3 * SR);
    // 2 s de música a 0,5× duram ~4 s; em 3 s ainda há som ao fim
    expect(Math.abs(out.l[Math.floor(2.9 * SR)])).toBeGreaterThan(0.1);
  });
});

describe('mixTake', () => {
  it('desloca a voz pelo offset e aplica o ganho', () => {
    const mic = new Float32Array(1000);
    mic[110] = 0.4; // a voz chegou 10 amostras atrasada (latência): offset 10 a traz de volta
    const out = mixTake(stem(0, 200), mic, 10, 0.5);
    expect(out.l[100]).toBeCloseTo(0.2);
    expect(out.r[100]).toBeCloseTo(0.2);
    expect(out.l[110]).toBe(0);
  });

  it('não estoura o limite', () => {
    const out = mixTake(stem(0.95, 10), new Float32Array(10).fill(0.9), 0, 1);
    expect(Math.max(...out.l)).toBeLessThanOrEqual(1);
  });
});

describe('encodeWav', () => {
  it('gera cabeçalho RIFF e tamanho corretos', async () => {
    const blob = encodeWav(stem(0.5, 10), SR);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(bytes.length).toBe(44 + 10 * 4);
    const v = new DataView(bytes.buffer);
    expect(v.getUint32(24, true)).toBe(SR);
    expect(v.getInt16(44, true)).toBeCloseTo(0.5 * 0x7fff, -1);
  });
});
