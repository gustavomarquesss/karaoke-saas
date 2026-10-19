import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type SongStatus = 'queued' | 'processing' | 'ready' | 'error';
export type Stage = 'queued' | 'downloading' | 'separating' | 'lyrics' | 'aligning' | 'done';

export interface Song {
  id: string;
  title: string;
  artist: string;
  duration: number | null;
  source_url: string | null;
  source_key: string;
  status: SongStatus;
  stage: Stage;
  progress: number;
  message: string;
  error: string | null;
  language: string | null;
  lyrics_source: string | null;
  offset_ms: number;
  has_cover: number;
  /** 1 quando título/artista vieram do usuário (não devem ser sobrescritos pela detecção) */
  title_locked: number;
  created_at: string;
  updated_at: string;
}

/** Campos que o cliente vê (sem source_key). */
export type SongView = Omit<Song, 'source_key' | 'title_locked'>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL DEFAULT '',
  duration REAL,
  source_url TEXT,
  source_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  error TEXT,
  language TEXT,
  lyrics_source TEXT,
  offset_ms INTEGER NOT NULL DEFAULT 0,
  has_cover INTEGER NOT NULL DEFAULT 0,
  title_locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

const UPDATABLE = [
  'title', 'artist', 'duration', 'source_url', 'status', 'stage', 'progress', 'message',
  'error', 'language', 'lyrics_source', 'offset_ms', 'has_cover', 'title_locked',
] as const;
export type SongPatch = Partial<Pick<Song, (typeof UPDATABLE)[number]>>;

export class SongStore {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    try {
      this.db.exec('ALTER TABLE songs ADD COLUMN title_locked INTEGER NOT NULL DEFAULT 0');
    } catch {
      /* coluna já existe */
    }
  }

  list(q?: string): Song[] {
    if (q?.trim()) {
      const like = `%${q.trim().replace(/[%_]/g, (c) => '\\' + c)}%`;
      return this.db
        .prepare("SELECT * FROM songs WHERE title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\' ORDER BY created_at DESC")
        .all(like, like) as unknown as Song[];
    }
    return this.db.prepare('SELECT * FROM songs ORDER BY created_at DESC').all() as unknown as Song[];
  }

  get(id: string): Song | undefined {
    return this.db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as unknown as Song | undefined;
  }

  getByKey(key: string): Song | undefined {
    return this.db.prepare('SELECT * FROM songs WHERE source_key = ?').get(key) as unknown as Song | undefined;
  }

  insert(song: { id: string; source_key: string; source_url: string | null; title: string; artist: string; title_locked?: number }): Song {
    this.db
      .prepare('INSERT INTO songs (id, source_key, source_url, title, artist, title_locked) VALUES (?, ?, ?, ?, ?, ?)')
      .run(song.id, song.source_key, song.source_url, song.title, song.artist, song.title_locked ?? 0);
    return this.get(song.id)!;
  }

  update(id: string, patch: SongPatch): Song | undefined {
    const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && (UPDATABLE as readonly string[]).includes(k));
    if (entries.length) {
      const sets = entries.map(([k]) => `${k} = ?`).join(', ');
      this.db
        .prepare(`UPDATE songs SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
        .run(...(entries.map(([, v]) => v) as (string | number | null)[]), id);
    }
    return this.get(id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM songs WHERE id = ?').run(id);
  }

  /** Músicas que ficaram no meio do processamento quando a API caiu. */
  pending(): Song[] {
    return this.db
      .prepare("SELECT * FROM songs WHERE status IN ('queued','processing') ORDER BY created_at")
      .all() as unknown as Song[];
  }

  close(): void {
    this.db.close();
  }
}

export const toView = ({ source_key: _k, title_locked: _l, ...rest }: Song): SongView => rest;
