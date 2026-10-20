import { describe, expect, it } from 'vitest';
import type { Line } from '../types';
import { displayState, formatTime, lineJumpTarget, lyricTime, retypeLine, validateLyrics, wordProgress } from './lyrics';

const line = (start: number, end: number, ...texts: string[]): Line => {
  const step = (end - start) / texts.length;
  return { start, end, words: texts.map((text, i) => ({ text, start: start + i * step, end: start + (i + 1) * step })) };
};

const lines = [line(10, 14, 'a', 'b'), line(14.5, 18, 'c', 'd'), line(30, 34, 'e', 'f')];

describe('lyricTime', () => {
  it('offset positivo atrasa a letra, negativo adianta', () => {
    expect(lyricTime(10, 500)).toBe(9.5);
    expect(lyricTime(10, -250)).toBe(10.25);
  });
});

describe('wordProgress', () => {
  const w = { text: 'x', start: 2, end: 4 };
  it('0 antes, 1 depois, proporcional no meio', () => {
    expect(wordProgress(w, 1)).toBe(0);
    expect(wordProgress(w, 3)).toBe(0.5);
    expect(wordProgress(w, 5)).toBe(1);
  });
  it('palavra de duração zero não gera NaN', () => {
    expect(wordProgress({ text: 'x', start: 2, end: 2 }, 2.1)).toBe(1);
  });
});

describe('displayState', () => {
  it('antes da primeira linha mostra a primeira, sem contagem se estiver longe', () => {
    const s = displayState(lines, 2);
    expect(s).toMatchObject({ current: 0, next: 1, active: false, countdown: null });
  });
  it('contagem regressiva nos últimos segundos antes da linha', () => {
    const s = displayState(lines, 8);
    expect(s.countdown).toBeCloseTo(2);
  });
  it('linha ativa enquanto canta e uma folga depois', () => {
    expect(displayState(lines, 12)).toMatchObject({ current: 0, active: true, next: 1 });
    expect(displayState(lines, 14.2)).toMatchObject({ current: 0, active: true });
  });
  it('intervalo curto entre linhas não dispara contagem', () => {
    const s = displayState(lines, 14.4);
    expect(s.current).toBe(1);
    expect(s.countdown).toBeNull();
  });
  it('intervalo longo mostra a próxima linha e contagem', () => {
    const s = displayState(lines, 28);
    expect(s).toMatchObject({ current: 2, active: false });
    expect(s.countdown).toBeCloseTo(2);
  });
  it('após a última linha mantém a última na tela', () => {
    expect(displayState(lines, 100)).toMatchObject({ current: 2, next: -1, active: false });
  });
  it('sem letra', () => {
    expect(displayState([], 5).current).toBe(-1);
  });
});

describe('retypeLine', () => {
  it('mesmo número de palavras preserva tempos', () => {
    const l = retypeLine(line(0, 2, 'oi', 'mundo'), 'olá terra');
    expect(l.words.map((w) => w.text)).toEqual(['olá', 'terra']);
    expect(l.words[1].start).toBe(1);
  });
  it('número diferente redistribui dentro da linha', () => {
    const l = retypeLine(line(0, 3, 'a', 'b', 'c'), 'um dois');
    expect(l.words).toHaveLength(2);
    expect(l.words[0].start).toBe(0);
    expect(l.words[1].end).toBeCloseTo(3, 2);
  });
});

describe('validateLyrics / formatTime', () => {
  it('detecta palavra fora de ordem', () => {
    expect(validateLyrics({ lines: [line(5, 6, 'a'), line(1, 2, 'b')] })).toHaveLength(1);
    expect(validateLyrics({ lines })).toHaveLength(0);
  });
  it('formata mm:ss', () => {
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(NaN)).toBe('0:00');
  });
});

describe('lineJumpTarget', () => {
  const ls = [line(10, 14, 'a', 'b'), line(14.5, 18, 'c', 'd'), line(30, 34, 'e', 'f')];
  it('próxima linha cai antes do início dela', () => {
    expect(lineJumpTarget(ls, 0, 1)).toBeCloseTo(9.2);
    expect(lineJumpTarget(ls, 9.2, 1)).toBeCloseTo(13.7); // já está na 1ª: vai para a 2ª
    expect(lineJumpTarget(ls, 20, 1)).toBeCloseTo(29.2);
    expect(lineJumpTarget(ls, 31, 1)).toBeNull();
  });
  it('anterior volta ao começo da linha atual se está no meio dela, senão à linha de trás', () => {
    expect(lineJumpTarget(ls, 12.5, -1)).toBeCloseTo(9.2);
    expect(lineJumpTarget(ls, 9.3, -1)).toBeNull(); // no começo da primeira não há anterior
    expect(lineJumpTarget(ls, 13.8, -1)).toBeCloseTo(9.2);
    expect(lineJumpTarget(ls, 29.3, -1)).toBeCloseTo(13.7);
  });
  it('sem letra não pula', () => {
    expect(lineJumpTarget([], 5, 1)).toBeNull();
  });
});
