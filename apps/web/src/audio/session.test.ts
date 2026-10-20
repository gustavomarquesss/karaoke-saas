import { describe, expect, it } from 'vitest';
import { MicStore, RecordingSession, mergeRegions, mixSession } from './session';

const SR = 1000; // taxa pequena deixa os números legíveis

const silence = (n: number) => ({ l: new Float32Array(n), r: new Float32Array(n) });

/** Sessão com um trecho de `len` frames começando na música em `media`, mic constante `v` já capturado. */
function sessionWith(segs: { media: number; start: number; len: number; v: number }[], tempo = 1) {
  const s = new RecordingSession(SR, tempo, 0);
  for (const g of segs) {
    s.store.add(g.start, new Float32Array(g.len).fill(g.v));
    s.begin(g.start, g.media);
    s.end(g.start + g.len);
  }
  return s;
}

describe('MicStore', () => {
  it('fatia atravessando blocos e preenche vazios com silêncio', () => {
    const m = new MicStore();
    m.add(100, new Float32Array([1, 2, 3, 4]));
    m.add(104, new Float32Array([5, 6]));
    m.add(200, new Float32Array([9]));
    expect([...m.slice(102, 6)]).toEqual([3, 4, 5, 6, 0, 0]);
    expect([...m.slice(98, 4)]).toEqual([0, 0, 1, 2]);
    expect([...m.slice(199, 3)]).toEqual([0, 9, 0]);
  });
});

describe('RecordingSession', () => {
  it('pausa/retomada gera trechos separados e descarta os muito curtos', () => {
    const s = new RecordingSession(SR, 1, 0);
    s.begin(0, 0);
    expect(s.end(1000)?.id).toBe(1);
    s.begin(5000, 30_000);
    expect(s.end(5100)).toBeNull(); // 0,1 s: curto demais
    expect(s.segments).toHaveLength(1);
  });

  it('um salto durante a gravação fecha o trecho anterior no mesmo frame', () => {
    const s = new RecordingSession(SR, 1, 0);
    s.begin(0, 0);
    s.begin(2000, 60_000); // pulou na música
    s.end(4000);
    expect(s.segments.map((g) => [g.startFrame, g.stopFrame, g.mediaStart])).toEqual([
      [0, 2000, 0],
      [2000, 4000, 60_000],
    ]);
  });

  it('com velocidade 0,5× a posição de saída é o dobro da posição na música', () => {
    const s = sessionWith([{ media: 1000, start: 0, len: 500, v: 1 }], 0.5);
    expect(s.outStart(s.segments[0])).toBe(2000);
  });

  it('recordedSeconds não conta sobreposição duas vezes e ignora trechos desligados', () => {
    const s = sessionWith([
      { media: 0, start: 0, len: 2000, v: 1 },
      { media: 1000, start: 5000, len: 2000, v: 1 }, // sobrepõe 1000 frames
    ]);
    expect(s.recordedSeconds()).toBeCloseTo(3);
    s.segments[1].enabled = false;
    expect(s.recordedSeconds()).toBeCloseTo(2);
  });

  it('mergeRegions une janelas coladas', () => {
    expect(mergeRegions([[10, 20], [20, 30], [50, 60], [0, 5]])).toEqual([[0, 5], [10, 30], [50, 60]]);
  });
});

describe('mixSession', () => {
  const backing = () => {
    const b = silence(10_000);
    b.l.fill(0.1);
    b.r.fill(0.1);
    return b;
  };

  it('coloca a voz na posição do trecho na música e aplica ganho do mic', () => {
    const s = sessionWith([{ media: 3000, start: 777, len: 2000, v: 0.4 }]);
    const out = mixSession(s, backing(), { latencyFrames: 0, micGain: 0.5, mode: 'full' });
    expect(out.l[2999]).toBeCloseTo(0.1);
    expect(out.l[4000]).toBeCloseTo(0.1 + 0.2);
    expect(out.l[5001]).toBeCloseTo(0.1);
  });

  it('o trecho mais novo substitui o antigo na sobreposição', () => {
    const s = sessionWith([
      { media: 1000, start: 0, len: 4000, v: 0.2 },
      { media: 2000, start: 10_000, len: 1000, v: 0.6 },
    ]);
    const out = mixSession(s, silence(10_000), { latencyFrames: 0, micGain: 1, mode: 'full' });
    expect(out.l[1500]).toBeCloseTo(0.2);
    expect(out.l[2500]).toBeCloseTo(0.6); // regravado
    expect(out.l[3500]).toBeCloseTo(0.2); // volta ao original
  });

  it('latência pula amostras do início do mic', () => {
    const s = new RecordingSession(SR, 1, 0);
    const mic = new Float32Array(2000);
    mic[300] = 0.5; // a voz "bateu" no frame 300 mas era para ser no 200
    s.store.add(0, mic);
    s.begin(0, 0);
    s.end(2000);
    const out = mixSession(s, silence(2000), { latencyFrames: 100, micGain: 1, mode: 'full' });
    expect(out.l[200]).toBeCloseTo(0.5);
    expect(out.l[300]).toBeCloseTo(0);
  });

  it('cortes, trecho desligado e ganho por trecho', () => {
    const s = sessionWith([
      { media: 0, start: 0, len: 4000, v: 0.3 },
      { media: 6000, start: 4000, len: 2000, v: 0.3 },
    ]);
    s.segments[0].trimStart = 1000;
    s.segments[0].gain = 2;
    s.segments[1].enabled = false;
    const out = mixSession(s, silence(10_000), { latencyFrames: 0, micGain: 1, mode: 'full' });
    expect(out.l[500]).toBeCloseTo(0); // cortado
    expect(out.l[2000]).toBeCloseTo(0.6); // ganho 2
    expect(out.l[7000]).toBeCloseTo(0); // desligado
  });

  it('modo "só os trechos" concatena as regiões gravadas', () => {
    const s = sessionWith([
      { media: 1000, start: 0, len: 1000, v: 0.3 },
      { media: 5000, start: 1000, len: 2000, v: 0.3 },
    ]);
    const out = mixSession(s, backing(), { latencyFrames: 0, micGain: 1, mode: 'segments' });
    expect(out.l.length).toBe(3000);
    expect(out.l[500]).toBeCloseTo(0.4); // meio do 1º trecho (fora dos fades)
    expect(out.l[2000]).toBeCloseTo(0.4);
    expect(out.l[0]).toBeLessThan(0.05); // fade-in
  });

  it('nunca ultrapassa o limite de amplitude', () => {
    const s = sessionWith([{ media: 0, start: 0, len: 1000, v: 0.95 }]);
    const b = backing();
    b.l.fill(0.95);
    const out = mixSession(s, b, { latencyFrames: 0, micGain: 1, mode: 'full' });
    expect(Math.max(...out.l)).toBeLessThanOrEqual(1);
  });
});
