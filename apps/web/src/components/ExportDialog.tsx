import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PlayerSettings } from '../lib/settings';
import type { Song } from '../types';
import { Dialog } from './Dialog';

interface Props {
  song: Song;
  settings: PlayerSettings;
  onClose: () => void;
}

interface ExportFile {
  name: string;
  url: string;
  size: number;
}

/** Exporta um MP4 com a letra queimada (efeito de karaokê) e o instrumental, com tom/velocidade aplicados. */
export function ExportDialog({ song, settings, onClose }: Props) {
  const [vocal, setVocal] = useState(0);
  const [size, setSize] = useState<'1280x720' | '1920x1080'>('1280x720');
  const [useSettings, setUseSettings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<ExportFile[]>([]);

  useEffect(() => {
    void api.exports(song.id).then(setFiles, () => {});
  }, [song.id]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const file = await api.exportVideo(song.id, {
        vocal,
        instrumental: settings.instrumental,
        semitones: useSettings ? settings.semitones : 0,
        tempo: useSettings ? settings.tempo : 1,
        size,
      });
      setFiles(await api.exports(song.id));
      window.open(file.url, '_blank');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Exportar vídeo MP4" onClose={busy ? () => {} : onClose}>
      <div className="form">
        <p className="muted small-text">
          Gera um vídeo com a letra queimada (palavra a palavra) sobre a capa desfocada, usando o instrumental. Fica salvo em <code>data/songs/{song.id}/exports</code>.
        </p>
        <div className="row">
          <label>
            <span>Resolução</span>
            <select value={size} onChange={(e) => setSize(e.target.value as typeof size)} disabled={busy}>
              <option value="1280x720">720p (mais rápido)</option>
              <option value="1920x1080">1080p</option>
            </select>
          </label>
          <label>
            <span>Voz guia no vídeo: {Math.round(vocal * 100)}%</span>
            <input type="range" min={0} max={100} value={vocal * 100} onChange={(e) => setVocal(Number(e.target.value) / 100)} disabled={busy} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={useSettings} onChange={(e) => setUseSettings(e.target.checked)} disabled={busy} />
          <span>
            Aplicar o tom ({settings.semitones > 0 ? '+' : ''}
            {settings.semitones} st) e a velocidade ({settings.tempo.toFixed(2)}×) do player e a sincronia de {song.offset_ms} ms
          </span>
        </label>
        {error && <div className="banner error">{error}</div>}
        {files.length > 0 && (
          <div>
            <h3 className="mini-title">Vídeos já gerados</h3>
            <ul className="file-list">
              {files.map((f) => (
                <li key={f.name}>
                  <a href={f.url} download={f.name}>
                    {f.name}
                  </a>
                  <span className="muted">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            Fechar
          </button>
          <button className="btn primary" onClick={run} disabled={busy}>
            {busy ? 'Gerando vídeo… (pode levar um minuto)' : 'Gerar MP4'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
