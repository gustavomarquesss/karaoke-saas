import { useQueue } from '../hooks/useQueue';
import { hrefs } from '../hooks/useRoute';
import type { Song } from '../types';
import { Dialog } from './Dialog';

/** Fila de músicas: toca uma depois da outra (o player avança sozinho ao terminar). */
export function QueuePanel({ songs, onClose }: { songs: Song[]; onClose: () => void }) {
  const { queue, remove, move, clear } = useQueue();
  const byId = new Map(songs.map((s) => [s.id, s]));
  const items = queue.map((id) => byId.get(id)).filter((s): s is Song => !!s);

  return (
    <Dialog title="Fila de músicas" onClose={onClose}>
      {items.length === 0 ? (
        <p className="muted">
          A fila está vazia. No menu <strong>⋯</strong> de cada música use <em>Adicionar à fila</em>.
        </p>
      ) : (
        <>
          <ol className="queue-list">
            {items.map((s, i) => (
              <li key={s.id}>
                <span className="idx">{i + 1}</span>
                <a className="queue-title" href={hrefs.play(s.id, true)} onClick={onClose}>
                  <strong>{s.title || 'Sem título'}</strong>
                  <span className="muted">{s.artist}</span>
                </a>
                <button className="mini" aria-label="Subir" onClick={() => move(s.id, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button className="mini" aria-label="Descer" onClick={() => move(s.id, 1)} disabled={i === items.length - 1}>
                  ↓
                </button>
                <button className="mini danger" aria-label="Remover da fila" onClick={() => remove(s.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ol>
          <div className="dialog-actions">
            <button className="btn" onClick={clear}>
              Limpar fila
            </button>
            <a className="btn primary" href={hrefs.play(items[0].id, true)} onClick={onClose}>
              ▶ Tocar a fila
            </a>
          </div>
        </>
      )}
    </Dialog>
  );
}
