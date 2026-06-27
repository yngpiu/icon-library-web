import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  memo,
  lazy,
  Suspense,
  startTransition,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDebounce } from 'use-debounce';
import './App.css';

// Types
interface Icon {
  name: string;
  category: string;
  style: string;
  path: string;
  content: string;
  collection: string;
}

// Constants
const ICONS_PER_ROW = 9;
const ROW_HEIGHT = 120;
const FUSE_OPTIONS = {
  keys: ['name'],
  threshold: 0.3,
  ignoreLocation: true,
  useExtendedSearch: false,
  findAllMatches: false,
};

// Collection cache + content cache
const cache = new Map<string, Icon[]>();
const contentCache = new Map<string, (string | null)[]>();

// Memoized Icon Card - prevents re-renders
const IconCard = memo(
  function IconCard({
    icon,
    onSelect,
  }: {
    icon: Icon;
    onSelect: (icon: Icon) => void;
  }) {
    return (
      <div className="icon-card" onClick={() => onSelect(icon)}>
        {icon.content ? (
          <div
            className="icon-svg"
            dangerouslySetInnerHTML={{ __html: icon.content }}
          />
        ) : (
          <div className="icon-frame" />
        )}
        <span className="icon-name">{icon.name}</span>
      </div>
    );
  },
  (prev, next) =>
    prev.icon.path === next.icon.path && prev.icon.content === next.icon.content
);

// Memoized Grid Row
const GridRow = memo(function GridRow({
  icons,
  onSelect,
  style,
}: {
  icons: Icon[];
  onSelect: (icon: Icon) => void;
  style: React.CSSProperties;
}) {
  return (
    <div className="grid-row" style={style}>
      {icons.map(icon => (
        <IconCard key={icon.path} icon={icon} onSelect={onSelect} />
      ))}
    </div>
  );
});

// Lazy load modal for code splitting
const IconModal = lazy(() => import('./IconModal'));

