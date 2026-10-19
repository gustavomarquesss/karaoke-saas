import { memo } from 'react';
import type { Line } from '../types';

interface Props {
  line: Line;
  index: number;
  state: 'past' | 'current' | 'next' | 'future';
}

/**
 * Uma linha da letra. O preenchimento palavra a palavra é feito pelo Player diretamente no DOM
 * (variável CSS `--p` de cada `.w`), sem re-render do React a cada frame.
 */
export const LyricLine = memo(function LyricLine({ line, index, state }: Props) {
  return (
    <div className={`line ${state}`} data-line={index}>
      {line.words.map((w, i) => (
        <span className="w" key={i} data-w={i}>
          <span className="w-base">{w.text}</span>
          <span className="w-fill" aria-hidden>
            {w.text}
          </span>
        </span>
      ))}
    </div>
  );
});

/** Atualiza o preenchimento das palavras de uma linha para o tempo `t`. */
export function paintLine(el: Element | null, line: Line, t: number): void {
  if (!el) return;
  const nodes = el.children;
  for (let i = 0; i < line.words.length && i < nodes.length; i++) {
    const w = line.words[i];
    const p = t <= w.start ? 0 : t >= w.end ? 1 : (t - w.start) / Math.max(w.end - w.start, 1e-6);
    (nodes[i] as HTMLElement).style.setProperty('--p', p.toFixed(3));
  }
}
