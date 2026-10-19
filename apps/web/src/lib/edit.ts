import type { Line, Word } from '../types';
import { fitLine, retypeLine, round3, spreadWords } from './lyrics';

/** Operações puras sobre a letra, usadas pelo editor (todas devolvem novas listas). */

export function setLineText(lines: Line[], li: number, text: string): Line[] {
  const updated = retypeLine(lines[li], text);
  if (updated.words.length === 0) return lines.filter((_, i) => i !== li);
  return replaceAt(lines, li, fitLine(updated));
}

export function setWordTimes(lines: Line[], li: number, wi: number, patch: Partial<Pick<Word, 'start' | 'end'>>): Line[] {
  const line = lines[li];
  const words = line.words.map((w, i) => {
    if (i !== wi) return w;
    const start = round3(Math.max(0, patch.start ?? w.start));
    const end = round3(Math.max(start, patch.end ?? w.end));
    return { ...w, start, end };
  });
  return replaceAt(lines, li, fitLine({ ...line, words }));
}

export function setWordText(lines: Line[], li: number, wi: number, text: string): Line[] {
  const clean = text.trim();
  if (!clean) return lines;
  const words = lines[li].words.map((w, i) => (i === wi ? { ...w, text: clean } : w));
  return replaceAt(lines, li, fitLine({ ...lines[li], words }));
}

/** Desloca a linha inteira (todas as palavras) por `delta` segundos. */
export function shiftLine(lines: Line[], li: number, delta: number): Line[] {
  const first = lines[li].words[0]?.start ?? 0;
  const d = Math.max(delta, -first);
  const words = lines[li].words.map((w) => ({ ...w, start: round3(w.start + d), end: round3(w.end + d) }));
  return replaceAt(lines, li, fitLine({ ...lines[li], words }));
}

/** Define o início da linha mantendo a duração relativa das palavras. */
export function moveLineTo(lines: Line[], li: number, start: number): Line[] {
  return shiftLine(lines, li, start - lines[li].words[0].start);
}

export function deleteLine(lines: Line[], li: number): Line[] {
  return lines.filter((_, i) => i !== li);
}

export function insertLineAfter(lines: Line[], li: number, text = 'Nova linha'): Line[] {
  const prevEnd = li >= 0 ? lines[li].end : 0;
  const nextStart = li + 1 < lines.length ? lines[li + 1].start : Infinity;
  const start = round3(prevEnd + 0.1);
  const end = round3(Math.min(start + 2.5, Math.max(nextStart - 0.05, start + 0.4)));
  const texts = text.split(/\s+/).filter(Boolean);
  const words = spreadWords(texts, start, end);
  const line: Line = { start, end, text: texts.join(' '), words };
  return [...lines.slice(0, li + 1), line, ...lines.slice(li + 1)];
}

/** Divide a linha antes da palavra `wi` (wi >= 1). */
export function splitLine(lines: Line[], li: number, wi: number): Line[] {
  const line = lines[li];
  if (wi <= 0 || wi >= line.words.length) return lines;
  const a = fitLine({ ...line, words: line.words.slice(0, wi) });
  const b = fitLine({ ...line, words: line.words.slice(wi) });
  return [...lines.slice(0, li), a, b, ...lines.slice(li + 1)];
}

export function mergeWithNext(lines: Line[], li: number): Line[] {
  if (li + 1 >= lines.length) return lines;
  const merged = fitLine({ ...lines[li], words: [...lines[li].words, ...lines[li + 1].words] });
  return [...lines.slice(0, li), merged, ...lines.slice(li + 2)];
}

/**
 * Modo toque: marca o início da palavra (li, wi) em `t`. A palavra anterior termina em `t`
 * quando o vão for curto (cantado em sequência); o fim da atual vira t + duração padrão.
 */
export function tapWord(lines: Line[], li: number, wi: number, t: number, defaultDuration = 0.35): Line[] {
  let out = setWordTimes(lines, li, wi, { start: t, end: t + defaultDuration });
  const prev = wi > 0 ? { li, wi: wi - 1 } : li > 0 ? { li: li - 1, wi: lines[li - 1].words.length - 1 } : null;
  if (prev) {
    const pw = out[prev.li].words[prev.wi];
    if (t - pw.start < 2.5 && t >= pw.start) out = setWordTimes(out, prev.li, prev.wi, { end: t });
  }
  return out;
}

/** Posição seguinte do modo toque. */
export function nextWordPos(lines: Line[], li: number, wi: number): { li: number; wi: number } | null {
  if (wi + 1 < lines[li].words.length) return { li, wi: wi + 1 };
  if (li + 1 < lines.length) return { li: li + 1, wi: 0 };
  return null;
}

function replaceAt(lines: Line[], i: number, line: Line): Line[] {
  const out = lines.slice();
  out[i] = line;
  return out;
}
