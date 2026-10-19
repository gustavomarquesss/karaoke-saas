import { useEffect, useRef, useState } from 'react';
import { fileUrl } from '../api';
import { hrefs } from '../hooks/useRoute';
import { formatTime } from '../lib/lyrics';
import type { Song, Stage } from '../types';

export const STAGE_LABEL: Record<Stage, string> = {
  queued: 'Na fila',
  downloading: 'Baixando áudio',
  separating: 'Separando vocal',
  lyrics: 'Buscando letra',
  aligning: 'Sincronizando letra',
  done: 'Pronto',
};

const SOURCE_LABEL: Record<string, string> = { lrclib: 'LRCLIB', whisperx: 'IA', manual: 'Manual' };

const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

interface Props {
  song: Song;
  onReprocess: (mode: 'all' | 'lyrics') => void;
  onRetry: () => void;
  onDelete: () => void;
  inQueue: boolean;
  onToggleQueue: () => void;
}

export function SongCard({ song, onReprocess, onRetry, onDelete, inQueue, onToggleQueue }: Props) {
  const ready = song.status === 'ready';
  const busy = song.status === 'queued' || song.status === 'processing';
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const title = song.title || 'Sem título';
  const h = hue(song.id);
  const cover = song.has_cover ? (
    <img src={fileUrl(song.id, 'cover.jpg')} alt="" loading="lazy" />
  ) : (
    <div className="cover-fallback" style={{ background: `linear-gradient(135deg, hsl(${h} 70% 38%), hsl(${(h + 60) % 360} 70% 22%))` }}>
      {title.slice(0, 1).toUpperCase()}
    </div>
  );

  return (
    <article className={`card ${song.status}`}>
      <a className="cover" href={ready ? hrefs.play(song.id) : undefined} aria-label={ready ? `Cantar ${title}` : undefined} tabIndex={ready ? 0 : -1}>
        {cover}
        {ready && <span className="play-badge" aria-hidden>▶</span>}
      </a>
      <div className="card-body">
        <h3 title={title}>{title}</h3>
        <p className="artist" title={song.artist}>
          {song.artist || '—'}
        </p>

        {busy && (
          <div className="progress-wrap" role="status">
            <div className="progress">
              <div className="bar" style={{ width: `${Math.max(2, song.progress * 100)}%` }} />
            </div>
            <span className="stage">
              {STAGE_LABEL[song.stage]}
              {song.status === 'processing' ? ` · ${Math.round(song.progress * 100)}%` : ''}
            </span>
          </div>
        )}

        {song.status === 'error' && (
          <div className="error-box">
            <span title={song.error ?? ''}>Falhou: {(song.error ?? '').split('\n')[0].slice(0, 90)}</span>
            <button className="link" onClick={onRetry}>
              Tentar de novo
            </button>
          </div>
        )}

        {ready && (
          <div className="meta">
            <span>{song.duration ? formatTime(song.duration) : '--:--'}</span>
            {song.language && <span className="chip">{song.language.toUpperCase()}</span>}
            {song.lyrics_source && <span className="chip subtle">{SOURCE_LABEL[song.lyrics_source] ?? song.lyrics_source}</span>}
          </div>
        )}
      </div>

      <div className="card-actions" ref={menuRef}>
        <button className="icon-btn" aria-label="Mais ações" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          ⋯
        </button>
        {menu && (
          <div className="menu" role="menu">
            {ready && (
              <>
                <button role="menuitem" onClick={() => (setMenu(false), onToggleQueue())}>
                  {inQueue ? 'Remover da fila' : 'Adicionar à fila'}
                </button>
                <a role="menuitem" href={hrefs.edit(song.id)}>
                  Editar letra
                </a>
                <button role="menuitem" onClick={() => (setMenu(false), onReprocess('lyrics'))}>
                  Refazer letra…
                </button>
              </>
            )}
            {!busy && (
              <button role="menuitem" onClick={() => (setMenu(false), onReprocess('all'))}>
                Reprocessar tudo
              </button>
            )}
            <button role="menuitem" className="danger" onClick={() => (setMenu(false), onDelete())}>
              Excluir
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
