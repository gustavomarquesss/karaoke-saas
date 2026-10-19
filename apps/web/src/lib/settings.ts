export type LyricLayout = 'karaoke' | 'scroll';

export interface PlayerSettings {
  semitones: number;
  tempo: number;
  /** volume do vocal guia, 0..1 */
  vocal: number;
  /** volume do instrumental, 0..1 */
  instrumental: number;
}

export const DEFAULT_SETTINGS: PlayerSettings = { semitones: 0, tempo: 1, vocal: 0.25, instrumental: 1 };

const key = (id: string) => `karaoke:settings:${id}`;
const LAYOUT_KEY = 'karaoke:layout';

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function loadSettings(id: string): PlayerSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(key(id)) ?? 'null');
    if (raw && typeof raw === 'object') {
      return {
        semitones: clamp(Math.round(Number(raw.semitones) || 0), -12, 12),
        tempo: clamp(Number(raw.tempo) || 1, 0.5, 1.5),
        vocal: clamp(Number.isFinite(Number(raw.vocal)) ? Number(raw.vocal) : DEFAULT_SETTINGS.vocal, 0, 1),
        instrumental: clamp(Number.isFinite(Number(raw.instrumental)) ? Number(raw.instrumental) : 1, 0, 1),
      };
    }
  } catch {
    /* localStorage indisponível ou JSON inválido */
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(id: string, s: PlayerSettings): void {
  try {
    localStorage.setItem(key(id), JSON.stringify(s));
  } catch {
    /* ignora */
  }
}

export function loadLayout(): LyricLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'scroll' ? 'scroll' : 'karaoke';
  } catch {
    return 'karaoke';
  }
}

export function saveLayout(l: LyricLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, l);
  } catch {
    /* ignora */
  }
}
