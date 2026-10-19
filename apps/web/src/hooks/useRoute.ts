import { useEffect, useState } from 'react';

export type Route = { name: 'library' } | { name: 'play'; id: string } | { name: 'edit'; id: string };

export function parseHash(hash: string): Route {
  const [, kind, id] = hash.replace(/^#/, '').split('/');
  if (kind === 'play' && id) return { name: 'play', id };
  if (kind === 'edit' && id) return { name: 'edit', id };
  return { name: 'library' };
}

export const hrefs = {
  library: '#/',
  play: (id: string) => `#/play/${id}`,
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
