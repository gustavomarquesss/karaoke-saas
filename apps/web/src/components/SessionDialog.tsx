import { useEffect, useRef, useState } from 'react';
import { api, fileUrl } from '../api';
import type { Stem } from '../audio/engine';
import { encodeWav, renderBacking } from '../audio/mix';
import { decode } from '../audio/player';
import { buildMicTrack, combine, type RecordingSession, type Segment } from '../audio/session';
import { renderVoiceFxRegions } from '../audio/voicefx';
import { formatTime } from '../lib/lyrics';
import type { PlayerSettings } from '../lib/settings';
import type { VoiceFxState } from '../lib/voicefx';
import type { Song } from '../types';
import { Dialog } from './Dialog';
import { TimeField } from './Fields';
import { VoiceFxPanel } from './VoiceFxPanel';

interface Props {
  song: Song;
  session: RecordingSession;
  settings: PlayerSettings;
  fxState: VoiceFxState;
  onFxChange: (s: VoiceFxState) => void;
  /** latência de saída (s) do navegador durante a gravação, para estimar a latência da voz */
  outputLatency: number;
  inputLatency: number;
  /** fecha e mantém a sessão para gravar mais */
  onContinue: () => void;
  /** volta ao player no começo do trecho para regravá-lo */
  onRerecord: (seg: Segment) => void;
  onDiscard: () => void;
}

const MIN_SEGMENT = 0.25;

