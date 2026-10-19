import { z } from 'zod';

export const wordSchema = z.object({
  text: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
});

export const lineSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().optional(),
  words: z.array(wordSchema),
});

export const lyricsSchema = z.object({
  language: z.string().nullable().optional(),
  source: z.string().optional(),
  lines: z.array(lineSchema),
});

export type Lyrics = z.infer<typeof lyricsSchema>;

/** Normaliza o que o editor enviou: texto da linha derivado das palavras, tempos coerentes, ordem crescente. */
export function normalizeLyrics(input: Lyrics): Lyrics {
  const lines = input.lines
    .filter((l) => l.words.length > 0)
    .map((l) => {
      const words = l.words.map((w) => ({ text: w.text.trim(), start: w.start, end: Math.max(w.end, w.start) })).filter((w) => w.text);
      return {
        start: words[0]?.start ?? l.start,
        end: words[words.length - 1]?.end ?? l.end,
        text: words.map((w) => w.text).join(' '),
        words,
      };
    })
    .filter((l) => l.words.length > 0)
    .sort((a, b) => a.start - b.start);
  return { ...input, lines };
}
