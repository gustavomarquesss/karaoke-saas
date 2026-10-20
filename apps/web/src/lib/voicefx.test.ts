import { describe, expect, it } from 'vitest';
import { PRESETS, dspParams, isDry, matchPreset, sanitizeFx } from './voicefx';

describe('voicefx', () => {
  it('"natural" é seco e os demais presets têm efeito', () => {
    expect(isDry(PRESETS.natural.fx)).toBe(true);
    for (const [id, p] of Object.entries(PRESETS)) if (id !== 'natural') expect(isDry(p.fx)).toBe(false);
  });

  it('sanitizeFx limita valores e ignora lixo', () => {
    const fx = sanitizeFx({ compress: 5, brightness: -9, reverb: 'x' as never, echo: 0.4, cleanup: 1 as never });
    expect(fx).toEqual({ cleanup: true, compress: 1, brightness: -1, reverb: 0, echo: 0.4 });
    expect(sanitizeFx(null)).toEqual({ cleanup: false, compress: 0, brightness: 0, reverb: 0, echo: 0 });
  });

  it('reconhece o preset pelos parâmetros e cai em "custom" se mexeram', () => {
    expect(matchPreset(PRESETS.stage.fx)).toBe('stage');
    expect(matchPreset({ ...PRESETS.stage.fx, reverb: 0.41 })).toBe('custom');
  });

  it('dspParams: compressão mais forte baixa o limiar, sobe a razão e o ganho de compensação', () => {
    const soft = dspParams({ ...PRESETS.natural.fx, compress: 0.2 });
    const hard = dspParams({ ...PRESETS.natural.fx, compress: 0.9 });
    expect(hard.compThresholdDb).toBeLessThan(soft.compThresholdDb);
    expect(hard.compRatio).toBeGreaterThan(soft.compRatio);
    expect(hard.makeupGain).toBeGreaterThan(soft.makeupGain);
  });

  it('dspParams: brilho negativo escurece (shelf negativo, sem presença extra)', () => {
    const dark = dspParams({ ...PRESETS.natural.fx, brightness: -0.5 });
    expect(dark.highShelfDb).toBeLessThan(0);
    expect(dark.presenceDb).toBe(0);
  });

  it('seco não tem wet de reverb/eco', () => {
    const d = dspParams(PRESETS.natural.fx);
    expect(d.reverbWet).toBe(0);
    expect(d.echoWet).toBe(0);
    expect(d.hpfHz).toBe(10);
  });
});