function App() {
  const [icons, setIcons] = useState<Icon[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [collection, setCollection] = useState('');
  const [search, setSearch] = useState('');
  const [style, setStyle] = useState('all');
  const [selected, setSelected] = useState<Icon | null>(null);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [debouncedSearch] = useDebounce(search, 150);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchWorkerRef = useRef<Worker | null>(null);
  const [searchResults, setSearchResults] = useState<Icon[] | null>(null);
  // Chunk loading state (refs to avoid re-render cycles on scroll)
  const chunkMetaRef = useRef<Icon[]>([]);
  const chunkPartialRef = useRef<(string | null)[]>([]);
  const chunkCountRef = useRef(0);
  const chunkLoadedRef = useRef(new Set<number>());

  // Load manifest
  useEffect(() => {
    fetch('/icons/manifest.json')
      .then(r => r.json())
      .then(data => {
        setCollections(data.collections);
        if (data.collections.length > 0) {
          setCollection(data.collections[0]);
        }
      });
  }, []);

  // Init search worker
  useEffect(() => {
    const worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
    searchWorkerRef.current = worker;
    worker.onmessage = (e: MessageEvent) => {
      const { type, results } = e.data;
      if (type === 'results') {
        setSearchResults(results);
      }
    };
    return () => {
      worker.terminate();
      searchWorkerRef.current = null;
    };
  }, []);

  // Send search query to worker
  useEffect(() => {
    if (!searchWorkerRef.current) return;
    if (!debouncedSearch) {
      setSearchResults(null);
      return;
    }
    searchWorkerRef.current.postMessage({
      type: 'search',
      payload: { query: debouncedSearch },
    });
  }, [debouncedSearch]);

  // Load collection metadata + content in background
  useEffect(() => {
    if (!collection) return;
    let cancelled = false;

    const cached = cache.get(collection);
    if (cached) {
      setIcons(cached);
      setLoading(false);
      searchWorkerRef.current?.postMessage({
        type: 'init',
        payload: {
          icons: cached.map(({ name, style, path }) => ({ name, style, path })),
          options: FUSE_OPTIONS,
        },
      });
      setSearchResults(null);
      return;
    }

    setLoading(true);

    const load = async () => {
      // Step 1: fetch metadata (no content) — fast
      const metaRes = await fetch(`/icons/${collection}.json`);
      const meta: Icon[] = await metaRes.json();
      if (cancelled) return;

      const iconsNoContent = meta.map(i => ({ ...i, content: '' }));
      cache.set(collection, iconsNoContent);
      setIcons(iconsNoContent);
      setLoading(false);

      searchWorkerRef.current?.postMessage({
        type: 'init',
        payload: {
          icons: meta.map(({ name, style, path }) => ({ name, style, path })),
          options: FUSE_OPTIONS,
        },
      });
      setSearchResults(null);

      // Step 2: load content chunks progressively
      const cachedContent = contentCache.get(collection);
      if (cachedContent) {
        const fullIcons = meta.map((icon, i) => ({
          ...icon,
          content: cachedContent[i] || '',
        }));
        chunkPartialRef.current = cachedContent;
        cache.set(collection, fullIcons);
        setIcons(fullIcons);
      } else {
        const idxRes = await fetch(`/icons/${collection}.content.idx.json`);
        const idx = await idxRes.json();
        if (cancelled) return;
        const partial: (string | null)[] = new Array(idx.size).fill(null);
        contentCache.set(collection, partial);
        chunkPartialRef.current = partial;
        chunkCountRef.current = idx.count;
        chunkLoadedRef.current = new Set();
        chunkMetaRef.current = meta;

        // Helper to load a chunk and merge into icons
        const loadChunk = async (i: number) => {
          if (chunkLoadedRef.current.has(i)) return;
          chunkLoadedRef.current.add(i);
          const chunkRes = await fetch(`/icons/${collection}.content.${i}.json`);
          const chunk: string[] = await chunkRes.json();
          if (cancelled) return;
          for (let j = 0; j < chunk.length; j++) {
            partial[i * 1000 + j] = chunk[j];
          }
          const fullIcons = meta.map((icon, k) => ({
            ...icon,
            content: partial[k] || '',
          }));
          cache.set(collection, fullIcons);
          setIcons(fullIcons);
        };

        // Load first 2 chunks (viewport + scroll buffer)
        await loadChunk(0);
        if (idx.count > 1) loadChunk(1);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [collection]);

  // Pre-compute styles + path index for faster filtering
  const { styles, styleIndex, iconByPath } = useMemo(() => {
    const styleSet = new Set<string>();
    const index = new Map<string, Icon[]>();

    for (const icon of icons) {
      styleSet.add(icon.style);
      const arr = index.get(icon.style) || [];
      arr.push(icon);
      index.set(icon.style, arr);
    }

    const pathIndex = new Map<string, Icon>();
    for (const icon of icons) {
      pathIndex.set(icon.path, icon);
    }

    return {
      styles: ['all', ...Array.from(styleSet).sort()],
      styleIndex: index,
      iconByPath: pathIndex,
    };
  }, [icons]);

  // Optimized filtering with pre-computed index
  const filtered = useMemo(() => {
    if (debouncedSearch && searchResults) {
      // Map worker results (metadata-only) back to full icons with content
      const result = searchResults
        .map(sr => iconByPath.get(sr.path))
        .filter(Boolean) as Icon[];

      if (style !== 'all') {
        return result.filter(i => i.style === style);
      }
      return result;
    }

    if (style !== 'all') {
      return styleIndex.get(style) || [];
    }

    return icons;
  }, [icons, debouncedSearch, style, styleIndex, iconByPath, searchResults]);

  // Pre-compute rows
  const rows = useMemo(() => {
    const result: Icon[][] = [];
    for (let i = 0; i < filtered.length; i += ICONS_PER_ROW) {
      result.push(filtered.slice(i, i + ICONS_PER_ROW));
    }
    return result;
  }, [filtered]);

  // TanStack Virtual with optimized settings
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5, // Pre-render extra rows for smoother scroll
  });

  // Lazy-load content chunks on scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const loadingChunks = new Set<number>();
    const loadChunk = async (i: number, col: string) => {
      const res = await fetch(`/icons/${col}.content.${i}.json`);
      const chunk: string[] = await res.json();
      const partial = chunkPartialRef.current;
      const meta = chunkMetaRef.current;
      if (meta.length === 0) return;
      for (let j = 0; j < chunk.length; j++) {
        partial[i * 1000 + j] = chunk[j];
      }
      chunkLoadedRef.current.add(i);
      loadingChunks.delete(i);
      const fullIcons = meta.map((icon, k) => ({
        ...icon,
        content: partial[k] || '',
      }));
      cache.set(col, fullIcons);
      setIcons(fullIcons);
    };
    const onScroll = () => {
      const ct = chunkCountRef.current;
      const loaded = chunkLoadedRef.current;
      const col = collection;
      if (ct === 0 || loaded.size === 0) return;
      const viewportStart = Math.floor(el.scrollTop / ROW_HEIGHT);
      const viewportEnd = Math.ceil((el.scrollTop + el.clientHeight) / ROW_HEIGHT);
      const startChunk = Math.floor(viewportStart * ICONS_PER_ROW / 1000);
      const endChunk = Math.ceil(viewportEnd * ICONS_PER_ROW / 1000);
      const preloadUpTo = Math.min(endChunk + 1, ct - 1);
      for (let c = startChunk; c <= preloadUpTo; c++) {
        if (!loaded.has(c) && !loadingChunks.has(c)) {
          loadingChunks.add(c);
          loadChunk(c, col);
        }
      }
    };
    onScroll(); // Check initial viewport
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [collection, loading]);

  // Reset style when collection changes
  useEffect(() => {
    startTransition(() => {
      setStyle('all');
    });
  }, [collection]);

  // Close dropdown on outside click (passive)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.collection-dropdown')) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClick, { passive: true });
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Memoized handlers
  const formatName = useCallback((name: string) => {
    return name
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }, []);

  const handleCollectionChange = useCallback((c: string) => {
    startTransition(() => {
      setCollection(c);
    });
    setDropdownOpen(false);
  }, []);

  const handleStyleChange = useCallback((s: string) => {
    startTransition(() => {
      setStyle(s);
    });
  }, []);

  const handleSelect = useCallback((icon: Icon) => {
    setSelected(icon);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelected(null);
  }, []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleClearSearch = useCallback(() => {
    setSearch('');
  }, []);

  const toggleDropdown = useCallback(() => {
    setDropdownOpen(prev => !prev);
  }, []);

  // Preload collection data on hover for instant switching
  const preloadCollection = useCallback(async (name: string) => {
    if (cache.has(name) || !name) return;
    try {
      const metaRes = await fetch(`/icons/${name}.json`);
      const meta: Icon[] = await metaRes.json();
      const iconsNoContent = meta.map(i => ({ ...i, content: '' }));
      cache.set(name, iconsNoContent);

      const idxRes = await fetch(`/icons/${name}.content.idx.json`);
      const idx = await idxRes.json();
      if (meta.length !== idx.size) return;
      const partial: (string | null)[] = new Array(idx.size).fill(null);
      contentCache.set(name, partial);
      for (let i = 0; i < idx.count; i++) {
        const chunkRes = await fetch(`/icons/${name}.content.${i}.json`);
        const chunk: string[] = await chunkRes.json();
        for (let j = 0; j < chunk.length; j++) {
          partial[i * 1000 + j] = chunk[j];
        }
      }
      const fullIcons = meta.map((icon, k) => ({
        ...icon,
        content: partial[k] || '',
      }));
      cache.set(name, fullIcons);
    } catch {
      // Silently fail — normal load on click
    }
  }, []);

  // Get virtual items once
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="search-box">
            <input
              type="text"
              value={search}
              onChange={handleSearchChange}
              placeholder={`Search ${formatName(collection)}...`}
              disabled={loading}
            />
            {search ? (
              <button className="clear-btn" onClick={handleClearSearch}>
                ×
              </button>
            ) : null}
          </div>

          <div className="collection-dropdown">
            <button className="dropdown-btn" onClick={toggleDropdown}>
              {formatName(collection)}
              <span className={`arrow ${dropdownOpen ? 'up' : ''}`}>▼</span>
            </button>
            {dropdownOpen && (
              <div className="dropdown-menu">
                {collections.map(c => (
                  <div
                    key={c}
                    className={`dropdown-item ${
                      c === collection ? 'active' : ''
                    }`}
                    onClick={() => handleCollectionChange(c)}
                    onMouseEnter={() => preloadCollection(c)}
                  >
                    {formatName(c)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="styles-bar">
          {styles.map(s => (
            <button
              key={s}
              className={`style-btn ${style === s ? 'active' : ''}`}
              onClick={() => handleStyleChange(s)}
              disabled={loading}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      {/* Main */}
      <main className="main">
        <div className="info">{filtered.length.toLocaleString()} icons</div>

        {loading ? (
          <div className="loading">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="empty">No icons found</div>
        ) : (
          <div ref={containerRef} className="grid-container">
            <div
              style={{
                height: totalSize,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map(virtualRow => (
                <GridRow
                  key={virtualRow.key}
                  icons={rows[virtualRow.index]}
                  onSelect={handleSelect}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Modal - Lazy loaded */}
      {selected && (
        <Suspense fallback={null}>
          <IconModal icon={selected} onClose={handleCloseModal} />
        </Suspense>
      )}
    </div>
  );
}

export default App;