/** Edição da gravação: trechos, cortes, regravação, efeitos de voz, latência e modo de mix. */
export function SessionDialog({ song, session, settings, fxState, onFxChange, outputLatency, inputLatency, onContinue, onRerecord, onDiscard }: Props) {
  const sr = session.sampleRate;
  const tempo = session.tempo;
  const autoMs = Math.round((outputLatency + inputLatency) * 1000);

  const [rev, setRev] = useState(0);
  const bump = () => setRev((r) => r + 1);
  const [latencyMs, setLatencyMs] = useState(Math.max(autoMs, 0));
  const [micGain, setMicGain] = useState(1);
  const [withGuide, setWithGuide] = useState(false);
  const [mode, setMode] = useState<'full' | 'segments'>('full');
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>('Carregando o acompanhamento…');
  const [mixUrl, setMixUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [songFrames, setSongFrames] = useState(0);

  const stems = useRef<{ vocals: Stem; instrumental: Stem } | null>(null);
  const backingCache = useRef<Map<boolean, Stem>>(new Map());
  const run = useRef(0);
  const audio = useRef<HTMLAudioElement>(null);

  // decodifica os stems uma única vez
  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext({ sampleRate: sr });
    (async () => {
      try {
        const [vocals, instrumental] = await Promise.all([decode(ctx, fileUrl(song.id, 'vocals.wav')), decode(ctx, fileUrl(song.id, 'instrumental.wav'))]);
        if (cancelled) return;
        stems.current = { vocals, instrumental };
        setSongFrames(Math.max(vocals.l.length, instrumental.l.length));
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

  const outFrames = Math.ceil(songFrames / tempo);

  // (re)monta a mix sempre que algo muda: backing (em cache) → voz seca → efeitos → soma
  useEffect(() => {
    if (!stems.current || outFrames === 0) return;
    const token = ++run.current;
    const timer = window.setTimeout(async () => {
      try {
        setBusy('Misturando…');
        let backing = backingCache.current.get(withGuide);
        if (!backing) {
          backing = await renderBacking(
            stems.current!.vocals,
            stems.current!.instrumental,
            sr,
            { tempo, semitones: session.semitones, vocalGain: withGuide ? settings.vocal : 0, instrumentalGain: settings.instrumental },
            outFrames,
            (f) => token === run.current && setBusy(`Preparando o acompanhamento… ${Math.round(f * 100)}%`),
          );
          backingCache.current.set(withGuide, backing);
        }
        if (token !== run.current) return;
        const dry = buildMicTrack(session, outFrames, Math.round((latencyMs / 1000) * sr));
        setBusy('Aplicando os efeitos na voz…');
        const voice = await renderVoiceFxRegions(dry, session.activeWindows(), sr, fxState.fx);
        if (token !== run.current) return;
        const out = combine(session, backing, voice, { micGain, mode });
        const wav = encodeWav(out, sr);
        setBlob(wav);
        setMixUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(wav);
        });
        setBusy(null);
        setError(null);
      } catch (e) {
        if (token === run.current) {
          setError((e as Error).message);
          setBusy(null);
        }
      }
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outFrames, rev, latencyMs, micGain, withGuide, mode, fxState.fx, sr, tempo]);

  useEffect(() => () => setMixUrl((old) => (old && URL.revokeObjectURL(old), null)), []);

  const save = async () => {
    if (!blob) return;
    try {
      setSaved((await api.saveRecording(song.id, blob)).name);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // ---------------------------------------------------------------- edição dos trechos
  const toMedia = (outFrame: number) => (outFrame * tempo) / sr;
  const toOut = (mediaSec: number) => Math.round((mediaSec * sr) / tempo);
  const minFrames = Math.round(MIN_SEGMENT * sr);

  const setStart = (seg: Segment, mediaSec: number) => {
    const len = session.length(seg);
    seg.trimStart = Math.min(Math.max(toOut(mediaSec) - session.outStart(seg), 0), len - seg.trimEnd - minFrames);
    bump();
  };
  const setEnd = (seg: Segment, mediaSec: number) => {
    const len = session.length(seg);
    seg.trimEnd = Math.min(Math.max(session.outStart(seg) + len - toOut(mediaSec), 0), len - seg.trimStart - minFrames);
    bump();
  };

  const playSegment = (seg: Segment) => {
    const el = audio.current;
    if (!el || mode !== 'full') return;
    el.currentTime = Math.max(session.window(seg)[0] / sr - 1, 0);
    void el.play();
  };

  const ready = !busy && !!mixUrl;
  const total = formatTime(session.recordedSeconds());
  const title = `${song.title || 'karaoke'} - minha gravacao.wav`;

  return (
    <Dialog title="Sua gravação" onClose={onContinue} wide>
      <div className="form">
        <p className="muted small-text">
          {session.segments.length} {session.segments.length === 1 ? 'trecho' : 'trechos'} · {total} gravados. Cada pausa ou salto na música cria um novo trecho. Ajuste, corte, regrave ou desligue
          trechos abaixo; quando dois trechos se sobrepõem, o mais novo vale.
        </p>

        {/* visão geral na linha do tempo da música */}
        <div className="seg-timeline" aria-label="Trechos na música">
          {session.segments.map((seg, i) => {
            const [a, b] = session.window(seg);
            return (
              <button
                key={seg.id}
                className={`seg-block ${seg.enabled ? '' : 'off'} ${selected === seg.id ? 'sel' : ''}`}
                style={{ left: `${(a / Math.max(outFrames, 1)) * 100}%`, width: `${Math.max(((b - a) / Math.max(outFrames, 1)) * 100, 0.6)}%` }}
                onClick={() => setSelected(seg.id)}
                title={`Trecho ${i + 1}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        <div className="seg-list">
          {session.segments.length === 0 && <p className="muted">Nenhum trecho gravado ainda.</p>}
          {session.segments.map((seg, i) => {
            const [a, b] = session.window(seg);
            return (
              <div key={seg.id} className={`seg-row ${selected === seg.id ? 'sel' : ''} ${seg.enabled ? '' : 'off'}`} onClick={() => setSelected(seg.id)}>
                <label className="check seg-name">
                  <input
                    type="checkbox"
                    checked={seg.enabled}
                    onChange={(e) => {
                      seg.enabled = e.target.checked;
                      bump();
                    }}
                    aria-label={`Usar o trecho ${i + 1}`}
                  />
                  <span>Trecho {i + 1}</span>
                </label>
                <TimeField label={`Início do trecho ${i + 1} (s na música)`} value={toMedia(a)} onCommit={(v) => setStart(seg, v)} />
                <span className="muted">→</span>
                <TimeField label={`Fim do trecho ${i + 1} (s na música)`} value={toMedia(b)} onCommit={(v) => setEnd(seg, v)} />
                <label className="seg-gain" title="Volume da voz neste trecho">
                  <span className="muted">vol</span>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={Math.round(seg.gain * 100)}
                    onChange={(e) => {
                      seg.gain = Number(e.target.value) / 100;
                      bump();
                    }}
                    aria-label={`Volume do trecho ${i + 1}`}
                  />
                </label>
                <button className="mini" onClick={() => playSegment(seg)} disabled={!ready || mode !== 'full'} title="Ouvir a partir deste trecho" aria-label={`Ouvir o trecho ${i + 1}`}>
                  ▶
                </button>
                <button className="mini" onClick={() => onRerecord(seg)} title="Voltar ao player no começo deste trecho para regravar" aria-label={`Regravar o trecho ${i + 1}`}>
                  ↻
                </button>
                <button
                  className="mini danger"
                  onClick={() => {
                    session.remove(seg.id);
                    bump();
                  }}
                  title="Excluir trecho"
                  aria-label={`Excluir o trecho ${i + 1}`}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        <div className="row">
          <label>
            <span>Resultado</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'full' | 'segments')}>
              <option value="full">Música inteira (voz só onde você cantou)</option>
              <option value="segments">Só os trechos gravados, em sequência</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={withGuide} onChange={(e) => setWithGuide(e.target.checked)} />
            <span>Incluir a voz guia no mix</span>
          </label>
        </div>

        <div className="row">
          <label>
            <span>
              Latência da voz: {latencyMs} ms <span className="muted">(estimada: {autoMs} ms)</span>
            </span>
            <input type="range" min={0} max={600} step={5} value={latencyMs} onChange={(e) => setLatencyMs(Number(e.target.value))} />
          </label>
          <label>
            <span>Volume da sua voz: {Math.round(micGain * 100)}%</span>
            <input type="range" min={0} max={300} value={micGain * 100} onChange={(e) => setMicGain(Number(e.target.value) / 100)} />
          </label>
        </div>

        <VoiceFxPanel
          state={fxState}
          onChange={onFxChange}
          title="Efeitos na sua voz"
          hint="Aplicados na mix (a gravação em si fica sem efeito, então você pode trocar à vontade)."
          showMonitor={false}
        />

        {busy && !error && (
          <div className="stage-msg small">
            <div className="spinner" />
            {busy}
          </div>
        )}
        {mixUrl && <audio ref={audio} controls src={mixUrl} className="audio-preview" />}
        {error && <div className="banner error">{error}</div>}
        {saved && <div className="banner ok">Salvo em data/songs/{song.id}/recordings/{saved}</div>}

        <div className="dialog-actions wrap">
          <button className="btn danger-outline" onClick={onDiscard}>
            Descartar tudo
          </button>
          <button className="btn" onClick={onContinue}>
            Continuar gravando
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
