#!/usr/bin/env node
// Executa o Python do venv do worker: node scripts/py.mjs -m pytest worker -q
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const py = path.join(root, 'worker', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!fs.existsSync(py)) {
  console.error('venv do worker não existe. Rode: npm run setup');
  process.exit(1);
}
process.exit(spawnSync(py, process.argv.slice(2), { stdio: 'inherit', cwd: root }).status ?? 1);
