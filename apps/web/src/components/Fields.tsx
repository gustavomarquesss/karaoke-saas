import { useEffect, useState } from 'react';

interface TimeFieldProps {
  value: number;
  onCommit: (v: number) => void;
  label: string;
  className?: string;
}

/** Campo de segundos que só confirma ao sair do campo ou apertar Enter. */
export function TimeField({ value, onCommit, label, className }: TimeFieldProps) {
  const [draft, setDraft] = useState(value.toFixed(2));
  useEffect(() => setDraft(value.toFixed(2)), [value]);

  const commit = () => {
    const v = parseTime(draft);
    if (v === null) setDraft(value.toFixed(2));
    else if (Math.abs(v - value) > 0.0005) onCommit(v);
  };

  return (
    <input
      className={`time-field ${className ?? ''}`}
      inputMode="decimal"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(value.toFixed(2));
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const step = e.shiftKey ? 0.5 : 0.05;
          onCommit(Math.max(0, value + (e.key === 'ArrowUp' ? step : -step)));
        }
      }}
    />
  );
}

interface TextFieldProps {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  className?: string;
}

export function TextField({ value, onCommit, label, className }: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={className}
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

/** Aceita "12.5", "12,5" ou "1:02.5". */
export function parseTime(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const m = t.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  const v = m ? Number(m[1]) * 60 + Number(m[2]) : Number(t);
  return Number.isFinite(v) && v >= 0 ? v : null;
}
