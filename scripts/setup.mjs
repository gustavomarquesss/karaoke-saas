#!/usr/bin/env node
// Prepara o ambiente do worker Python (venv + torch + dependências) e o .env.
//   npm run setup            instala tudo
//   npm run doctor           só diagnostica (node scripts/setup.mjs --check)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENV = path.join(ROOT, 'worker', '.venv');
const win = process.platform === 'win32';
const venvPython = path.join(VENV, win ? 'Scripts/python.exe' : 'bin/python');
const checkOnly = process.argv.includes('--check');
const TORCH = 'torch==2.8.0';
const TORCHAUDIO = 'torchaudio==2.8.0';

const log = (m) => console.log(`\n\x1b[36m▸ ${m}\x1b[0m`);
const fail = (m) => {
  console.error(`\n\x1b[31m✖ ${m}\x1b[0m`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: false, ...opts });
  return r.status === 0;
}
function probe(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false });
  return r.status === 0 ? (r.stdout || r.stderr).trim() : null;
}

// ---------------------------------------------------------------- Node
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) fail(`Node ${process.versions.node} é antigo: use 22.13 ou superior (a API usa node:sqlite).`);

if (checkOnly) {
  console.log(`node          ${process.versions.node}`);
  console.log(`ffmpeg        ${probe('ffmpeg', ['-version'])?.split('\n')[0] ?? '(do sistema não encontrado; o worker usa o do imageio-ffmpeg)'}`);
  if (!fs.existsSync(venvPython)) fail('venv do worker não existe. Rode: npm run setup');
  process.exit(run(venvPython, ['-m', 'worker.doctor']) ? 0 : 1);
}

// ---------------------------------------------------------------- Python
// As libs de IA ainda não rodam bem no Python 3.13/3.14. Se não houver 3.11/3.12, usamos o `uv`,
// que baixa o Python certo sozinho (instalamos o uv com pip --user se faltar).
const anyPython = (win ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]]).find(([c, pre]) => probe(c, [...pre, '--version']));
let uvCmd = probe('uv', ['--version']) ? ['uv'] : null;
let pythonForVenv = null;
if (!fs.existsSync(venvPython)) {
  const candidates = win ? [['py', ['-3.12']], ['py', ['-3.11']]] : [['python3.12', []], ['python3.11', []], ['python3', []]];
  for (const [cmd, pre] of candidates) {
    const v = probe(cmd, [...pre, '-c', 'import sys;print("%d.%d"%sys.version_info[:2])']);
    if (v && ['3.11', '3.12'].includes(v)) {
      pythonForVenv = [cmd, pre];
      break;
    }
  }
  if (!pythonForVenv && !uvCmd) {
    if (!anyPython) fail('Python não encontrado. Instale o Python 3.12 (https://www.python.org/downloads/) e rode de novo.');
    log('Python 3.11/3.12 não encontrado: instalando o "uv" (gerenciador que baixa o Python certo)');
    const [c, pre] = anyPython;
    if (!run(c, [...pre, '-m', 'pip', 'install', '--user', '--quiet', 'uv'])) fail('Não consegui instalar o uv. Instale o Python 3.12 manualmente.');
    uvCmd = [c, ...pre, '-m', 'uv'];
  }
  log(`Criando o ambiente virtual em worker/.venv ${pythonForVenv ? '' : '(uv, Python 3.12)'}`);
  const ok = pythonForVenv
    ? run(pythonForVenv[0], [...pythonForVenv[1], '-m', 'venv', VENV])
    : run(uvCmd[0], [...uvCmd.slice(1), 'venv', VENV, '--python', '3.12']);
  if (!ok) fail('Falha ao criar o venv.');
} else if (!uvCmd) {
  // venv existente: se o uv estiver disponível via pip, ele acelera a instalação, mas não é obrigatório
  uvCmd = anyPython && probe(anyPython[0], [...anyPython[1], '-m', 'uv', '--version']) ? [anyPython[0], ...anyPython[1], '-m', 'uv'] : null;
}

const pip = (args) =>
  uvCmd ? run(uvCmd[0], [...uvCmd.slice(1), 'pip', 'install', '--python', venvPython, ...args]) : run(venvPython, ['-m', 'pip', 'install', ...args]);

// ---------------------------------------------------------------- torch
const hasNvidia = !!probe('nvidia-smi', ['-L']);
log(hasNvidia ? 'GPU NVIDIA detectada: instalando PyTorch com CUDA 12.8 (download grande, ~3 GB)' : win || process.platform === 'linux' ? 'Sem GPU NVIDIA: instalando PyTorch para CPU' : 'Instalando PyTorch (macOS: usa MPS quando disponível)');
let torchArgs = [TORCH, TORCHAUDIO];
if (hasNvidia) torchArgs.push('--index-url', 'https://download.pytorch.org/whl/cu128');
else if (win || process.platform === 'linux') torchArgs.push('--index-url', 'https://download.pytorch.org/whl/cpu');
if (!pip(torchArgs)) fail('Falha ao instalar o PyTorch.');

log('Instalando Demucs, WhisperX, yt-dlp e demais dependências');
if (!pip(['-r', path.join(ROOT, 'worker', 'requirements.txt')])) fail('Falha ao instalar as dependências do worker.');

// ---------------------------------------------------------------- .env
const envFile = path.join(ROOT, '.env');
if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(ROOT, '.env.example'), envFile);
  console.log('Criei o .env a partir do .env.example');
}

log('Verificando a instalação');
run(venvPython, ['-m', 'worker.doctor']);
console.log('\n\x1b[32m✔ Pronto. Rode: npm run dev\x1b[0m  (o primeiro processamento baixa os modelos de IA, ~3–4 GB)');
