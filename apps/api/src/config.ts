import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface Config {
  port: number;
  dataDir: string;
  songsDir: string;
  workerPython: string;
  concurrency: number;
  /** Pasta com o build do frontend (servido pela API em produção). */
  webDist: string;
}

const resolveFromRoot = (p: string) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolveFromRoot(env.DATA_DIR || './data');
  const defaultPython = process.platform === 'win32' ? 'worker/.venv/Scripts/python.exe' : 'worker/.venv/bin/python';
  return {
    port: Number(env.API_PORT || 3001),
    dataDir,
    songsDir: path.join(dataDir, 'songs'),
    workerPython: resolveFromRoot(env.WORKER_PYTHON || defaultPython),
    concurrency: Math.max(1, Number(env.JOB_CONCURRENCY || 1)),
    webDist: path.join(ROOT, 'apps/web/dist'),
  };
}
