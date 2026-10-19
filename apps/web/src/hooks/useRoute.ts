import { useEffect, useState } from 'react';

export type Route = { name: 'library' } | { name: 'play'; id: string; autoplay: boolean } | { name: 'edit'; id: string };

export function parseHash(hash: string): Route {
  const [, kind, id, flag] = hash.replace(/^#/, '').split('/');
  if (kind === 'play' && id) return { name: 'play', id, autoplay: flag === 'auto' };
  if (kind === 'edit' && id) return { name: 'edit', id };
  return { name: 'library' };
}

export const hrefs = {
  library: '#/',
  /** `autoplay` começa a tocar sozinho (usado ao avançar na fila). */
  play: (id: string, autoplay = false) => `#/play/${id}${autoplay ? '/auto' : ''}`,
  edit: (id: string) => `#/edit/${id}`,
};

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
