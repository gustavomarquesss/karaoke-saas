import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import { SongStore, toView } from './db.js';
import { lyricsSchema, normalizeLyrics } from './lyrics.js';
import { JobQueue } from './queue.js';
import type { WorkerRunner } from './runner.js';
import { normalizeSourceUrl } from './url.js';

export interface AppDeps {
  config: Config;
  store: SongStore;
  runner: WorkerRunner;
}

const STEMS = new Set(['vocals', 'instrumental']);

export async function buildApp({ config, store, runner }: AppDeps): Promise<{ app: FastifyInstance; queue: JobQueue }> {
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  const queue = new JobQueue(store, runner, config.songsDir, config.concurrency);
  fs.mkdirSync(config.songsDir, { recursive: true });

  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024, files: 1 } });
  // Stems e capas, com suporte a Range (seek no <audio>).
  await app.register(fastifyStatic, { root: config.songsDir, prefix: '/files/', decorateReply: false, cacheControl: false, etag: true });

  const songDir = (id: string) => path.join(config.songsDir, id);
  const lyricsFile = (id: string) => path.join(songDir(id), 'lyrics.json');
  const newId = () => crypto.randomBytes(6).toString('hex');

  // Retoma o que estava pendente quando a API caiu.
  for (const s of store.pending()) {
    const upload = fs.existsSync(songDir(s.id)) ? fs.readdirSync(songDir(s.id)).find((f) => f.startsWith('upload.')) : undefined;
    queue.enqueue({ songId: s.id, input: upload ? path.join(songDir(s.id), upload) : (s.source_url ?? undefined) });
  }

  // ---------------------------------------------------------------- listagem / leitura
  app.get('/api/health', async () => ({ ok: true, python: fs.existsSync(config.workerPython), workerPython: config.workerPython }));

  app.get('/api/songs', async (req) => {
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    return store.list(q).map(toView);
  });

  app.get('/api/songs/:id', async (req, reply) => {
    const song = store.get((req.params as { id: string }).id);
    return song ? toView(song) : reply.code(404).send({ error: 'Música não encontrada' });
  });

  // ---------------------------------------------------------------- criação
  const createSchema = z.object({
    url: z.string().url(),
    title: z.string().optional(),
    artist: z.string().optional(),
    lyrics: z.string().optional(),
  });

  const startJob = (id: string, extra: { input?: string; title?: string; artist?: string; lyrics?: string; force?: boolean }) => {
    let lyricsPath: string | undefined;
    if (extra.lyrics?.trim()) {
      lyricsPath = path.join(songDir(id), 'lyrics_input.txt');
      fs.mkdirSync(songDir(id), { recursive: true });
      fs.writeFileSync(lyricsPath, extra.lyrics, 'utf8');
    }
    queue.enqueue({ songId: id, input: extra.input, title: extra.title, artist: extra.artist, lyricsFile: lyricsPath, force: extra.force });
  };

  app.post('/api/songs', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const key = normalizeSourceUrl(body.url);
    const existing = store.getByKey(key);
    if (existing) return reply.code(200).send({ ...toView(existing), duplicate: true });
    const song = store.insert({ id: newId(), source_key: key, source_url: body.url, title: body.title ?? '', artist: body.artist ?? '', title_locked: body.title ? 1 : 0 });
    startJob(song.id, { input: body.url, ...body });
    return reply.code(201).send(toView(store.get(song.id)!));
  });

  app.post('/api/songs/upload', async (req, reply) => {
    const id = newId();
    fs.mkdirSync(songDir(id), { recursive: true });
    const fields: Record<string, string> = {};
    let saved: string | undefined;
    let hash: string | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
        saved = path.join(songDir(id), `upload${ext}`);
        const h = crypto.createHash('sha1');
        part.file.on('data', (c: Buffer) => h.update(c));
        await pipeline(part.file, fs.createWriteStream(saved));
        hash = h.digest('hex');
        fields.filename ??= path.basename(part.filename, path.extname(part.filename));
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (!saved || !hash) {
      fs.rmSync(songDir(id), { recursive: true, force: true });
      return reply.code(400).send({ error: 'Envie um arquivo no campo "file"' });
    }
    const key = `file:${hash}`;
    const existing = store.getByKey(key);
    if (existing) {
      fs.rmSync(songDir(id), { recursive: true, force: true });
      return reply.code(200).send({ ...toView(existing), duplicate: true });
    }
    const title = fields.title || fields.filename || '';
    const song = store.insert({ id, source_key: key, source_url: null, title, artist: fields.artist ?? '', title_locked: fields.title ? 1 : 0 });
    startJob(id, { input: saved, title: fields.title, artist: fields.artist, lyrics: fields.lyrics });
    return reply.code(201).send(toView(store.get(song.id)!));
  });

  // ---------------------------------------------------------------- edição / ações
  app.patch('/api/songs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.get(id)) return reply.code(404).send({ error: 'Música não encontrada' });
    const body = z
      .object({ title: z.string().optional(), artist: z.string().optional(), offset_ms: z.number().int().min(-30000).max(30000).optional() })
      .parse(req.body);
    const edited = body.title !== undefined || body.artist !== undefined;
    const song = store.update(id, { ...body, ...(edited ? { title_locked: 1 } : {}) })!;
    queue.emit('song', song);
    return toView(song);
  });

  app.post('/api/songs/:id/reprocess', async (req, reply) => {
    const { id } = req.params as { id: string };
    const song = store.get(id);
    if (!song) return reply.code(404).send({ error: 'Música não encontrada' });
    if (queue.isBusy(id)) return reply.code(409).send({ error: 'Esta música já está sendo processada' });
    const { mode, lyrics } = z
      .object({ mode: z.enum(['all', 'lyrics']).default('all'), lyrics: z.string().optional() })
      .parse(req.body ?? {});
    const hasOriginal = fs.existsSync(path.join(songDir(id), 'original.wav'));
    if (mode === 'lyrics') {
      queue.enqueue({ songId: id, onlyLyrics: true, lyricsFile: writeLyricsInput(id, lyrics) });
    } else {
      // sem o original.wav precisa baixar de novo
      queue.enqueue({ songId: id, force: true, input: hasOriginal ? undefined : (song.source_url ?? undefined), lyricsFile: writeLyricsInput(id, lyrics) });
    }
    return toView(store.get(id)!);
  });

  function writeLyricsInput(id: string, text?: string): string | undefined {
    if (!text?.trim()) return undefined;
    const p = path.join(songDir(id), 'lyrics_input.txt');
    fs.writeFileSync(p, text, 'utf8');
    return p;
  }

  app.delete('/api/songs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.get(id)) return reply.code(404).send({ error: 'Música não encontrada' });
    queue.cancel(id);
    store.delete(id);
    queue.emit('deleted', id);
    fs.rmSync(songDir(id), { recursive: true, force: true });
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- letra
  app.get('/api/songs/:id/lyrics', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!fs.existsSync(lyricsFile(id))) return reply.code(404).send({ error: 'Esta música ainda não tem letra' });
    return JSON.parse(fs.readFileSync(lyricsFile(id), 'utf8'));
  });

  app.put('/api/songs/:id/lyrics', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.get(id)) return reply.code(404).send({ error: 'Música não encontrada' });
    const lyrics = normalizeLyrics(lyricsSchema.parse(req.body));
    fs.mkdirSync(songDir(id), { recursive: true });
    fs.writeFileSync(lyricsFile(id), JSON.stringify(lyrics, null, 2), 'utf8');
    store.update(id, { lyrics_source: 'manual' });
    return lyrics;
  });

  // ---------------------------------------------------------------- export MP4
  let exporting = false;
  const exportSchema = z.object({
    vocal: z.number().min(0).max(1).default(0),
    instrumental: z.number().min(0).max(1).default(1),
    semitones: z.number().int().min(-12).max(12).default(0),
    tempo: z.number().min(0.5).max(1.5).default(1),
    size: z.enum(['1280x720', '1920x1080']).default('1280x720'),
  });

  app.post('/api/songs/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const song = store.get(id);
    if (!song) return reply.code(404).send({ error: 'Música não encontrada' });
    if (song.status !== 'ready' || !fs.existsSync(lyricsFile(id))) return reply.code(409).send({ error: 'A música precisa estar pronta e ter letra para exportar' });
    if (exporting) return reply.code(409).send({ error: 'Já há uma exportação em andamento' });
    const o = exportSchema.parse(req.body ?? {});
    const safe = (song.title || 'karaoke').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'karaoke';
    const name = `${safe}_${Date.now()}.mp4`;
    const out = path.join(songDir(id), 'exports', name);
    exporting = true;
    try {
      await runner.run(
        [songDir(id), '--out', out, '--vocal', String(o.vocal), '--instrumental', String(o.instrumental), '--semitones', String(o.semitones),
         '--tempo', String(o.tempo), '--offset-ms', String(song.offset_ms), '--size', o.size, '--title', [song.artist, song.title].filter(Boolean).join(' — ')],
        () => {},
        'worker.export',
      ).promise;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      exporting = false;
    }
    return { name, url: `/files/${id}/exports/${encodeURIComponent(name)}` };
  });

  app.get('/api/songs/:id/exports', async (req) => {
    const dir = path.join(songDir((req.params as { id: string }).id), 'exports');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => ({ name: f, url: `/files/${(req.params as { id: string }).id}/exports/${encodeURIComponent(f)}`, size: fs.statSync(path.join(dir, f)).size }));
  });

  // ---------------------------------------------------------------- gravações (voz + instrumental)
  app.addContentTypeParser(['audio/wav', 'audio/x-wav'], { parseAs: 'buffer', bodyLimit: 400 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  const recordingsDir = (id: string) => path.join(songDir(id), 'recordings');
  const listRecordings = (id: string) =>
    fs.existsSync(recordingsDir(id))
      ? fs
          .readdirSync(recordingsDir(id))
          .filter((f) => f.endsWith('.wav'))
          .sort()
          .reverse()
          .map((f) => ({ name: f, url: `/files/${id}/recordings/${encodeURIComponent(f)}`, size: fs.statSync(path.join(recordingsDir(id), f)).size }))
      : [];

  app.post('/api/songs/:id/recordings', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.get(id)) return reply.code(404).send({ error: 'Música não encontrada' });
    if (!Buffer.isBuffer(req.body) || req.body.length < 44) return reply.code(400).send({ error: 'Envie o WAV no corpo (Content-Type: audio/wav)' });
    const name = `take-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
    fs.mkdirSync(recordingsDir(id), { recursive: true });
    fs.writeFileSync(path.join(recordingsDir(id), name), req.body);
    return reply.code(201).send(listRecordings(id).find((r) => r.name === name));
  });

  app.get('/api/songs/:id/recordings', async (req) => listRecordings((req.params as { id: string }).id));

  app.delete('/api/songs/:id/recordings/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const file = path.join(recordingsDir(id), path.basename(name));
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'Gravação não encontrada' });
    fs.rmSync(file);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- áudio por stem (alias para /files)
  app.get('/api/songs/:id/audio/:stem', async (req, reply) => {
    const { id, stem } = req.params as { id: string; stem: string };
    if (!STEMS.has(stem)) return reply.code(400).send({ error: 'stem inválido' });
    return reply.redirect(`/files/${id}/${stem}.wav`, 307);
  });

  // ---------------------------------------------------------------- SSE
  app.get('/api/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('hello', { ok: true });
    const onSong = (song: Parameters<typeof toView>[0]) => send('song', toView(song));
    const onDeleted = (id: string) => send('deleted', { id });
    queue.on('song', onSong);
    queue.on('deleted', onDeleted);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.raw.on('close', () => {
      clearInterval(ping);
      queue.off('song', onSong);
      queue.off('deleted', onDeleted);
    });
  });

  // ---------------------------------------------------------------- frontend buildado (produção)
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/', decorateReply: false, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/files')) return reply.code(404).send({ error: 'Não encontrado' });
      return reply.type('text/html').send(fs.createReadStream(path.join(config.webDist, 'index.html')));
    });
  }

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Dados inválidos', details: err.issues });
    const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    return reply.code(code).send({ error: err.message });
  });

  return { app, queue };
}
