import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fileUrl } from '../api';
import { KaraokePlayer } from '../audio/player';
import { TextField, TimeField } from '../components/Fields';
import { LyricsDialog } from '../components/LyricsDialog';
import { Timeline, type DragPhase } from '../components/Timeline';
import { hrefs } from '../hooks/useRoute';
import {
  deleteLine,
  insertLineAfter,
  mergeWithNext,
  moveLineTo,
  nextWordPos,
  setLineText,
  setWordText,
  setWordTimes,
  splitLine,
  tapWord,
} from '../lib/edit';
import { displayState, formatTime, lineText, round3, validateLyrics } from '../lib/lyrics';
import type { Line, Song } from '../types';

const ZOOMS = [8, 16, 32];

export function Editor({ id }: { id: string }) {
  const [song, setSong] = useState<Song | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [meta, setMeta] = useState<{ language?: string | null; source?: string }>({});
  const [past, setPast] = useState<Line[][]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState(1);
  const [guide, setGuide] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [follow, setFollow] = useState(true);
  const [tap, setTap] = useState<{ li: number; wi: number } | null>(null);
  const [reactionMs, setReactionMs] = useState(120);
  const [relyrics, setRelyrics] = useState(false);

  const player = useRef<KaraokePlayer | null>(null);
  const linesRef = useRef(lines);
  const tapRef = useRef(tap);
  const reactionRef = useRef(reactionMs);
  const list = useRef<HTMLDivElement>(null);
  linesRef.current = lines;
  tapRef.current = tap;
  reactionRef.current = reactionMs;

  // ---------------------------------------------------------------- carga
  useEffect(() => {
    let cancelled = false;
    let created: KaraokePlayer | null = null;
    const ctrl = new AbortController();
    (async () => {
      try {
        const s = await api.get(id);
        if (cancelled) return;
        setSong(s);
        if (s.status !== 'ready') throw new Error('Esta música ainda não terminou de processar.');
        const lyr = await api.lyrics(id).catch(() => null);
        if (cancelled) return;
        setLines(lyr?.lines ?? []);
        setMeta({ language: lyr?.language, source: lyr?.source });
        const p = await KaraokePlayer.create({ vocals: fileUrl(id, 'vocals.wav'), instrumental: fileUrl(id, 'instrumental.wav') }, ctrl.signal);
        if (cancelled) return void p.dispose();
        created = p;
        player.current = p;
        p.setVocalVolume(1);
        p.setInstrumentalVolume(0.7);
        p.onPlayingChange = setPlaying;
        setDuration(p.duration);
        setPhase('ready');
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
      player.current = null;
      void created?.dispose();
    };
  }, [id]);

  useEffect(() => {
    if (phase !== 'ready') return;
    let raf = 0;
    const tick = () => {
      if (player.current) setTime(player.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ---------------------------------------------------------------- edição
  const commit = useCallback((next: Line[]) => {
    setPast((p) => [...p.slice(-49), linesRef.current]);
    setLines(next);
    setDirty(true);
    setSaving('idle');
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      setLines(p[p.length - 1]);
      setDirty(true);
      return p.slice(0, -1);
    });
  }, []);

  const save = useCallback(async () => {
    setSaving('saving');
    try {
      const saved = await api.saveLyrics(id, { language: meta.language, source: 'manual', lines: linesRef.current });
      setLines(saved.lines);
      setDirty(false);
      setSaving('saved');
    } catch (e) {
      setSaving('error');
      setError((e as Error).message);
    }
  }, [id, meta.language]);

  const onDrag = useCallback(
    (li: number, wi: number, patch: { start?: number; end?: number }, ph: DragPhase) => {
      if (ph === 'start') {
        setPast((p) => [...p.slice(-49), linesRef.current]);
        setDirty(true);
        setSaving('idle');
      } else if (ph === 'move') {
        setLines(setWordTimes(linesRef.current, li, wi, { start: patch.start === undefined ? undefined : round3(patch.start), end: patch.end === undefined ? undefined : round3(patch.end) }));
      }
    },
    [],
  );

  const seek = useCallback((t: number) => {
    player.current?.seek(t);
    setTime(Math.max(0, t));
  }, []);

  const togglePlay = useCallback(() => {
    const p = player.current;
    if (!p) return;
    if (p.isPlaying) p.pause();
    else void p.play();
  }, []);

  const playLine = (li: number) => {
    setSelected(li);
    const p = player.current;
    if (!p || !lines[li]) return;
    p.seek(Math.max(0, lines[li].start - 1));
    void p.play();
  };

  // linha tocando agora (para destacar e seguir)
  const playingLine = displayState(lines, time);
  const activeIdx = playingLine.active ? playingLine.current : -1;
  useEffect(() => {
    if (!follow || !playing || activeIdx < 0) return;
    list.current?.querySelector(`[data-row="${activeIdx}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIdx, follow, playing]);

  // ---------------------------------------------------------------- modo toque + atalhos
  useEffect(() => {
    const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range'));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing(e.target)) {
        e.preventDefault();
        undo();
        return;
      }
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const tp = tapRef.current;
      if (tp && e.key === 'Enter') {
        e.preventDefault();
        const p = player.current;
        if (!p || !p.isPlaying) return;
        const t = Math.max(0, p.currentTime - reactionRef.current / 1000);
        const cur = linesRef.current;
        if (!cur[tp.li]?.words[tp.wi]) return;
        commit(tapWord(cur, tp.li, tp.wi, t));
        setSelected(tp.li);
        setTap(nextWordPos(cur, tp.li, tp.wi));
      } else if (tp && e.key === 'Backspace') {
        e.preventDefault();
        const cur = linesRef.current;
        const prev = tp.wi > 0 ? { li: tp.li, wi: tp.wi - 1 } : tp.li > 0 ? { li: tp.li - 1, wi: cur[tp.li - 1].words.length - 1 } : tp;
        setTap(prev);
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, undo, commit, togglePlay]);

  const problems = validateLyrics({ lines });
  const sel = lines[selected];

  return (
    <div className="page editor">
      <header className="topbar">
        <a className="btn ghost" href={hrefs.play(id)} onClick={(e) => dirty && !confirm('Há alterações não salvas. Sair mesmo assim?') && e.preventDefault()}>
          ← Voltar ao player
        </a>
        <div className="player-title">
          <strong>Editor de letra</strong>
          <span>{song?.title}</span>
        </div>
        <div className="player-top-actions">
          <button className="btn ghost" onClick={() => setRelyrics(true)}>
            Colar letra e alinhar…
          </button>
          <button className="btn ghost" onClick={undo} disabled={past.length === 0} title="Ctrl+Z">
            Desfazer
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={!dirty || saving === 'saving'} title="Ctrl+S">
            {saving === 'saving' ? 'Salvando…' : saving === 'saved' && !dirty ? 'Salvo ✓' : 'Salvar'}
          </button>
        </div>
      </header>

      {phase === 'loading' && <div className="stage-msg"><div className="spinner" />Carregando…</div>}
      {phase === 'error' && <div className="banner error">{error}</div>}

      {phase === 'ready' && (
        <>
          <section className="editor-transport">
            <div className="seek-row">
              <button className="play-btn" onClick={togglePlay} aria-label={playing ? 'Pausar' : 'Tocar'}>
                {playing ? '❚❚' : '▶'}
              </button>
              <span className="time">{formatTime(time)}</span>
              <input className="seek" type="range" min={0} max={Math.max(duration, 1)} step={0.05} value={Math.min(time, duration)} onChange={(e) => seek(Number(e.target.value))} aria-label="Posição" />
              <span className="time">{formatTime(duration)}</span>
            </div>
            <div className="editor-tools">
              <label className="inline">
                Velocidade
                <select
                  value={tempo}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setTempo(v);
                    player.current?.setTempo(v);
                  }}
                >
                  {[0.5, 0.6, 0.75, 0.9, 1, 1.25].map((v) => (
                    <option key={v} value={v}>
                      {v}×
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline">
                Voz
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={guide * 100}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    setGuide(v);
                    player.current?.setVocalVolume(v);
                  }}
                />
              </label>
              <label className="inline">
                Zoom
                <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
                  {ZOOMS.map((z, i) => (
                    <option key={z} value={i}>
                      {z} s
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline">
                <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                Seguir a linha tocando
              </label>
              <span className="tap-group">
                <button
                  className={`btn ${tap ? 'primary' : ''}`}
                  onClick={() => setTap(tap ? null : { li: selected, wi: 0 })}
                  disabled={lines.length === 0}
                  title="Toque Enter no instante em que cada palavra começa"
                >
                  {tap ? 'Parar modo toque' : 'Modo toque'}
                </button>
                <label className="inline">
                  reação
                  <input className="time-field narrow" type="number" min={0} max={400} step={10} value={reactionMs} onChange={(e) => setReactionMs(Number(e.target.value))} aria-label="Compensação do tempo de reação em ms" />
                  ms
                </label>
              </span>
            </div>
            {tap && lines[tap.li]?.words[tap.wi] && (
              <div className="tap-banner" role="status">
                Toque <kbd>Enter</kbd> quando começar: <strong>{lines[tap.li].words[tap.wi].text}</strong>
                <span className="muted"> — linha {tap.li + 1}: {lineText(lines[tap.li])} · <kbd>Backspace</kbd> volta uma palavra</span>
              </div>
            )}
            {tap === null && <TapHint />}
            <Timeline lines={lines} selected={selected} time={time} windowSec={ZOOMS[zoom]} onSeek={seek} onSelect={setSelected} onDrag={onDrag} />
          </section>

          {problems.length > 0 && (
            <div className="banner warn" role="status">
              {problems.length} problema(s) de ordem nos tempos (corrigidos automaticamente ao salvar). Ex.: {problems[0]}
            </div>
          )}

          <section className="lines" ref={list}>
            {lines.length === 0 && (
              <div className="empty small">
                <p>Esta música ainda não tem letra.</p>
                <button className="btn primary" onClick={() => commit(insertLineAfter([], -1, 'Primeira linha'))}>
                  Criar a primeira linha
                </button>
                <button className="btn" onClick={() => setRelyrics(true)}>
                  Colar letra e alinhar
                </button>
              </div>
            )}
            {lines.map((line, li) => (
              <div key={li} data-row={li} className={`erow ${li === selected ? 'selected' : ''} ${li === activeIdx ? 'playing' : ''}`} onClick={() => setSelected(li)}>
                <div className="erow-main">
                  <button className="mini" onClick={() => playLine(li)} aria-label={`Tocar a partir da linha ${li + 1}`}>
                    ▶
                  </button>
                  <span className="idx">{li + 1}</span>
                  <TimeField label={`Início da linha ${li + 1}`} value={line.start} onCommit={(v) => commit(moveLineTo(lines, li, v))} />
                  <TextField className="line-text" label={`Texto da linha ${li + 1}`} value={lineText(line)} onCommit={(v) => commit(setLineText(lines, li, v))} />
                  <TimeField
                    label={`Fim da linha ${li + 1}`}
                    value={line.end}
                    onCommit={(v) => commit(setWordTimes(lines, li, line.words.length - 1, { end: v }))}
                  />
                  <button className="mini" title="Inserir linha abaixo" aria-label="Inserir linha abaixo" onClick={() => commit(insertLineAfter(lines, li))}>
                    +
                  </button>
                  <button className="mini danger" title="Excluir linha" aria-label="Excluir linha" onClick={() => (commit(deleteLine(lines, li)), setSelected(Math.max(0, li - 1)))}>
                    ✕
                  </button>
                </div>
                {li === selected && (
                  <div className="words">
                    {line.words.map((w, wi) => (
                      <div className="word-edit" key={wi}>
                        <TextField label={`Palavra ${wi + 1}`} value={w.text} onCommit={(v) => commit(setWordText(lines, li, wi, v))} />
                        <TimeField label={`Início de ${w.text}`} value={w.start} onCommit={(v) => commit(setWordTimes(lines, li, wi, { start: v }))} />
                        <TimeField label={`Fim de ${w.text}`} value={w.end} onCommit={(v) => commit(setWordTimes(lines, li, wi, { end: v }))} />
                        {wi > 0 && (
                          <button className="mini" title="Dividir a linha antes desta palavra" onClick={() => commit(splitLine(lines, li, wi))}>
                            ↵
                          </button>
                        )}
                      </div>
                    ))}
                    {li + 1 < lines.length && (
                      <button className="btn small" onClick={() => commit(mergeWithNext(lines, li))}>
                        Juntar com a próxima linha
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {sel === undefined && lines.length > 0 && <p className="muted">Selecione uma linha.</p>}
          </section>
        </>
      )}

      {relyrics && song && (
        <LyricsDialog
          song={song}
          onClose={() => setRelyrics(false)}
          onSubmit={async (text) => {
            await api.reprocess(id, 'lyrics', text || undefined);
            setDirty(false);
            location.hash = hrefs.library;
          }}
        />
      )}
    </div>
  );
}

function TapHint() {
  return (
    <p className="muted hint">
      Arraste os blocos para mover; as bordas redimensionam. Clique no fundo da linha do tempo para ir até aquele ponto. Para sincronizar uma letra do zero, use o <strong>Modo toque</strong> com a velocidade reduzida.
    </p>
  );
}
