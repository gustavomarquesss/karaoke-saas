import type { Lyrics, Song } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Erro ${res.status}`);
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export interface NewSong {
  url?: string;
  file?: File;
  title?: string;
  artist?: string;
  lyrics?: string;
}

export const api = {
  list: (q?: string) => request<Song[]>(`/api/songs${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  get: (id: string) => request<Song>(`/api/songs/${id}`),
  create: (s: NewSong) => {
    if (s.file) {
      const form = new FormData();
      form.set('file', s.file);
      for (const k of ['title', 'artist', 'lyrics'] as const) if (s[k]) form.set(k, s[k]!);
      return request<Song>('/api/songs/upload', { method: 'POST', body: form });
    }
    return request<Song>('/api/songs', json('POST', { url: s.url, title: s.title || undefined, artist: s.artist || undefined, lyrics: s.lyrics || undefined }));
  },
  update: (id: string, patch: Partial<Pick<Song, 'title' | 'artist' | 'offset_ms'>>) => request<Song>(`/api/songs/${id}`, json('PATCH', patch)),
  remove: (id: string) => request<void>(`/api/songs/${id}`, { method: 'DELETE' }),
  reprocess: (id: string, mode: 'all' | 'lyrics', lyrics?: string) => request<Song>(`/api/songs/${id}/reprocess`, json('POST', { mode, lyrics })),
  lyrics: (id: string) => request<Lyrics>(`/api/songs/${id}/lyrics`),
  exportVideo: (id: string, o: ExportOptions) => request<{ name: string; url: string }>(`/api/songs/${id}/export`, json('POST', o)),
  exports: (id: string) => request<{ name: string; url: string; size: number }[]>(`/api/songs/${id}/exports`),
  saveRecording: (id: string, wav: Blob) => request<{ name: string; url: string; size: number }>(`/api/songs/${id}/recordings`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav }),
  recordings: (id: string) => request<{ name: string; url: string; size: number }[]>(`/api/songs/${id}/recordings`),
  saveLyrics: (id: string, lyrics: Lyrics) => request<Lyrics>(`/api/songs/${id}/lyrics`, json('PUT', lyrics)),
};

export interface ExportOptions {
  vocal: number;
  instrumental: number;
  semitones: number;
  tempo: number;
  size: '1280x720' | '1920x1080';
}

export const fileUrl = (id: string, name: 'vocals.wav' | 'instrumental.wav' | 'cover.jpg') => `/files/${id}/${name}`;
