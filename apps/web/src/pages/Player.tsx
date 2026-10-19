import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, fileUrl } from '../api';
import { LyricLine, paintLine } from '../components/LyricLine';
import { KaraokePlayer } from '../audio/player';
import { VoiceRecorder } from '../audio/recorder';
import { ExportDialog } from '../components/ExportDialog';
import { RecordingDialog, type TakeData } from '../components/RecordingDialog';
import { useQueue } from '../hooks/useQueue';
import { nextInQueue } from '../lib/queue';
import { hrefs } from '../hooks/useRoute';
import { displayState, formatTime, lyricTime, type DisplayState } from '../lib/lyrics';
import { clamp, loadLayout, loadSettings, saveLayout, saveSettings, type LyricLayout, type PlayerSettings } from '../lib/settings';
import type { Line, Song } from '../types';

const SHORTCUTS: [string, string][] = [
  ['Espaço', 'Tocar / pausar'],
  ['← →', 'Voltar / avançar 5 s (Shift: 15 s)'],
  ['↑ ↓', 'Volume da voz guia'],
  ['M', 'Silenciar / restaurar voz guia'],
  ['− +', 'Tom: um semitom abaixo / acima'],
  ['[ ]', 'Velocidade −/+ 5%'],
  [', .', 'Sincronia da letra −/+ 50 ms'],
  ['L', 'Alternar layout da letra'],
  ['F', 'Tela cheia'],
  ['Home', 'Voltar ao início'],
];

const sameState = (a: DisplayState, b: DisplayState) => a.current === b.current && a.next === b.next && a.active === b.active && (a.countdown === null) === (b.countdown === null) && (a.countdown === null || Math.ceil(a.countdown) === Math.ceil(b.countdown!));

