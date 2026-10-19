/** Chave estável para detectar a mesma música: vídeos do YouTube viram `yt:<id>`. */
export function normalizeSourceUrl(raw: string): string {
  const url = new URL(raw);
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    if (id) return `yt:${id}`;
  }
  if (host === 'youtube.com') {
    const v = url.searchParams.get('v');
    if (v) return `yt:${v}`;
    const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
    if (m) return `yt:${m[1]}`;
  }
  url.hash = '';
  return `url:${url.toString()}`;
}
