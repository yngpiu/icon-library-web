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
import Fuse from 'fuse.js';
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

// Collection cache with Fuse index
const cache = new Map<string, { icons: Icon[]; fuse: Fuse<Icon> }>();

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
        <div
          className="icon-svg"
          dangerouslySetInnerHTML={{ __html: icon.content }}
        />
        <span className="icon-name">{icon.name}</span>
      </div>
    );
  },
  (prev, next) => prev.icon.path === next.icon.path
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
  const fuseRef = useRef<Fuse<Icon> | null>(null);

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

  // Load collection with pre-built Fuse index
  useEffect(() => {
    if (!collection) return;

    const cached = cache.get(collection);
    if (cached) {
      setIcons(cached.icons);
      fuseRef.current = cached.fuse;
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/icons/${collection}.json`)
      .then(r => r.json())
      .then((data: Icon[]) => {
        // Pre-build Fuse index
        const fuse = new Fuse(data, FUSE_OPTIONS);
        cache.set(collection, { icons: data, fuse });
        fuseRef.current = fuse;
        setIcons(data);
        setLoading(false);
      });
  }, [collection]);

  // Pre-compute styles for faster filtering
  const { styles, styleIndex } = useMemo(() => {
    const styleSet = new Set<string>();
    const index = new Map<string, Icon[]>();

    for (const icon of icons) {
      styleSet.add(icon.style);
      const arr = index.get(icon.style) || [];
      arr.push(icon);
      index.set(icon.style, arr);
    }

    return {
      styles: ['all', ...Array.from(styleSet).sort()],
      styleIndex: index,
    };
  }, [icons]);

  // Optimized filtering with pre-computed index
  const filtered = useMemo(() => {
    let result: Icon[];

    // Search first (more selective)
    if (debouncedSearch && fuseRef.current) {
      result = fuseRef.current
        .search(debouncedSearch, { limit: 500 })
        .map(r => r.item);

      // Then filter by style
      if (style !== 'all') {
        result = result.filter(i => i.style === style);
      }
    } else if (style !== 'all') {
      // Use pre-computed index for style filtering
      result = styleIndex.get(style) || [];
    } else {
      result = icons;
    }

    return result;
  }, [icons, debouncedSearch, style, styleIndex]);

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
    overscan: 2, // Reduced for better performance
  });

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
            {search && (
              <button className="clear-btn" onClick={handleClearSearch}>
                ×
              </button>
            )}
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
