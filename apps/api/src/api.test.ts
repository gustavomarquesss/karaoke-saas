import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type { Config } from './config.js';
import { SongStore } from './db.js';
import type { WorkerEvent, WorkerRunner } from './runner.js';
import { normalizeSourceUrl } from './url.js';

/** Runner falso: simula o worker escrevendo os arquivos e emitindo progresso. */
const fakeRunner: WorkerRunner = {
  run(args, onEvent) {
    const out = args[args.indexOf('--out') + 1];
    const promise = (async () => {
      fs.mkdirSync(out, { recursive: true });
      onEvent({ event: 'progress', stage: 'separating', progress: 0.3, message: 'x' });
      await new Promise((r) => setTimeout(r, 20));
      fs.writeFileSync(path.join(out, 'lyrics.json'), JSON.stringify({ language: 'pt', source: 'lrclib', lines: [] }));
      const done: Extract<WorkerEvent, { event: 'done' }> = {
        event: 'done',
        seconds: 1,
        out,
        meta: { title: 'Detectado', artist: 'Banda', duration: 123.4, language: 'pt', lyrics_source: 'lrclib' },
      };
      return done;
    })();
    return { promise, kill() {} };
  },
};

describe('normalizeSourceUrl', () => {
  it('unifica variações de URL do YouTube', () => {
    const id = 'yt:dQw4w9WgXcQ';
    assert.equal(normalizeSourceUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s'), id);
    assert.equal(normalizeSourceUrl('https://youtu.be/dQw4w9WgXcQ?si=abc'), id);
    assert.equal(normalizeSourceUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), id);
  });
});

describe('API', () => {
  let app: FastifyInstance;
  let tmp: string;

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-test-'));
    const config: Config = {
      port: 0,
      dataDir: tmp,
      songsDir: path.join(tmp, 'songs'),
      workerPython: 'python',
      concurrency: 1,
      webDist: path.join(tmp, 'nope'),
    };
    ({ app } = await buildApp({ config, store: new SongStore(':memory:'), runner: fakeRunner }));
  });
  after(async () => {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const waitReady = async (id: string) => {
    for (let i = 0; i < 50; i++) {
      const song = (await app.inject({ method: 'GET', url: `/api/songs/${id}` })).json();
      if (song.status === 'ready' || song.status === 'error') return song;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timeout');
  };

  it('cria música a partir de URL, processa e preenche metadados', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/songs', payload: { url: 'https://youtu.be/abcdefghijk' } });
    assert.equal(res.statusCode, 201);
    const song = await waitReady(res.json().id);
    assert.equal(song.status, 'ready');
    assert.equal(song.title, 'Detectado');
    assert.equal(song.duration, 123.4);
    assert.equal(song.source_key, undefined, 'não vaza a chave interna');
  });

  it('não reprocessa a mesma URL (cache)', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/songs', payload: { url: 'https://www.youtube.com/watch?v=abcdefghijk' } });
    assert.equal(a.statusCode, 200);
    assert.equal(a.json().duplicate, true);
  });

  it('rejeita URL inválida', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/songs', payload: { url: 'nao-e-url' } });
    assert.equal(res.statusCode, 400);
  });

  it('busca por título/artista', async () => {
    const hit = (await app.inject({ method: 'GET', url: '/api/songs?q=banda' })).json();
    assert.equal(hit.length, 1);
    const miss = (await app.inject({ method: 'GET', url: '/api/songs?q=zzz' })).json();
    assert.equal(miss.length, 0);
  });

  it('salva offset e valida limites', async () => {
    const [song] = (await app.inject({ method: 'GET', url: '/api/songs' })).json();
    const ok = await app.inject({ method: 'PATCH', url: `/api/songs/${song.id}`, payload: { offset_ms: -250 } });
    assert.equal(ok.json().offset_ms, -250);
    const bad = await app.inject({ method: 'PATCH', url: `/api/songs/${song.id}`, payload: { offset_ms: 999999 } });
    assert.equal(bad.statusCode, 400);
  });

  it('salva e lê a letra normalizada', async () => {
    const [song] = (await app.inject({ method: 'GET', url: '/api/songs' })).json();
    const put = await app.inject({
      method: 'PUT',
      url: `/api/songs/${song.id}/lyrics`,
      payload: {
        language: 'pt',
        lines: [
          { start: 5, end: 6, words: [{ text: 'dois', start: 5, end: 6 }] },
          { start: 1, end: 2, words: [{ text: ' um ', start: 1, end: 2 }] },
          { start: 9, end: 9, words: [] },
        ],
      },
    });
    assert.equal(put.statusCode, 200);
    const got = (await app.inject({ method: 'GET', url: `/api/songs/${song.id}/lyrics` })).json();
    assert.deepEqual(got.lines.map((l: any) => l.text), ['um', 'dois']);
  });

  it('serve stems com suporte a Range', async () => {
    const [song] = (await app.inject({ method: 'GET', url: '/api/songs' })).json();
    fs.writeFileSync(path.join(tmp, 'songs', song.id, 'instrumental.wav'), Buffer.alloc(1000, 1));
    const res = await app.inject({ method: 'GET', url: `/files/${song.id}/instrumental.wav`, headers: { range: 'bytes=0-99' } });
    assert.equal(res.statusCode, 206);
    assert.equal(res.rawPayload.length, 100);
  });

  it('exclui música e arquivos', async () => {
    const [song] = (await app.inject({ method: 'GET', url: '/api/songs' })).json();
    const res = await app.inject({ method: 'DELETE', url: `/api/songs/${song.id}` });
    assert.equal(res.statusCode, 204);
    assert.equal(fs.existsSync(path.join(tmp, 'songs', song.id)), false);
    assert.equal((await app.inject({ method: 'GET', url: `/api/songs/${song.id}` })).statusCode, 404);
  });
});
