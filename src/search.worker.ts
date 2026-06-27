import Fuse from 'fuse.js';

interface WorkerIcon {
  name: string;
  style: string;
  path: string;
}

let fuse: Fuse<WorkerIcon> | null = null;

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'init') {
    fuse = new Fuse(payload.icons, payload.options);
    self.postMessage({ type: 'ready' });
  } else if (type === 'search') {
    if (!fuse) return;
    const results = fuse.search(payload.query, { limit: 500 }).map(r => r.item);
    self.postMessage({ type: 'results', results, query: payload.query });
  }
};
