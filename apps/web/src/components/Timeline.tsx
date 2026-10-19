import { useRef } from 'react';
import type { Line } from '../types';

export type DragPhase = 'start' | 'move' | 'end';

interface Props {
  lines: Line[];
  selected: number;
  time: number;
  windowSec: number;
  onSeek: (t: number) => void;
  onSelect: (li: number) => void;
  onDrag: (li: number, wi: number, patch: { start?: number; end?: number }, phase: DragPhase) => void;
}

type Drag = { li: number; wi: number; mode: 'move' | 'left' | 'right'; x0: number; start: number; end: number };

/** Linha do tempo simples: palavras como blocos que dá para mover e redimensionar. */
export function Timeline({ lines, selected, time, windowSec, onSeek, onSelect, onDrag }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const viewStart = Math.max(0, time - windowSec * 0.3);
  const viewEnd = viewStart + windowSec;
  const pct = (t: number) => ((t - viewStart) / windowSec) * 100;

  const blocks: React.ReactNode[] = [];
  lines.forEach((line, li) => {
    if (line.end < viewStart || line.start > viewEnd) return;
    line.words.forEach((w, wi) => {
      if (w.end < viewStart || w.start > viewEnd) return;
      blocks.push(
        <div
          key={`${li}-${wi}`}
          className={`tl-word ${li === selected ? 'sel' : ''} ${wi % 2 ? 'odd' : ''}`}
          style={{ left: `${pct(w.start)}%`, width: `${Math.max(pct(w.end) - pct(w.start), 0.4)}%` }}
          title={`${w.text}  ${w.start.toFixed(2)}–${w.end.toFixed(2)} s`}
          onPointerDown={(e) => {
            e.stopPropagation();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const x = e.clientX - rect.left;
            const mode = x < 6 ? 'left' : x > rect.width - 6 ? 'right' : 'move';
            drag.current = { li, wi, mode, x0: e.clientX, start: w.start, end: w.end };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            onSelect(li);
            onDrag(li, wi, {}, 'start');
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || !box.current) return;
            const dt = ((e.clientX - d.x0) / box.current.clientWidth) * windowSec;
            const patch = d.mode === 'move' ? { start: d.start + dt, end: d.end + dt } : d.mode === 'left' ? { start: Math.min(d.start + dt, d.end) } : { end: Math.max(d.end + dt, d.start) };
            onDrag(d.li, d.wi, patch, 'move');
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (d) onDrag(d.li, d.wi, {}, 'end');
          }}
        >
          <span className="tl-handle left" />
          <span className="tl-label">{w.text}</span>
          <span className="tl-handle right" />
        </div>,
      );
    });
  });

  return (
    <div
      className="timeline"
      ref={box}
      onPointerDown={(e) => {
        if (!box.current) return;
        const rect = box.current.getBoundingClientRect();
        onSeek(viewStart + ((e.clientX - rect.left) / rect.width) * windowSec);
      }}
    >
      {blocks}
      <div className="tl-playhead" style={{ left: `${pct(time)}%` }} />
    </div>
  );
}
