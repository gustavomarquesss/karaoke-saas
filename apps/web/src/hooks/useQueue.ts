import { useCallback, useEffect, useState } from 'react';
import { addToQueue, loadQueue, moveInQueue, removeFromQueue, saveQueue } from '../lib/queue';

/** Fila compartilhada entre componentes (e abas) via localStorage + evento. */
export function useQueue() {
  const [queue, setQueue] = useState<string[]>(loadQueue);

  useEffect(() => {
    const sync = () => setQueue(loadQueue());
    window.addEventListener('karaoke:queue', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('karaoke:queue', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const update = useCallback((fn: (q: string[]) => string[]) => saveQueue(fn(loadQueue())), []);

  return {
    queue,
    add: useCallback((id: string) => update((q) => addToQueue(q, id)), [update]),
    remove: useCallback((id: string) => update((q) => removeFromQueue(q, id)), [update]),
    move: useCallback((id: string, d: -1 | 1) => update((q) => moveInQueue(q, id, d)), [update]),
    clear: useCallback(() => saveQueue([]), []),
  };
}
