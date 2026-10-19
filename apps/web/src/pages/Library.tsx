import { useMemo, useState } from 'react';
import { AddSongDialog } from '../components/AddSongDialog';
import { LyricsDialog } from '../components/LyricsDialog';
import { QueuePanel } from '../components/QueuePanel';
import { SongCard } from '../components/SongCard';
import { api } from '../api';
import { useQueue } from '../hooks/useQueue';
import { useSongs } from '../hooks/useSongs';
import { hrefs } from '../hooks/useRoute';
import type { Song } from '../types';

export function Library() {
  const { songs, error, refresh } = useSongs();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const queue = useQueue();
  const [relyrics, setRelyrics] = useState<Song | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!songs) return [];
    return q ? songs.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(q)) : songs;
  }, [songs, query]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const onDelete = (song: Song) => {
    if (!confirm(`Excluir "${song.title || 'música'}" e todos os arquivos dela?`)) return;
    void run(async () => {
      await api.remove(song.id);
      refresh();
    });
  };

  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href={hrefs.library}>
          <span className="brand-mark" aria-hidden>
            ♪
          </span>
          Karaokê
        </a>
        <div className="search">
          <input
            type="search"
            placeholder="Buscar por título ou artista…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar músicas"
          />
        </div>
        <button className="btn" onClick={() => setShowQueue(true)}>
          Fila{queue.queue.length ? ` (${queue.queue.length})` : ''}
        </button>
        <button className="btn primary" onClick={() => setAdding(true)}>
          + Adicionar música
        </button>
      </header>

      <main className="library">
        {notice && (
          <div className="banner error" role="alert" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}
        {error && <div className="banner error">Não consegui falar com a API: {error}. Ela está rodando?</div>}

        {songs && songs.length === 0 && !error && (
          <div className="empty">
            <div className="empty-art" aria-hidden>
              🎤
            </div>
            <h2>Sua biblioteca está vazia</h2>
            <p>Cole um link do YouTube ou envie um arquivo de áudio. O vocal é separado e a letra sincronizada automaticamente.</p>
            <button className="btn primary big" onClick={() => setAdding(true)}>
              + Adicionar a primeira música
            </button>
          </div>
        )}

        {songs && songs.length > 0 && visible.length === 0 && <p className="muted center">Nada encontrado para “{query}”.</p>}

        <div className="grid">
          {visible.map((song) => (
            <SongCard
              key={song.id}
              song={song}
              onReprocess={(mode) => {
                if (mode === 'lyrics') setRelyrics(song);
                else if (confirm('Refazer separação e letra desta música? Isso pode levar alguns minutos.')) void run(() => api.reprocess(song.id, 'all'));
              }}
              onRetry={() => run(() => api.reprocess(song.id, 'all'))}
              onDelete={() => onDelete(song)}
              inQueue={queue.queue.includes(song.id)}
              onToggleQueue={() => (queue.queue.includes(song.id) ? queue.remove(song.id) : queue.add(song.id))}
            />
          ))}
        </div>
      </main>

      {showQueue && <QueuePanel songs={songs ?? []} onClose={() => setShowQueue(false)} />}
      {adding && (
        <AddSongDialog
          onClose={() => setAdding(false)}
          onCreated={(song) => {
            setAdding(false);
            if (song.duplicate) setNotice(`“${song.title || 'Esta música'}” já está na biblioteca — nada foi reprocessado.`);
            refresh();
          }}
        />
      )}
      {relyrics && (
        <LyricsDialog
          song={relyrics}
          onClose={() => setRelyrics(null)}
          onSubmit={async (text) => {
            await api.reprocess(relyrics.id, 'lyrics', text || undefined);
            setRelyrics(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
