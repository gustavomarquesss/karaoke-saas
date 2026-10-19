import { useRef, useState } from 'react';
import { api } from '../api';
import type { Song } from '../types';
import { Dialog } from './Dialog';

interface Props {
  onClose: () => void;
  onCreated: (song: Song) => void;
}

export function AddSongDialog({ onClose, onCreated }: Props) {
  const [mode, setMode] = useState<'url' | 'file'>('url');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const valid = mode === 'url' ? /^https?:\/\/\S+$/i.test(url.trim()) : !!file;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const song = await api.create(mode === 'url' ? { url: url.trim(), title, artist, lyrics } : { file: file!, title, artist, lyrics });
      onCreated(song);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Adicionar música" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'url'} className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}>
            Link do YouTube
          </button>
          <button type="button" role="tab" aria-selected={mode === 'file'} className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>
            Arquivo de áudio
          </button>
        </div>

        {mode === 'url' ? (
          <label>
            Link
            <input autoFocus type="url" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
        ) : (
          <div
            className={`drop ${file ? 'has-file' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
          >
            <input ref={fileInput} type="file" accept="audio/*,video/*,.mp3,.wav,.flac,.m4a,.ogg,.aac,.mp4,.mkv,.webm" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file ? (
              <>
                <strong>{file.name}</strong>
                <span className="muted">{(file.size / 1024 / 1024).toFixed(1)} MB — clique para trocar</span>
              </>
            ) : (
              <>
                <strong>Arraste um arquivo aqui</strong>
                <span className="muted">ou clique para escolher (mp3, wav, flac, m4a, mp4…)</span>
              </>
            )}
          </div>
        )}

        <div className="row">
          <label>
            <span>
              Título <span className="muted">(opcional)</span>
            </span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Detectado automaticamente" />
          </label>
          <label>
            <span>
              Artista <span className="muted">(opcional)</span>
            </span>
            <input value={artist} onChange={(e) => setArtist(e.target.value)} />
          </label>
        </div>

        <details>
          <summary>Já tenho a letra</summary>
          <label>
            Cole a letra (texto puro ou LRC). Ela será alinhada ao vocal em vez de buscar/transcrever.
            <textarea rows={7} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder={'Uma linha por verso…'} />
          </label>
        </details>

        {error && <div className="banner error">{error}</div>}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={!valid || busy}>
            {busy ? 'Enviando…' : 'Processar'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
