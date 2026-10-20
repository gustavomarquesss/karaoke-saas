import type { Line, Lyrics, Word } from '../types';

/** Tempo da letra a partir do tempo do áudio. offset_ms > 0 atrasa a letra, < 0 adianta. */
export const lyricTime = (audioTime: number, offsetMs: number): number => audioTime - offsetMs / 1000;

/** Quanto da palavra já foi cantada (0..1). */
export function wordProgress(word: Word, t: number): number {
  if (t <= word.start) return 0;
  if (t >= word.end) return 1;
  return (t - word.start) / Math.max(word.end - word.start, 1e-6);
}

export interface DisplayState {
  /** linha em destaque (a ativa ou, no intervalo, a próxima a cantar) */
  current: number;
  /** linha seguinte à atual */
  next: number;
  /** a linha atual está sendo cantada neste instante */
  active: boolean;
  /** segundos até a linha atual começar, quando há tempo de espera para contar (senão null) */
  countdown: number | null;
}

const GRACE = 0.35; // a linha continua "ativa" um instante depois da última palavra
const COUNTDOWN_FROM = 3.2;
const COUNTDOWN_MIN_GAP = 2.5; // só conta se o intervalo desde a linha anterior for grande

export function displayState(lines: Line[], t: number): DisplayState {
  const n = lines.length;
  if (n === 0) return { current: -1, next: -1, active: false, countdown: null };

  // última linha cujo início já passou
  let idx = -1;
  for (let i = 0; i < n; i++) {
    if (lines[i].start <= t) idx = i;
    else break;
  }

  if (idx >= 0 && t <= lines[idx].end + GRACE) {
    return { current: idx, next: idx + 1 < n ? idx + 1 : -1, active: true, countdown: null };
  }

  const upcoming = idx + 1 < n ? idx + 1 : -1;
  if (upcoming === -1) {
    // música acabou de ser cantada: mantém a última linha na tela
    return { current: idx, next: -1, active: false, countdown: null };
  }
  const until = lines[upcoming].start - t;
  const prevEnd = idx >= 0 ? lines[idx].end : -Infinity;
  const gap = lines[upcoming].start - prevEnd;
  const countdown = until <= COUNTDOWN_FROM && gap >= COUNTDOWN_MIN_GAP ? until : null;
  return { current: upcoming, next: upcoming + 1 < n ? upcoming + 1 : -1, active: false, countdown };
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Texto de uma linha a partir das palavras. */
export const lineText = (line: Line): string => line.words.map((w) => w.text).join(' ');

/** Redistribui as palavras proporcionalmente aos caracteres dentro de [start, end]. */
export function spreadWords(texts: string[], start: number, end: number): Word[] {
  const weights = texts.map((t) => Math.max(t.length, 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = start;
  return texts.map((text, i) => {
    const span = ((end - start) * weights[i]) / total;
    const w = { text, start: round3(cursor), end: round3(cursor + span) };
    cursor += span;
    return w;
  });
}

/** Troca o texto de uma linha: mantém os tempos se o nº de palavras não mudou; senão redistribui. */
export function retypeLine(line: Line, text: string): Line {
  const texts = text.split(/\s+/).filter(Boolean);
  if (texts.length === 0) return { ...line, words: [] };
  if (texts.length === line.words.length) {
    return { ...line, text: texts.join(' '), words: line.words.map((w, i) => ({ ...w, text: texts[i] })) };
  }
  const words = spreadWords(texts, line.start, Math.max(line.end, line.start + 0.2 * texts.length));
  return { ...line, text: texts.join(' '), words, end: words[words.length - 1].end };
}

/** Recalcula start/end da linha a partir das palavras. */
export function fitLine(line: Line): Line {
  if (line.words.length === 0) return line;
  return { ...line, start: line.words[0].start, end: line.words[line.words.length - 1].end, text: lineText(line) };
}

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Valida a ordem/consistência temporal e devolve problemas legíveis (para o editor). */
export function validateLyrics(lyrics: Lyrics): string[] {
  const problems: string[] = [];
  let last = 0;
  lyrics.lines.forEach((line, li) => {
    line.words.forEach((w, wi) => {
      if (w.end < w.start) problems.push(`Linha ${li + 1}, palavra ${wi + 1}: fim antes do início`);
      if (w.start < last - 0.001) problems.push(`Linha ${li + 1}, palavra ${wi + 1}: começa antes da anterior`);
      last = Math.max(last, w.end);
    });
  });
  return problems;
}

/**
 * Para onde pular ao ir para a linha anterior/próxima. Cai um pouco ANTES da linha (`lead`) para
 * dar tempo de se preparar. "Anterior" no meio de uma linha volta ao começo dela.
 */
export function lineJumpTarget(lines: Line[], t: number, dir: 1 | -1, lead = 0.8): number | null {
  const landing = lines.map((l) => Math.max(0, l.start - lead));
  if (dir === 1) {
    const next = landing.find((s) => s > t + 0.25);
    return next ?? null;
  }
  for (let i = landing.length - 1; i >= 0; i--) if (landing[i] < t - 1.5) return landing[i];
  return null;
}
