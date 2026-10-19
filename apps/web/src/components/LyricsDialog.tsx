import { useState } from 'react';
import type { Song } from '../types';
import { Dialog } from './Dialog';

interface Props {
  song: Song;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
}

/** Refaz a letra: vazio = buscar no LRCLIB / transcrever; com texto = alinhar contra o vocal. */
export function LyricsDialog({ song, onClose, onSubmit }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    try {
      await onSubmit(text);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Refazer letra — ${song.title || 'música'}`} onClose={onClose}>
      <div className="form">
        <label>
          Cole a letra correta (texto puro ou LRC) para alinhá-la ao vocal.
          <textarea autoFocus rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Uma linha por verso…\n\nDeixe vazio para buscar no LRCLIB ou transcrever com IA.'} />
        </label>
        {error && <div className="banner error">{error}</div>}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy} onClick={go}>
            {text.trim() ? 'Alinhar esta letra' : 'Buscar / transcrever'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
