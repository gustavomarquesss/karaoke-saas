import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, fileUrl } from '../api';
import { LyricLine, paintLine } from '../components/LyricLine';
import { KaraokePlayer } from '../audio/player';
import { VoiceRecorder } from '../audio/recorder';
import { RecordingSession, type Segment } from '../audio/session';
import { ExportDialog } from '../components/ExportDialog';
import { SessionDialog } from '../components/SessionDialog';
import { VoiceFxPanel } from '../components/VoiceFxPanel';
import { loadFxState, saveFxState, type VoiceFxState } from '../lib/voicefx';
import { useQueue } from '../hooks/useQueue';
import { nextInQueue } from '../lib/queue';
import { hrefs } from '../hooks/useRoute';
import { displayState, formatTime, lineJumpTarget, lyricTime, type DisplayState } from '../lib/lyrics';
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
  ['P  N', 'Linha anterior / próxima (pular para cantar um trecho)'],
  ['R', 'Gravar / pausar a gravação'],
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
  const [review, setReview] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [countInSecs, setCountInSecs] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('karaoke:countin') ?? 3);
    } catch {
      return 3;
    }
  });
  const [fxState, setFxState] = useState<VoiceFxState>(loadFxState);
  const [sessionRev, setSessionRev] = useState(0);
  const { queue } = useQueue();
  const nextId = nextInQueue(queue, id);
  const nextIdRef = useRef(nextId);
  nextIdRef.current = nextId;
  const recorder = useRef<VoiceRecorder | null>(null);
  const session = useRef<RecordingSession | null>(null);
  const countToken = useRef(0);
  const recStateRef = useRef(recState);
  recStateRef.current = recState;
  const fxRef = useRef(fxState);
  fxRef.current = fxState;
  const countInRef = useRef(countInSecs);
  countInRef.current = countInSecs;
  const latencies = useRef({ output: 0, input: 0 });
  void sessionRev; // força re-render quando a sessão muda (trechos novos)

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
          if (recStateRef.current === 'recording') void pauseRecording();
          else if (nextIdRef.current && !session.current?.hasSegments) window.setTimeout(() => (location.hash = hrefs.play(nextIdRef.current!, true)), 1500);
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
    if (recStateRef.current === 'recording') return void pauseRecording();
    if (recStateRef.current === 'starting') return cancelStart();
    if (p.isPlaying) p.pause();
    else {
      if (p.currentTime >= p.duration - 0.1) p.seek(0);
      void p.play();
    }
  }, []);

  const seekBy = useCallback((delta: number) => {
    const p = player.current;
    if (!p || recStateRef.current === 'starting') return;
    p.seek(p.currentTime + delta);
    setTime(p.currentTime);
  }, []);

  const seekTo = useCallback((t: number) => {
    if (recStateRef.current === 'starting') return;
    player.current?.seek(t);
    setTime(t);
  }, []);

  /** Pula para a linha anterior/próxima (cai um pouco antes para dar tempo de se preparar). */
  const jumpLine = useCallback((dir: 1 | -1) => {
    const p = player.current;
    if (!p || recStateRef.current === 'starting') return;
    const t = lyricTime(p.currentTime, offsetRef.current);
    const target = lineJumpTarget(linesRef.current, t, dir);
    if (target === null) return;
    const at = target + offsetRef.current / 1000;
    p.seek(at);
    setTime(at);
  }, []);

  /** Clique numa linha da letra: vai para ela (com a folga de preparação). */
  const onLyricClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-line]');
    const p = player.current;
    if (!el || !p || recStateRef.current === 'starting') return;
    const line = linesRef.current[Number(el.dataset.line)];
    if (!line) return;
    const at = Math.max(0, line.start - 0.8) + offsetRef.current / 1000;
    p.seek(at);
    setTime(at);
  };

  const update = useCallback(
    (patch: Partial<PlayerSettings>) => {
      if ((patch.tempo !== undefined || patch.semitones !== undefined) && (recStateRef.current !== 'idle' || session.current?.hasSegments)) return; // tom/velocidade valem para toda a gravação
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

  // ---------------------------------------------------------------- gravação da voz (trechos)
  const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const cancelStart = useCallback(() => {
    countToken.current++;
    setCountIn(null);
  }, []);

  /** Começa um trecho a partir da posição atual (com contagem regressiva, se ligada). */
  const startRecording = useCallback(async () => {
    const p = player.current;
    if (!p || recStateRef.current !== 'idle') return;
    setRecError(null);
    setRecState('starting');
    recStateRef.current = 'starting';
    const token = ++countToken.current;
    try {
      if (!session.current) session.current = new RecordingSession(p.sampleRate, settingsRef.current.tempo, settingsRef.current.semitones);
      const sess = session.current;
      p.pause();
      if (p.currentTime >= p.duration - 0.5) p.seek(0);
      const rec = await VoiceRecorder.create(p.audioContext, (frame, data) => sess.store.add(frame, data));
      recorder.current = rec;
      latencies.current = { output: (p.audioContext.outputLatency || 0) + p.audioContext.baseLatency, input: rec.inputLatency };
      rec.setMonitor(fxRef.current.monitor, fxRef.current.fx);
      const secs = countInRef.current;
      for (let i = secs; i > 0; i--) {
        setCountIn(i);
        await sleep(1000);
        if (countToken.current !== token) throw new Error('cancelado');
      }
      setCountIn(null);
      if (secs === 0) await sleep(150); // dá tempo de o microfone começar a capturar antes da música
      if (countToken.current !== token) throw new Error('cancelado');
      // cada (re)início da música — inclusive um salto — abre um novo trecho
      p.onStarted = (frame, media) => {
        sess.begin(frame, media);
        setSessionRev((r) => r + 1);
      };
      p.onStopped = (frame) => {
        if (sess.end(frame)) setSessionRev((r) => r + 1);
      };
      await p.play();
      setRecState('recording');
    } catch (e) {
      recorder.current?.stop();
      recorder.current = null;
      p.onStarted = undefined;
      p.onStopped = undefined;
      setCountIn(null);
      setRecState('idle');
      if ((e as Error).message !== 'cancelado') setRecError((e as Error).message);
    }
  }, []);

  /** Pausa a música e fecha o trecho atual; a sessão continua aberta para retomar (ou pular antes). */
  const pauseRecording = useCallback(async () => {
    const p = player.current;
    const rec = recorder.current;
    if (!p || recStateRef.current !== 'recording') return;
    recStateRef.current = 'idle';
    setRecState('idle');
    if (p.isPlaying) p.pause();
    await sleep(600); // a voz chega com atraso (latência): captura mais um pouco antes de fechar o microfone
    p.onStarted = undefined;
    p.onStopped = undefined;
    if (recorder.current === rec) {
      rec?.stop();
      recorder.current = null;
    }
    setSessionRev((r) => r + 1);
  }, []);

  const toggleRecording = useCallback(() => {
    if (recStateRef.current === 'recording') void pauseRecording();
    else if (recStateRef.current === 'starting') cancelStart();
    else void startRecording();
  }, [pauseRecording, startRecording, cancelStart]);

  /** Encerra a captura e abre a edição. */
  const finishRecording = useCallback(async () => {
    if (recStateRef.current === 'recording') await pauseRecording();
    else if (recStateRef.current === 'starting') cancelStart();
    if (session.current?.hasSegments) setReview(true);
  }, [pauseRecording, cancelStart]);

  const discardSession = useCallback(() => {
    cancelStart();
    recorder.current?.stop();
    recorder.current = null;
    session.current = null;
    setReview(false);
    setSessionRev((r) => r + 1);
  }, [cancelStart]);

  const rerecord = useCallback(
    (seg: Segment) => {
      const p = player.current;
      const sess = session.current;
      if (!p || !sess) return;
      setReview(false);
      p.seek(Math.max(0, seg.mediaStart / sess.sampleRate - 0.5));
      void startRecording();
    },
    [startRecording],
  );

  const changeFx = useCallback((next: VoiceFxState) => {
    setFxState(next);
    saveFxState(next);
    recorder.current?.setMonitor(next.monitor, next.fx); // ao vivo: o efeito muda enquanto você canta
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('karaoke:countin', String(countInSecs));
    } catch {
      /* ignora */
    }
  }, [countInSecs]);

  // sair da página com gravação não salva
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (session.current?.hasSegments) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      recorder.current?.stop();
    };
  }, []);

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
        case 'p':
        case 'P':
          jumpLine(-1);
          break;
        case 'n':
        case 'N':
          jumpLine(1);
          break;
        case 'r':
        case 'R':
          toggleRecording();
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
  }, [togglePlay, seekBy, seekTo, update, toggleVocalMute, changeOffset, toggleFullscreen, cycleLayout, jumpLine, toggleRecording]);

  // ---------------------------------------------------------------- render
  const lineState = (i: number): 'past' | 'current' | 'next' | 'future' => (i < view.current ? 'past' : i === view.current ? 'current' : i === view.next ? 'next' : 'future');

  const visibleLines = useMemo(() => {
    if (layout === 'scroll') return lines.map((_, i) => i);
    return [view.current, view.next].filter((i) => i >= 0);
  }, [layout, lines, view.current, view.next]);

  const sess = session.current;
  const locked = recState !== 'idle' || !!sess?.hasSegments; // tom/velocidade valem para toda a gravação
  const title = song?.title || 'Karaokê';
  const dots = view.countdown !== null ? Math.max(1, Math.ceil(view.countdown)) : 0;

  return (
    <div ref={root} className={`player ${fullscreen ? 'fullscreen' : ''} ${idle && playing ? 'idle' : ''}`}>
      <header className="player-top">
        <a
          className="btn ghost"
          href={hrefs.library}
          onClick={(e) => session.current?.hasSegments && !confirm('Você tem uma gravação não salva. Sair mesmo assim?') && e.preventDefault()}
        >
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

        {countIn !== null && (
          <div className="count-in" role="status" aria-live="assertive">
            <span key={countIn}>{countIn}</span>
            <small>prepare-se para cantar…</small>
          </div>
        )}
        {phase === 'ready' && hasLyrics && (
          <>
            <div className={`countdown ${dots ? 'on' : ''}`} aria-hidden={!dots}>
              {[3, 2, 1].map((n) => (
                <span key={n} className={n <= dots ? 'dot lit' : 'dot'} />
              ))}
            </div>
            <div className="lyrics-track clickable" ref={track} onClick={onLyricClick} title="Clique numa linha para ir até ela">
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
          <button className="mini" onClick={() => jumpLine(-1)} disabled={phase !== 'ready' || !hasLyrics} title="Linha anterior (P)" aria-label="Linha anterior">
            ⏮
          </button>
          <button className="mini" onClick={() => jumpLine(1)} disabled={phase !== 'ready' || !hasLyrics} title="Próxima linha (N)" aria-label="Próxima linha">
            ⏭
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
            <Stepper disabled={locked} onMinus={() => update({ semitones: settings.semitones - 1 })} onPlus={() => update({ semitones: settings.semitones + 1 })} onReset={() => update({ semitones: 0 })} minusLabel="Tom abaixo" plusLabel="Tom acima" />
          </Control>

          <Control label="Velocidade" value={`${settings.tempo.toFixed(2)}×`}>
            <Stepper disabled={locked} onMinus={() => update({ tempo: settings.tempo - 0.05 })} onPlus={() => update({ tempo: settings.tempo + 0.05 })} onReset={() => update({ tempo: 1 })} minusLabel="Mais devagar" plusLabel="Mais rápido" />
          </Control>

          <Control label="Sincronia da letra" value={`${offset > 0 ? '+' : ''}${offset} ms`}>
            <Stepper onMinus={() => changeOffset(offset - 50)} onPlus={() => changeOffset(offset + 50)} onReset={() => changeOffset(0)} minusLabel="Adiantar letra" plusLabel="Atrasar letra" />
          </Control>
        </div>

        <div className="rec-panel">
          <div className="rec-head">
            <strong>Gravação</strong>
            <span className={`rec-status ${recState === 'recording' ? 'live' : ''}`}>
              {recState === 'recording'
                ? '● gravando — Espaço pausa, ⏮ ⏭ ou a barra pulam'
                : recState === 'starting'
                  ? countIn !== null
                    ? 'começando…'
                    : 'abrindo o microfone…'
                  : sess?.hasSegments
                    ? `${sess.segments.length} ${sess.segments.length === 1 ? 'trecho' : 'trechos'} · ${formatTime(sess.recordedSeconds())} gravados`
                    : 'cante junto e grave só os trechos que quiser'}
            </span>
          </div>
          <div className="rec-actions">
            <button
              className={`btn ${recState === 'recording' ? 'rec' : 'primary'}`}
              onClick={toggleRecording}
              disabled={phase !== 'ready'}
              title="Gravar / pausar a gravação (R). Comece de qualquer ponto da música."
            >
              {recState === 'recording' ? '⏸ Pausar gravação' : recState === 'starting' ? 'Cancelar' : sess?.hasSegments ? '● Retomar gravação' : '🎙 Gravar daqui'}
            </button>
            {sess?.hasSegments && (
              <>
                <button className="btn" onClick={() => void finishRecording()} disabled={recState === 'starting'}>
                  ■ Concluir e editar
                </button>
                <button
                  className="btn ghost"
                  onClick={() => confirm('Descartar todos os trechos gravados?') && discardSession()}
                  disabled={recState !== 'idle'}
                >
                  Descartar
                </button>
              </>
            )}
            <label className="inline">
              <span className="muted">Contagem</span>
              <select value={countInSecs} onChange={(e) => setCountInSecs(Number(e.target.value))} disabled={recState !== 'idle'} aria-label="Contagem regressiva antes de gravar">
                <option value={0}>sem</option>
                <option value={3}>3 s</option>
                <option value={5}>5 s</option>
              </select>
            </label>
          </div>
          <VoiceFxPanel state={fxState} onChange={changeFx} title="Efeito na voz" hint="Vale ao vivo (se ligar a escuta) e como padrão na edição." showMonitor />
        </div>
      </footer>

      {exporting && song && <ExportDialog song={song} settings={settings} onClose={() => setExporting(false)} />}
      {review && song && session.current && (
        <SessionDialog
          song={song}
          session={session.current}
          settings={settings}
          fxState={fxState}
          onFxChange={changeFx}
          outputLatency={latencies.current.output}
          inputLatency={latencies.current.input}
          onContinue={() => setReview(false)}
          onRerecord={rerecord}
          onDiscard={discardSession}
        />
      )}

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

function Stepper({ onMinus, onPlus, onReset, minusLabel, plusLabel, disabled = false }: { onMinus: () => void; onPlus: () => void; onReset: () => void; minusLabel: string; plusLabel: string; disabled?: boolean }) {
  return (
    <div className="stepper" title={disabled ? 'Travado enquanto há uma gravação em andamento: tom e velocidade valem para toda a gravação' : undefined}>
      <button className="mini" onClick={onMinus} aria-label={minusLabel} disabled={disabled}>
        −
      </button>
      <button className="mini wide" onClick={onReset} aria-label="Restaurar padrão" disabled={disabled}>
        Reset
      </button>
      <button className="mini" onClick={onPlus} aria-label={plusLabel} disabled={disabled}>
        +
      </button>
    </div>
  );
}
