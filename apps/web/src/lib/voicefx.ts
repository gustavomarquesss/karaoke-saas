/** Efeitos de voz: parâmetros, presets e persistência (sem Web Audio, testável). */

export interface VoiceFx {
  /** filtro passa-altas em 90 Hz (tira chiado de respiração/ruído grave) */
  cleanup: boolean;
  /** 0..1: quanto o compressor nivela a voz (mais firme e presente) */
  compress: number;
  /** -1..1: escuro ↔ brilhante */
  brightness: number;
  /** 0..1: volume do reverb (ambiente) */
  reverb: number;
  /** 0..1: volume do eco */
  echo: number;
}

export type PresetId = 'natural' | 'studio' | 'stage' | 'pop' | 'echo' | 'cathedral' | 'custom';

export const PRESETS: Record<Exclude<PresetId, 'custom'>, { label: string; hint: string; fx: VoiceFx }> = {
  natural: { label: 'Natural', hint: 'Sem efeito', fx: { cleanup: false, compress: 0, brightness: 0, reverb: 0, echo: 0 } },
  studio: { label: 'Estúdio', hint: 'Limpa, nivela e dá um brilho leve', fx: { cleanup: true, compress: 0.5, brightness: 0.2, reverb: 0.15, echo: 0 } },
  stage: { label: 'Palco', hint: 'Sala média com eco discreto', fx: { cleanup: true, compress: 0.4, brightness: 0.15, reverb: 0.4, echo: 0.15 } },
  pop: { label: 'Pop brilhante', hint: 'Voz firme, clara e à frente', fx: { cleanup: true, compress: 0.7, brightness: 0.5, reverb: 0.2, echo: 0.05 } },
  echo: { label: 'Eco', hint: 'Repetições que se perdem no fundo', fx: { cleanup: true, compress: 0.3, brightness: 0.1, reverb: 0.2, echo: 0.45 } },
  cathedral: { label: 'Catedral', hint: 'Reverb longo e grande', fx: { cleanup: true, compress: 0.3, brightness: 0, reverb: 0.75, echo: 0.1 } },
};

export interface VoiceFxState {
  preset: PresetId;
  fx: VoiceFx;
  /** ouvir a própria voz (com efeito) nos fones enquanto grava */
  monitor: boolean;
}

export const DEFAULT_FX_STATE: VoiceFxState = { preset: 'studio', fx: PRESETS.studio.fx, monitor: false };

export const isDry = (fx: VoiceFx): boolean => !fx.cleanup && fx.compress === 0 && fx.brightness === 0 && fx.reverb === 0 && fx.echo === 0;

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

export function sanitizeFx(raw: Partial<VoiceFx> | null | undefined): VoiceFx {
  return {
    cleanup: !!raw?.cleanup,
    compress: clamp(raw?.compress, 0, 1, 0),
    brightness: clamp(raw?.brightness, -1, 1, 0),
    reverb: clamp(raw?.reverb, 0, 1, 0),
    echo: clamp(raw?.echo, 0, 1, 0),
  };
}

/** Preset que casa exatamente com os parâmetros, ou "custom". */
export function matchPreset(fx: VoiceFx): PresetId {
  for (const [id, p] of Object.entries(PRESETS)) {
    if (JSON.stringify(p.fx) === JSON.stringify(fx)) return id as PresetId;
  }
  return 'custom';
}

/** Mapeia os controles simples para parâmetros de DSP (dB, razão, segundos…). */
export function dspParams(fx: VoiceFx) {
  return {
    hpfHz: fx.cleanup ? 90 : 10,
    compThresholdDb: -12 - 28 * fx.compress,
    compRatio: 1 + 11 * fx.compress,
    /** compensa a queda de volume do compressor */
    makeupGain: 1 + 1.2 * fx.compress,
    highShelfDb: fx.brightness * 9,
    presenceDb: Math.max(fx.brightness, 0) * 3.5,
    reverbWet: fx.reverb * 0.9,
    echoWet: fx.echo * 0.8,
    echoSeconds: 0.3,
    echoFeedback: 0.32 + fx.echo * 0.2,
  };
}

const KEY = 'karaoke:voicefx';

export function loadFxState(): VoiceFxState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const fx = sanitizeFx(raw.fx);
      return { preset: matchPreset(fx), fx, monitor: !!raw.monitor };
    }
  } catch {
    /* localStorage indisponível */
  }
  return DEFAULT_FX_STATE;
}

export function saveFxState(s: VoiceFxState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignora */
  }
}
