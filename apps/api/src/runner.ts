import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';

export type WorkerEvent =
  | { event: 'info'; device: string }
  | { event: 'progress'; stage: string; progress: number; message?: string }
  | { event: 'done'; seconds: number; meta: Record<string, unknown>; out: string }
  | { event: 'error'; message: string };

export interface WorkerRun {
  promise: Promise<Extract<WorkerEvent, { event: 'done' }>>;
  kill: () => void;
}

export interface WorkerRunner {
  run(args: string[], onEvent: (e: WorkerEvent) => void): WorkerRun;
}

/** Executa `python -m worker.process ...` e traduz o stdout (JSON por linha) em eventos. */
export function pythonRunner(python: string, cwd: string): WorkerRunner {
  return {
    run(args, onEvent) {
      const child: ChildProcess = spawn(python, ['-u', '-m', 'worker.process', ...args], {
        cwd,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let done: Extract<WorkerEvent, { event: 'done' }> | undefined;
      let lastError: string | undefined;
      const stderrTail: string[] = [];

      readline.createInterface({ input: child.stdout! }).on('line', (line) => {
        try {
          const ev = JSON.parse(line) as WorkerEvent;
          if (ev.event === 'done') done = ev;
          if (ev.event === 'error') lastError = ev.message;
          onEvent(ev);
        } catch {
          /* linha que não é JSON: ignora */
        }
      });
      readline.createInterface({ input: child.stderr! }).on('line', (line) => {
        stderrTail.push(line);
        if (stderrTail.length > 40) stderrTail.shift();
        if (process.env.WORKER_VERBOSE) console.error(`[worker] ${line}`);
      });

      const promise = new Promise<Extract<WorkerEvent, { event: 'done' }>>((resolve, reject) => {
        child.on('error', (err) => reject(new Error(`Não consegui iniciar o worker (${python}): ${err.message}`)));
        child.on('close', (code, signal) => {
          if (code === 0 && done) return resolve(done);
          if (signal) return reject(new Error('Processamento cancelado'));
          reject(new Error(lastError ?? `Worker saiu com código ${code}\n${stderrTail.slice(-8).join('\n')}`));
        });
      });
      return { promise, kill: () => child.kill() };
    },
  };
}
