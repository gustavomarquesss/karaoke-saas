import { useEffect, useRef, useState } from 'react';
import { api, fileUrl } from '../api';
import { decode } from '../audio/player';
import { encodeWav, mixTake, renderBacking } from '../audio/mix';
import type { Stem } from '../audio/engine';
import type { MicTake } from '../audio/recorder';
import type { PlayerSettings } from '../lib/settings';
import type { Song } from '../types';
import { Dialog } from './Dialog';

export interface TakeData extends MicTake {
  /** frame do AudioContext em que a música começou a sair */
  startFrame: number;
  /** frame do AudioContext em que parou */
  stopFrame: number;
  sampleRate: number;
  /** latência de saída (s) do navegador no momento da gravação */
  outputLatency: number;
}

interface Props {
  song: Song;
  take: TakeData;
  settings: PlayerSettings;
  onClose: () => void;
}

/** Revisão da gravação: ajuste de latência, volumes, prévia, download e salvamento na biblioteca. */
export function RecordingDialog({ song, take, settings, onClose }: Props) {
  const sr = take.sampleRate;
  const autoMs = Math.round((take.outputLatency + take.inputLatency) * 1000);
  const [latencyMs, setLatencyMs] = useState(Math.max(autoMs, 0));
  const [micGain, setMicGain] = useState(1);
  const [withGuide, setWithGuide] = useState(false);
  const [rendering, setRendering] = useState(0);
  const [mixUrl, setMixUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stems = useRef<{ vocals: Stem; instrumental: Stem } | null>(null);
  const backing = useRef<{ guide: boolean; stem: Stem } | null>(null);
  const frames = Math.max(take.stopFrame - take.startFrame, 0);
  const [tick, setTick] = useState(0);

  // decodifica os stems uma única vez
  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext({ sampleRate: sr });
    (async () => {
      try {
        const [vocals, instrumental] = await Promise.all([decode(ctx, fileUrl(song.id, 'vocals.wav')), decode(ctx, fileUrl(song.id, 'instrumental.wav'))]);
        if (!cancelled) {
          stems.current = { vocals, instrumental };
          setRendering(0.001);
          setTick((t) => t + 1);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        void ctx.close();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [song.id, sr]);

  // (re)mixa quando algo muda; o acompanhamento só é re-renderizado se mudar "voz guia"
  useEffect(() => {
    if (!stems.current) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        if (!backing.current || backing.current.guide !== withGuide) {
          setRendering(0.001);
          const stem = await renderBacking(
            stems.current!.vocals,
            stems.current!.instrumental,
            sr,
            { tempo: settings.tempo, semitones: settings.semitones, vocalGain: withGuide ? settings.vocal : 0, instrumentalGain: settings.instrumental },
            frames,
            (f) => !cancelled && setRendering(Math.max(f, 0.001)),
          );
          backing.current = { guide: withGuide, stem };
        }
        if (cancelled) return;
        const i0 = take.startFrame - take.firstFrame + Math.round((latencyMs / 1000) * sr);
        const out = mixTake(backing.current.stem, take.mic, Math.max(i0, 0), micGain);
        const wav = encodeWav(out, sr);
        setBlob(wav);
        setMixUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(wav);
        });
        setRendering(1);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tick, latencyMs, micGain, withGuide, frames, sr, take, settings]);

  useEffect(() => () => setMixUrl((old) => (old && URL.revokeObjectURL(old), null)), []);

  const save = async () => {
    if (!blob) return;
    try {
      const r = await api.saveRecording(song.id, blob);
      setSaved(r.name);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const ready = rendering >= 1 && mixUrl;
  const title = `${song.title || 'karaoke'} - minha gravacao.wav`;

  return (
    <Dialog title="Sua gravação" onClose={onClose}>
      <div className="form">
        <p className="muted small-text">
          Duração: {Math.floor(frames / sr / 60)}:{String(Math.floor((frames / sr) % 60)).padStart(2, '0')}. Se a voz estiver adiantada ou atrasada em relação à música, ajuste a latência — fones com fio costumam precisar de pouco; Bluetooth, de bem mais.
        </p>
        <label>
          <span>Latência da voz: {latencyMs} ms <span className="muted">(estimada pelo navegador: {autoMs} ms)</span></span>
          <input type="range" min={0} max={600} step={5} value={latencyMs} onChange={(e) => setLatencyMs(Number(e.target.value))} />
        </label>
        <div className="row">
          <label>
            <span>Volume da sua voz: {Math.round(micGain * 100)}%</span>
            <input type="range" min={0} max={300} value={micGain * 100} onChange={(e) => setMicGain(Number(e.target.value) / 100)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={withGuide} onChange={(e) => setWithGuide(e.target.checked)} />
            <span>Incluir a voz guia no mix</span>
          </label>
        </div>

        {!ready && !error && (
          <div className="stage-msg small">
            <div className="spinner" />
            {stems.current ? `Misturando… ${Math.round(rendering * 100)}%` : 'Carregando o acompanhamento…'}
          </div>
        )}
        {mixUrl && <audio controls src={mixUrl} className="audio-preview" />}
        {error && <div className="banner error">{error}</div>}
        {saved && <div className="banner ok">Salvo em data/songs/{song.id}/recordings/{saved}</div>}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Descartar
          </button>
          <a className={`btn ${ready ? '' : 'disabled'}`} href={mixUrl ?? undefined} download={title} aria-disabled={!ready}>
            Baixar WAV
          </a>
          <button className="btn primary" onClick={save} disabled={!ready || !!saved}>
            {saved ? 'Salvo ✓' : 'Salvar na biblioteca'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
