import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Song } from '../types';

/** Lista de músicas em tempo real: carga inicial + atualizações via SSE. */
export function useSongs() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.list().then(
      (list) => {
        setSongs(list);
        setError(null);
      },
      (e) => setError(e.message),
    );
  }, []);

  useEffect(() => {
    refresh();
    const es = new EventSource('/api/events');
    es.addEventListener('song', (e) => {
      const song = JSON.parse((e as MessageEvent).data) as Song;
      setSongs((prev) => {
        if (!prev) return prev;
        const i = prev.findIndex((s) => s.id === song.id);
        if (i === -1) return [song, ...prev];
        const next = prev.slice();
        next[i] = song;
        return next;
      });
    });
    es.addEventListener('deleted', (e) => {
      const { id } = JSON.parse((e as MessageEvent).data) as { id: string };
      setSongs((prev) => prev?.filter((s) => s.id !== id) ?? prev);
    });
    es.onopen = refresh; // reconexão: ressincroniza o que foi perdido
    return () => es.close();
  }, [refresh]);

  return { songs, error, refresh, setSongs };
}
