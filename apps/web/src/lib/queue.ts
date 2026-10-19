/** Fila de músicas (ids), guardada no localStorage. Funções puras + persistência tolerante a falhas. */

const KEY = 'karaoke:queue';

export const addToQueue = (queue: string[], id: string): string[] => (queue.includes(id) ? queue : [...queue, id]);

export const removeFromQueue = (queue: string[], id: string): string[] => queue.filter((x) => x !== id);

export function moveInQueue(queue: string[], id: string, delta: -1 | 1): string[] {
  const i = queue.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= queue.length) return queue;
  const next = queue.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Música que toca depois de `currentId`; null se ela não está na fila ou é a última. */
export function nextInQueue(queue: string[], currentId: string): string | null {
  const i = queue.indexOf(currentId);
  return i >= 0 && i + 1 < queue.length ? queue[i + 1] : null;
}

export function loadQueue(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveQueue(queue: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    /* ignora */
  }
  window.dispatchEvent(new Event('karaoke:queue'));
}
