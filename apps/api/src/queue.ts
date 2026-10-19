import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { SongStore, Song, Stage } from './db.js';
import type { WorkerRun, WorkerRunner } from './runner.js';

export interface Job {
  songId: string;
  /** Entrada para a ingestão (URL ou arquivo). Sem ela o worker reaproveita o original.wav. */
  input?: string;
  force?: boolean;
  onlyLyrics?: boolean;
  lyricsFile?: string;
  title?: string;
  artist?: string;
}

/** Fila simples em memória; o estado durável é o SQLite (jobs pendentes voltam no boot). */
export class JobQueue extends EventEmitter {
  private waiting: Job[] = [];
  private running = new Map<string, WorkerRun>();
  private cancelled = new Set<string>();

  constructor(
    private store: SongStore,
    private runner: WorkerRunner,
    private songsDir: string,
    private concurrency = 1,
  ) {
    super();
  }

  enqueue(job: Job): void {
    this.waiting = this.waiting.filter((j) => j.songId !== job.songId);
    this.waiting.push(job);
    this.publish(this.store.update(job.songId, { status: 'queued', stage: 'queued', progress: 0, message: 'Na fila', error: null }));
    this.pump();
  }

  cancel(songId: string): void {
    this.waiting = this.waiting.filter((j) => j.songId !== songId);
    const run = this.running.get(songId);
    if (run) {
      this.cancelled.add(songId);
      run.kill();
    }
  }

  isBusy(songId: string): boolean {
    return this.running.has(songId) || this.waiting.some((j) => j.songId === songId);
  }

  private publish(song: Song | undefined): void {
    if (song) this.emit('song', song);
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.waiting.length) {
      const job = this.waiting.shift()!;
      void this.execute(job);
    }
  }

  private args(job: Job): string[] {
    const out = path.join(this.songsDir, job.songId);
    const a: string[] = job.input ? [job.input] : [];
    a.push('--out', out);
    if (job.force) a.push('--force');
    if (job.onlyLyrics) a.push('--only', 'lyrics');
    if (job.lyricsFile) a.push('--lyrics-file', job.lyricsFile);
    if (job.title) a.push('--title', job.title);
    if (job.artist !== undefined) a.push('--artist', job.artist);
    return a;
  }

  private async execute(job: Job): Promise<void> {
    const { songId } = job;
    const run = this.runner.run(this.args(job), (ev) => {
      if (ev.event === 'progress') {
        this.publish(
          this.store.update(songId, {
            status: 'processing',
            stage: ev.stage as Stage,
            progress: ev.progress,
            message: ev.message ?? '',
          }),
        );
      }
    });
    this.running.set(songId, run);
    this.publish(this.store.update(songId, { status: 'processing', stage: 'downloading', message: 'Iniciando' }));
    try {
      const done = await run.promise;
      const meta = done.meta as Record<string, any>;
      const current = this.store.get(songId);
      this.publish(
        this.store.update(songId, {
          status: 'ready',
          stage: 'done',
          progress: 1,
          message: 'Pronto',
          error: null,
          // o que o usuário informou/editou tem prioridade sobre o detectado
          title: current?.title || meta.title || undefined,
          artist: current?.artist || meta.artist || undefined,
          duration: meta.duration ?? undefined,
          language: meta.language ?? undefined,
          lyrics_source: meta.lyrics_source ?? undefined,
          source_url: meta.source_url ?? undefined,
          has_cover: meta.has_cover ? 1 : undefined,
        }),
      );
      if (job.input && fs.existsSync(job.input) && job.input.startsWith(this.songsDir)) fs.rmSync(job.input, { force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.cancelled.has(songId)) {
        this.cancelled.delete(songId);
      } else {
        this.publish(this.store.update(songId, { status: 'error', message: 'Falhou', error: message }));
      }
    } finally {
      this.running.delete(songId);
      this.pump();
    }
  }
}