export function Player({ id, autoplay = false }: { id: string; autoplay?: boolean }) {
  const [song, setSong] = useState<Song | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [hasLyrics, setHasLyrics] = useState(true);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [settings, setSettings] = useState<PlayerSettings>(() => loadSettings(id));
  const [offset, setOffset] = useState(0);
  const [layout, setLayout] = useState<LyricLayout>(loadLayout);
  const [view, setView] = useState<DisplayState>({ current: -1, next: -1, active: false, countdown: null });
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [help, setHelp] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [recState, setRecState] = useState<'idle' | 'starting' | 'recording'>('idle');
  const [take, setTake] = useState<TakeData | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const { queue } = useQueue();
  const nextId = nextInQueue(queue, id);
  const nextIdRef = useRef(nextId);
  nextIdRef.current = nextId;
  const recorder = useRef<VoiceRecorder | null>(null);
  const recStart = useRef(0);
  const recStateRef = useRef(recState);
  recStateRef.current = recState;

  const player = useRef<KaraokePlayer | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const linesRef = useRef(lines);
  const offsetRef = useRef(offset);
  const viewRef = useRef(view);
  const settingsRef = useRef(settings);
  linesRef.current = lines;
  offsetRef.current = offset;
  settingsRef.current = settings;

  // ---------------------------------------------------------------- carga
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    let created: KaraokePlayer | null = null;
    (async () => {
      try {
        const s = await api.get(id);
        if (cancelled) return;
        setSong(s);
        setOffset(s.offset_ms);
        document.title = `${s.title || 'Karaokê'} — Karaokê`;
        if (s.status !== 'ready') throw new Error('Esta música ainda não terminou de processar.');
        const lyr = await api.lyrics(id).catch(() => null);
        if (cancelled) return;
        setLines(lyr?.lines ?? []);
        setHasLyrics(!!lyr && lyr.lines.length > 0);
        const p = await KaraokePlayer.create({ vocals: fileUrl(id, 'vocals.wav'), instrumental: fileUrl(id, 'instrumental.wav') }, ctrl.signal);
        if (cancelled) {
          void p.dispose();
          return;
        }
        created = p;
        player.current = p;
        const st = settingsRef.current;
        p.setTempo(st.tempo);
        p.setSemitones(st.semitones);
        p.setVocalVolume(st.vocal);
        p.setInstrumentalVolume(st.instrumental);
        p.onPlayingChange = setPlaying;
        p.onEnded = () => {
          setPlaying(false);
          if (recStateRef.current === 'recording') void finishRecording();
          else if (nextIdRef.current) window.setTimeout(() => (location.hash = hrefs.play(nextIdRef.current!, true)), 1500);
        };
        if (autoplay) void p.play().catch(() => {});
        setDuration(p.duration);
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
      player.current = null;
      void created?.dispose();
      document.title = 'Karaokê';
    };
  }, [id]);

  // ---------------------------------------------------------------- loop de animação
  useEffect(() => {
    if (phase !== 'ready') return;
    let raf = 0;
    let lastClock = 0;
    const tick = (now: number) => {
      const p = player.current;
      if (p) {
        const audioT = p.currentTime;
        const t = lyricTime(audioT, offsetRef.current);
        const ds = displayState(linesRef.current, t);
        if (!sameState(ds, viewRef.current)) {
          viewRef.current = ds;
          setView(ds);
        } else if (ds.countdown !== null) {
          viewRef.current = ds; // mantém o valor fresco para o próximo frame sem re-render
        }
        const ls = linesRef.current;
        if (ds.current >= 0 && stage.current) {
          paintLine(stage.current.querySelector(`[data-line="${ds.current}"]`), ls[ds.current], t);
          if (ds.next >= 0) paintLine(stage.current.querySelector(`[data-line="${ds.next}"]`), ls[ds.next], t);
        }
        if (now - lastClock > 120) {
          lastClock = now;
          setTime(audioT);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // rolagem do layout "scroll"
  useEffect(() => {
    if (layout !== 'scroll' || !track.current || !stage.current || view.current < 0) return;
    const el = track.current.querySelector<HTMLElement>(`[data-line="${view.current}"]`);
    if (!el) return;
    const y = el.offsetTop + el.offsetHeight / 2 - stage.current.clientHeight / 2;
    track.current.style.transform = `translateY(${-y}px)`;
  }, [view.current, layout, lines, fullscreen]);

  // ---------------------------------------------------------------- ações
  const togglePlay = useCallback(() => {
    const p = player.current;
    if (!p) return;
    if (recStateRef.current === 'recording') return void finishRecording();
    if (p.isPlaying) p.pause();
    else {
      if (p.currentTime >= p.duration - 0.1) p.seek(0);
      void p.play();
    }
  }, []);

  const seekBy = useCallback((delta: number) => {
    const p = player.current;
    if (!p || recStateRef.current !== 'idle') return;
    p.seek(p.currentTime + delta);
    setTime(p.currentTime);
  }, []);

  const seekTo = useCallback((t: number) => {
    if (recStateRef.current !== 'idle') return;
    player.current?.seek(t);
    setTime(t);
  }, []);

  const update = useCallback(
    (patch: Partial<PlayerSettings>) => {
      const next = { ...settingsRef.current, ...patch };
      next.semitones = clamp(Math.round(next.semitones), -12, 12);
      next.tempo = clamp(Math.round(next.tempo * 100) / 100, 0.5, 1.5);
      settingsRef.current = next;
      setSettings(next);
      saveSettings(id, next);
      const p = player.current;
      if (!p) return;
      if (patch.tempo !== undefined) p.setTempo(next.tempo);
      if (patch.semitones !== undefined) p.setSemitones(next.semitones);
      if (patch.vocal !== undefined) p.setVocalVolume(next.vocal);
      if (patch.instrumental !== undefined) p.setInstrumentalVolume(next.instrumental);
    },
    [id],
  );

  // offset de sincronia persistido por música (com debounce)
  const offsetTimer = useRef<number>(0);
  const changeOffset = useCallback(
    (ms: number) => {
      const v = clamp(Math.round(ms), -10000, 10000);
      setOffset(v);
      offsetRef.current = v;
      window.clearTimeout(offsetTimer.current);
      offsetTimer.current = window.setTimeout(() => void api.update(id, { offset_ms: v }).catch(() => {}), 500);
    },
    [id],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen?.();
  }, []);

  const cycleLayout = useCallback(() => {
    setLayout((l) => {
      const n = l === 'karaoke' ? 'scroll' : 'karaoke';
      saveLayout(n);
      return n;
    });
  }, []);

  const mutedVocal = useRef(0.25);
  const toggleVocalMute = useCallback(() => {
    const cur = settingsRef.current.vocal;
    if (cur > 0) {
      mutedVocal.current = cur;
      update({ vocal: 0 });
    } else update({ vocal: mutedVocal.current || 0.25 });
  }, [update]);

  // ---------------------------------------------------------------- gravação da voz
  const startRecording = useCallback(async () => {
    const p = player.current;
    if (!p || recStateRef.current !== 'idle') return;
    setRecError(null);
    setRecState('starting');
    try {
      const rec = await VoiceRecorder.create(p.audioContext);
      recorder.current = rec;
      p.pause();
      p.seek(0);
      const started = new Promise<number>((resolve) => {
        p.onStarted = (frame) => resolve(frame);
      });
      await p.play();
      recStart.current = await started;
      p.onStarted = undefined;
      setRecState('recording');
    } catch (e) {
      recorder.current?.dispose();
      recorder.current = null;
      setRecError((e as Error).message);
      setRecState('idle');
    }
  }, []);

  const finishRecording = useCallback(async () => {
    const p = player.current;
    const rec = recorder.current;
    if (!p || !rec || recStateRef.current !== 'recording') return;
    recorder.current = null;
    recStateRef.current = 'idle';
    if (p.isPlaying) {
      await new Promise<void>((resolve) => {
        const fallback = window.setTimeout(resolve, 800);
        p.onStopped = () => {
          window.clearTimeout(fallback);
          resolve();
        };
        p.pause();
      });
      p.onStopped = undefined;
    }
    const t = rec.stop();
    setRecState('idle');
    setTake({ ...t, startFrame: recStart.current, stopFrame: p.lastStopFrame, sampleRate: p.sampleRate, outputLatency: (p.audioContext.outputLatency || 0) + p.audioContext.baseLatency });
  }, []);

  useEffect(() => () => recorder.current?.dispose(), []);

  // fullscreen e ociosidade (esconde controles/cursor)
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  useEffect(() => {
    let timer = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 3000);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('pointerdown', wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, []);

  // ---------------------------------------------------------------- atalhos
  useEffect(() => {
    const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range'));
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const st = settingsRef.current;
      const onRange = e.target instanceof HTMLInputElement && e.target.type === 'range';
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          if (onRange) return;
          e.preventDefault();
          seekBy(e.shiftKey ? -15 : -5);
          break;
        case 'ArrowRight':
          if (onRange) return;
          e.preventDefault();
          seekBy(e.shiftKey ? 15 : 5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          update({ vocal: clamp(Math.round(st.vocal * 10 + 1) / 10, 0, 1) });
          break;
        case 'ArrowDown':
          e.preventDefault();
          update({ vocal: clamp(Math.round(st.vocal * 10 - 1) / 10, 0, 1) });
          break;
        case 'm':
        case 'M':
          toggleVocalMute();
          break;
        case '+':
        case '=':
          update({ semitones: st.semitones + 1 });
          break;
        case '-':
        case '_':
          update({ semitones: st.semitones - 1 });
          break;
        case '[':
          update({ tempo: st.tempo - 0.05 });
          break;
        case ']':
          update({ tempo: st.tempo + 0.05 });
          break;
        case ',':
          changeOffset(offsetRef.current - 50);
          break;
        case '.':
          changeOffset(offsetRef.current + 50);
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'l':
        case 'L':
          cycleLayout();
          break;
        case 'Home':
        case '0':
          seekTo(0);
          break;
        case '?':
          setHelp((h) => !h);
          break;
        case 'Escape':
          setHelp(false);
          break;
        default:
          return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      // evita que a barra de espaço "clique" no botão focado
      if (e.key === ' ' && !typing(e.target)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [togglePlay, seekBy, seekTo, update, toggleVocalMute, changeOffset, toggleFullscreen, cycleLayout]);

  // ---------------------------------------------------------------- render
  const lineState = (i: number): 'past' | 'current' | 'next' | 'future' => (i < view.current ? 'past' : i === view.current ? 'current' : i === view.next ? 'next' : 'future');

  const visibleLines = useMemo(() => {
    if (layout === 'scroll') return lines.map((_, i) => i);
    return [view.current, view.next].filter((i) => i >= 0);
  }, [layout, lines, view.current, view.next]);

  const title = song?.title || 'Karaokê';
  const dots = view.countdown !== null ? Math.max(1, Math.ceil(view.countdown)) : 0;

  return (
    <div ref={root} className={`player ${fullscreen ? 'fullscreen' : ''} ${idle && playing ? 'idle' : ''}`}>
      <header className="player-top">
        <a className="btn ghost" href={hrefs.library}>
          ← Biblioteca
        </a>
        <div className="player-title">
          <strong>{title}</strong>
          <span>{song?.artist}</span>
        </div>
        <div className="player-top-actions">
          {nextId && (
            <a className="btn ghost" href={hrefs.play(nextId, true)} title="Próxima música da fila">
              Próxima ⏭
            </a>
          )}
          <button
            className={`btn ghost ${recState === 'recording' ? 'rec' : ''}`}
            onClick={() => (recState === 'recording' ? void finishRecording() : void startRecording())}
            disabled={phase !== 'ready' || recState === 'starting'}
            title="Grava sua voz cantando junto (use fones de ouvido) e salva a mix"
          >
            {recState === 'recording' ? '■ Parar gravação' : recState === 'starting' ? 'Abrindo microfone…' : '🎙 Gravar'}
          </button>
          <button className="btn ghost" onClick={() => setExporting(true)} disabled={phase !== 'ready' || !hasLyrics} title="Gera um MP4 com a letra queimada">
            Exportar MP4
          </button>
          <button className="btn ghost" onClick={cycleLayout} title="Alternar layout (L)">
            {layout === 'karaoke' ? 'Layout: linhas' : 'Layout: rolagem'}
          </button>
          <a className="btn ghost" href={hrefs.edit(id)}>
            Editar letra
          </a>
          <button className="btn ghost" onClick={() => setHelp(true)} title="Atalhos (?)" aria-label="Atalhos de teclado">
            ?
          </button>
          <button className="btn ghost" onClick={toggleFullscreen} title="Tela cheia (F)">
            {fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          </button>
        </div>
      </header>

      {recError && (
        <div className="banner error rec-error" role="alert" onClick={() => setRecError(null)}>
          {recError}
        </div>
      )}
      <div className={`stage layout-${layout}`} ref={stage} onDoubleClick={toggleFullscreen}>
        {phase === 'loading' && (
          <div className="stage-msg">
            <div className="spinner" />
            Carregando áudio…
          </div>
        )}
        {phase === 'error' && (
          <div className="stage-msg error">
            {error}
            <a className="btn" href={hrefs.library}>
              Voltar
            </a>
          </div>
        )}
        {phase === 'ready' && !hasLyrics && (
          <div className="stage-msg">
            <h2>Esta música não tem letra</h2>
            <p className="muted">Você ainda pode cantar com o instrumental, ou criar a letra no editor.</p>
            <a className="btn primary" href={hrefs.edit(id)}>
              Abrir editor de letra
            </a>
          </div>
        )}

        {phase === 'ready' && hasLyrics && (
          <>
            <div className={`countdown ${dots ? 'on' : ''}`} aria-hidden={!dots}>
              {[3, 2, 1].map((n) => (
                <span key={n} className={n <= dots ? 'dot lit' : 'dot'} />
              ))}
            </div>
            <div className="lyrics-track" ref={track}>
              {visibleLines.map((i) => (
                <LyricLine key={i} line={lines[i]} index={i} state={lineState(i)} />
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="controls">
        <div className="seek-row">
          <button className="play-btn" onClick={togglePlay} disabled={phase !== 'ready'} aria-label={playing ? 'Pausar' : 'Tocar'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <span className="time">{formatTime(time)}</span>
          <input
            className="seek"
            type="range"
            min={0}
            max={Math.max(duration, 1)}
            step={0.1}
            value={Math.min(time, duration)}
            disabled={phase !== 'ready'}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Posição"
          />
          <span className="time">{formatTime(duration)}</span>
        </div>

        <div className="mixer">
          <Control label="Voz guia" value={`${Math.round(settings.vocal * 100)}%`}>
            <button className="mini" onClick={toggleVocalMute} aria-label="Silenciar voz guia" title="Silenciar (M)">
              {settings.vocal === 0 ? '🔇' : '🎤'}
            </button>
            <input type="range" min={0} max={100} value={Math.round(settings.vocal * 100)} onChange={(e) => update({ vocal: Number(e.target.value) / 100 })} aria-label="Volume da voz guia" />
          </Control>

          <Control label="Instrumental" value={`${Math.round(settings.instrumental * 100)}%`}>
            <input type="range" min={0} max={100} value={Math.round(settings.instrumental * 100)} onChange={(e) => update({ instrumental: Number(e.target.value) / 100 })} aria-label="Volume do instrumental" />
          </Control>

          <Control label="Tom" value={`${settings.semitones > 0 ? '+' : ''}${settings.semitones} st`}>
            <Stepper onMinus={() => update({ semitones: settings.semitones - 1 })} onPlus={() => update({ semitones: settings.semitones + 1 })} onReset={() => update({ semitones: 0 })} minusLabel="Tom abaixo" plusLabel="Tom acima" />
          </Control>

          <Control label="Velocidade" value={`${settings.tempo.toFixed(2)}×`}>
            <Stepper onMinus={() => update({ tempo: settings.tempo - 0.05 })} onPlus={() => update({ tempo: settings.tempo + 0.05 })} onReset={() => update({ tempo: 1 })} minusLabel="Mais devagar" plusLabel="Mais rápido" />
          </Control>

          <Control label="Sincronia da letra" value={`${offset > 0 ? '+' : ''}${offset} ms`}>
            <Stepper onMinus={() => changeOffset(offset - 50)} onPlus={() => changeOffset(offset + 50)} onReset={() => changeOffset(0)} minusLabel="Adiantar letra" plusLabel="Atrasar letra" />
          </Control>
        </div>
      </footer>

      {exporting && song && <ExportDialog song={song} settings={settings} onClose={() => setExporting(false)} />}
      {take && song && <RecordingDialog song={song} take={take} settings={settings} onClose={() => setTake(null)} />}

      {help && (
        <div className="overlay" onMouseDown={() => setHelp(false)}>
          <div className="dialog" role="dialog" aria-label="Atalhos de teclado" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dialog-head">
              <h2>Atalhos</h2>
              <button className="icon-btn" aria-label="Fechar" onClick={() => setHelp(false)}>
                ✕
              </button>
            </div>
            <dl className="shortcuts">
              {SHORTCUTS.map(([k, d]) => (
                <div key={k}>
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}

function Control({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="control">
      <div className="control-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="control-body">{children}</div>
    </div>
  );
}

function Stepper({ onMinus, onPlus, onReset, minusLabel, plusLabel }: { onMinus: () => void; onPlus: () => void; onReset: () => void; minusLabel: string; plusLabel: string }) {
  return (
    <div className="stepper">
      <button className="mini" onClick={onMinus} aria-label={minusLabel}>
        −
      </button>
      <button className="mini wide" onClick={onReset} aria-label="Restaurar padrão">
        Reset
      </button>
      <button className="mini" onClick={onPlus} aria-label={plusLabel}>
        +
      </button>
    </div>
  );
}
