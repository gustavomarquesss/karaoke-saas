import { describe, expect, it } from 'vitest';
import type { Line } from '../types';
import { deleteLine, insertLineAfter, mergeWithNext, moveLineTo, nextWordPos, setLineText, setWordTimes, shiftLine, splitLine, tapWord } from './edit';

const mk = (start: number, ...texts: string[]): Line => {
  const words = texts.map((text, i) => ({ text, start: start + i, end: start + i + 0.8 }));
  return { start, end: words[words.length - 1].end, text: texts.join(' '), words };
};
const base = [mk(10, 'a', 'b', 'c'), mk(20, 'd', 'e')];

describe('edit', () => {
  it('setWordTimes recalcula início/fim da linha e não deixa o fim passar antes do início', () => {
    const out = setWordTimes(base, 0, 0, { start: 9, end: 8 });
    expect(out[0].start).toBe(9);
    expect(out[0].words[0].end).toBe(9);
    expect(base[0].words[0].start).toBe(10); // imutável
  });

  it('shiftLine não deixa a linha ir abaixo de zero', () => {
    const out = shiftLine(base, 0, -50);
    expect(out[0].start).toBe(0);
    expect(out[0].words[1].start).toBe(1);
  });

  it('moveLineTo preserva os intervalos entre as palavras', () => {
    const out = moveLineTo(base, 1, 25);
    expect(out[1].words.map((w) => w.start)).toEqual([25, 26]);
  });

  it('setLineText com texto vazio remove a linha', () => {
    expect(setLineText(base, 0, '   ')).toHaveLength(1);
  });

  it('splitLine e mergeWithNext são inversos nos tempos', () => {
    const split = splitLine(base, 0, 1);
    expect(split.map((l) => l.text)).toEqual(['a', 'b c', 'd e']);
    const merged = mergeWithNext(split, 0);
    expect(merged[0].words.map((w) => w.text)).toEqual(['a', 'b', 'c']);
    expect(merged[0].end).toBe(base[0].end);
  });

  it('insertLineAfter encaixa a nova linha entre as vizinhas', () => {
    const out = insertLineAfter(base, 0);
    expect(out).toHaveLength(3);
    expect(out[1].start).toBeGreaterThan(base[0].end);
    expect(out[1].end).toBeLessThanOrEqual(base[1].start);
  });

  it('deleteLine', () => {
    expect(deleteLine(base, 0)[0].text).toBe('d e');
  });

  it('tapWord marca início e fecha a palavra anterior quando em sequência', () => {
    const out = tapWord(base, 0, 1, 11.5);
    expect(out[0].words[1].start).toBe(11.5);
    expect(out[0].words[0].end).toBe(11.5);
  });

  it('tapWord atravessa para a linha seguinte e para no fim', () => {
    expect(nextWordPos(base, 0, 2)).toEqual({ li: 1, wi: 0 });
    expect(nextWordPos(base, 1, 1)).toBeNull();
  });
});
