import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig, ROOT } from './config.js';
import { SongStore } from './db.js';
import { pythonRunner } from './runner.js';

const config = loadConfig();
const store = new SongStore(path.join(config.dataDir, 'karaoke.db'));
const { app } = await buildApp({ config, store, runner: pythonRunner(config.workerPython, ROOT) });

await app.listen({ port: config.port, host: '127.0.0.1' });
console.log(`API do karaokê em http://localhost:${config.port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    store.close();
    process.exit(0);
  });
}
