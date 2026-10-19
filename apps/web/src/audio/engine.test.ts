import { describe, expect, it } from 'vitest';
import { KaraokeEngine, type Stem } from './engine';

const SR = 44100;

/** Silêncio com um burst senoidal de 1 kHz (20 ms) começando em `atSeconds`. */
function burstStem(seconds: number, atSeconds: number): Stem {
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  const start = Math.round(atSeconds * SR);
  for (let i = 0; i < 0.02 * SR; i++) l[start + i] = Math.sin((2 * Math.PI * 1000 * i) / SR) * Math.sin((Math.PI * i) / (0.02 * SR));
  return { l, r: l.slice() };
}

const silence = (seconds: number): Stem => ({ l: new Float32Array(Math.round(seconds * SR)), r: new Float32Array(Math.round(seconds * SR)) });

/** Toca tudo e devolve onde (em s, na música) o burst foi OUVIDO segundo positionFrames. */
function measure(tempo: number, semitones: number): { heardAt: number; expected: number } {
  const burstAt = 4;
  const engine = new KaraokeEngine(burstStem(10, burstAt), silence(10), SR);
  engine.setParams({ tempo, semitones, vocalGain: 1, instrumentalGain: 0 });
  engine.playing = true;
  const block = 128;
  const L = new Float32Array(block);
  const R = new Float32Array(block);
  let peak = 0;
  let heardAt = -1;
  for (let b = 0; b < 4000 && !engine.ended; b++) {
    engine.render(L, R, block);
    // posição estimada no fim deste bloco, voltando metade do bloco até a amostra do pico
    const pos = engine.positionFrames;
    for (let k = 0; k < block; k++) {
      const a = Math.abs(L[k]);
      if (a > peak) {
        peak = a;
        heardAt = (pos - (block - k) * tempo) / SR;
      }
    }
  }
  return { heardAt, expected: burstAt + 0.01 };
}

describe('KaraokeEngine', () => {
  it('toca o stem inteiro e sinaliza o fim', () => {
    const engine = new KaraokeEngine(silence(1), silence(1), SR);
    engine.playing = true;
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    for (let i = 0; i < 2000 && !engine.ended; i++) engine.render(L, R, 128);
    expect(engine.ended).toBe(true);
  });

  it('seek reposiciona a leitura', () => {
    const engine = new KaraokeEngine(burstStem(10, 4), silence(10), SR);
    engine.setParams({ instrumentalGain: 0 });
    engine.seek(3.9 * SR);
    engine.playing = true;
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      engine.render(L, R, 128);
      peak = Math.max(peak, ...L.map(Math.abs));
    }
    expect(peak).toBeGreaterThan(0.1);
  });

  it('mixa vocal e instrumental com ganhos independentes', () => {
    const one = (v: number): Stem => ({ l: new Float32Array(SR).fill(v), r: new Float32Array(SR).fill(v) });
    const engine = new KaraokeEngine(one(0.5), one(0.25), SR);
    engine.setParams({ vocalGain: 0, instrumentalGain: 1 });
    engine.playing = true;
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    for (let i = 0; i < 20; i++) engine.render(L, R, 128); // deixa a rampa e o buffer do SoundTouch assentarem
    expect(L[100]).toBeCloseTo(0.25, 1);
  });

  it('posição estimada acompanha o áudio ouvido (calibração)', () => {
    for (const [tempo, semitones] of [[1, 0], [1, 3], [0.8, 0], [1.2, -4], [0.7, 2]] as const) {
      const { heardAt, expected } = measure(tempo, semitones);
      // eslint-disable-next-line no-console
      console.log(`tempo=${tempo} st=${semitones}: ouvido em ${heardAt.toFixed(3)}s, real ${expected.toFixed(3)}s, erro ${((heardAt - expected) * 1000).toFixed(0)}ms`);
      expect(Math.abs(heardAt - expected)).toBeLessThan(0.06);
    }
  });
});
