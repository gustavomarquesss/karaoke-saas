import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Song } from '../types';

/** Lista de músicas em tempo real: carga inicial + SSE, com polling de segurança enquanto algo processa. */
export function useSongs() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const songsRef = useRef<Song[] | null>(null);
  songsRef.current = songs;

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
    let es: EventSource | null = null;
    let retry = 0;
    let closed = false;

    const connect = () => {
      es = new EventSource('/api/events');
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
      es.onopen = refresh; // (re)conexão: ressincroniza o que foi perdido
      es.onerror = () => {
        // o navegador reconecta sozinho, exceto quando a conexão é encerrada de vez
        if (es?.readyState === EventSource.CLOSED && !closed) {
          es.close();
          retry = window.setTimeout(connect, 2000);
        }
      };
    };
    connect();

    // rede de segurança: proxies podem segurar o stream; enquanto algo processa, confere a cada 4 s
    const poll = window.setInterval(() => {
      if (songsRef.current?.some((s) => s.status === 'queued' || s.status === 'processing')) refresh();
    }, 4000);

    return () => {
      closed = true;
      window.clearTimeout(retry);
      window.clearInterval(poll);
      es?.close();
    };
  }, [refresh]);

  return { songs, error, refresh, setSongs };
}
