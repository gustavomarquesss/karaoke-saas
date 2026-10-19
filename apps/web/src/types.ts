export type SongStatus = 'queued' | 'processing' | 'ready' | 'error';
export type Stage = 'queued' | 'downloading' | 'separating' | 'lyrics' | 'aligning' | 'done';

export interface Song {
  id: string;
  title: string;
  artist: string;
  duration: number | null;
  source_url: string | null;
  status: SongStatus;
  stage: Stage;
  progress: number;
  message: string;
  error: string | null;
  language: string | null;
  lyrics_source: string | null;
  offset_ms: number;
  has_cover: number;
  created_at: string;
  updated_at: string;
  duplicate?: boolean;
}

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Line {
  start: number;
  end: number;
  text?: string;
  words: Word[];
}

export interface Lyrics {
  language?: string | null;
  source?: string;
  lines: Line[];
}
