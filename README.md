# Mixxicon

A fast, responsive icon browser for browsing and exporting icons from large SVG collections. Built with React 19, TypeScript, and Vite.

## Features

- **Fuzzy search** — Instant full-text search via Web Worker (Fuse.js, 500-result limit, 150ms debounce)
- **Virtualized grid** — 30,000+ icons rendered smoothly via `@tanstack/react-virtual`
- **Multi-collection** — Font Awesome, Huge Icons, Panda, and more
- **Style filter** — Filter icons by style within each collection
- **Progressive loading** — Metadata loads first, SVG content chunks stream in on scroll
- **SVG export** — Copy SVG source or download as `.svg` with custom color and size
- **Responsive** — Adapts from 4 to 9 columns per row

## Quick Start

```bash
pnpm install
node scripts/build-icons.mjs   # or: pnpm build:icons
pnpm dev
```

Open `http://localhost:5173`.

## Project Structure

```
public/icons/           # Generated icon data (metadata JSON + content chunks)
src/
├── App.tsx             # Main app: search, grid, collection/style state
├── App.css             # Styles
├── IconModal.tsx       # Lazy-loaded SVG preview modal
├── search.worker.ts    # Web Worker for Fuse.js search
└── main.tsx            # Entry point
scripts/
└── build-icons.mjs    # Reads SVGs, strips fill, outputs metadata + chunked content
```

All app logic lives in `src/App.tsx`. The modal is lazy-loaded via `React.lazy`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start Vite dev server at `localhost:5173` |
| `pnpm build` | Typecheck (`tsc -b`) + bundle (`vite build`) |
| `pnpm lint` | ESLint (flat config) |
| `pnpm preview` | Preview production build |
| `pnpm build:icons` | Rebuild icon index from SVGs |

## Adding Icon Collections

1. Place SVGs under `src/assets/icons/{collection}/` following one of these layouts:
   - `font-awesome`: `{style}/{...category}/{icon}.svg`
   - `panda`: `{style}/{icon}.svg`
   - `huge`: `{category}/{style}/{icon}.svg`
2. Run `pnpm build:icons`.

The build script strips `fill` attributes — color is controlled via CSS `currentColor`.

## How It Works

1. **Build** — `build-icons.mjs` reads all SVGs, strips fill, generates `{collection}.json` (metadata) and `{collection}.content.{N}.json` (1000-icon chunks).
2. **Load** — App fetches manifest, then collection metadata (~4MB). Grid renders instantly with placeholder frames.
3. **Background** — Content chunks load progressively as the user scrolls. Each chunk (~1MB) is fetched and merged into the icon array.
4. **Search** — Fuse.js runs in a Web Worker. Results (metadata-only paths) are mapped back to full icons via a `Map<path, Icon>`.
5. **Hover preload** — Hovering a collection in the dropdown preloads its full data for instant switching.

## License

MIT
