import { PRESETS, matchPreset, type PresetId, type VoiceFx, type VoiceFxState } from '../lib/voicefx';

interface Props {
  state: VoiceFxState;
  onChange: (s: VoiceFxState) => void;
  title: string;
  hint?: string;
  /** mostra a opção "ouvir minha voz com o efeito" (só faz sentido ao vivo) */
  showMonitor: boolean;
}

/** Presets + ajustes finos dos efeitos de voz. Compartilhado entre o player (ao vivo) e a edição. */
export function VoiceFxPanel({ state, onChange, title, hint, showMonitor }: Props) {
  const setFx = (patch: Partial<VoiceFx>) => {
    const fx = { ...state.fx, ...patch };
    onChange({ ...state, fx, preset: matchPreset(fx) });
  };
  const pick = (id: Exclude<PresetId, 'custom'>) => onChange({ ...state, fx: PRESETS[id].fx, preset: id });
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="fx-panel">
      <div className="fx-head">
        <strong>{title}</strong>
        {hint && <span className="muted small-text">{hint}</span>}
      </div>

      <div className="fx-presets" role="radiogroup" aria-label="Preset de efeito">
        {(Object.keys(PRESETS) as Exclude<PresetId, 'custom'>[]).map((id) => (
          <button key={id} type="button" role="radio" aria-checked={state.preset === id} className={`chip-btn ${state.preset === id ? 'on' : ''}`} onClick={() => pick(id)} title={PRESETS[id].hint}>
            {PRESETS[id].label}
          </button>
        ))}
        {state.preset === 'custom' && <span className="chip-btn on static">Personalizado</span>}
      </div>

      <details className="fx-fine">
        <summary>Ajuste fino</summary>
        <div className="fx-sliders">
          <label>
            <span>Reverb (ambiente): {pct(state.fx.reverb)}</span>
            <input type="range" min={0} max={100} value={state.fx.reverb * 100} onChange={(e) => setFx({ reverb: Number(e.target.value) / 100 })} />
          </label>
          <label>
            <span>Eco: {pct(state.fx.echo)}</span>
            <input type="range" min={0} max={100} value={state.fx.echo * 100} onChange={(e) => setFx({ echo: Number(e.target.value) / 100 })} />
          </label>
          <label>
            <span>Compressão (voz firme): {pct(state.fx.compress)}</span>
            <input type="range" min={0} max={100} value={state.fx.compress * 100} onChange={(e) => setFx({ compress: Number(e.target.value) / 100 })} />
          </label>
          <label>
            <span>
              Brilho: {state.fx.brightness > 0 ? '+' : ''}
              {Math.round(state.fx.brightness * 100)}
            </span>
            <input type="range" min={-100} max={100} value={state.fx.brightness * 100} onChange={(e) => setFx({ brightness: Number(e.target.value) / 100 })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={state.fx.cleanup} onChange={(e) => setFx({ cleanup: e.target.checked })} />
            <span>Limpar graves (filtro passa-altas)</span>
          </label>
        </div>
      </details>

      {showMonitor && (
        <label className="check fx-monitor">
          <input type="checkbox" checked={state.monitor} onChange={(e) => onChange({ ...state, monitor: e.target.checked })} />
          <span>
            Ouvir minha voz com o efeito enquanto canto <strong>(use fones de ouvido)</strong>
          </span>
        </label>
      )}
    </div>
  );
}
