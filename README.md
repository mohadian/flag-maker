# Flag Maker – Single‑File React App (TSX)

Design flags with adjustable stripes and overlays (rectangles, circles, stars, **national emblems**).  
Supports drag, edit, undo/redo, and export to **SVG/PNG**. Loads a `public/symbols.json` library (built‑ins + your own) including **full multi‑shape SVG emblems**.

---

## Quick Start

### Requirements
- **Node.js 18+** (recommend 20+).  
  Check: `node -v`
- **npm** 8+ (comes with Node 18+)
- (Optional) **Python 3.9+** if you’ll use the Wikimedia fetcher.

### 1) Install
```bash
npm install
```

### 2) Run in dev
```bash
npm run dev
# open the printed URL (usually http://localhost:5173/)
```

### 3) Build for production
```bash
npm run build
npm run preview
```

---

## Project Structure (key files)

```
.
├─ public/
│  └─ symbols.json          # (optional) your emblem library, auto-loaded at runtime
├─ src/
│  ├─ main.tsx              # Vite entry
│  ├─ App.tsx               # imports FlagMaker
│  └─ FlagMaker.tsx         # the entire app UI + canvas
├─ tools/
│  ├─ fetch_emblems.py      # fetch official emblems from Wikimedia
│  └─ svg2symbols.mjs       # convert a folder of SVGs → public/symbols.json
├─ tailwind.config.ts       # Tailwind v4
├─ postcss.config.js        # Tailwind v4 (using @tailwindcss/postcss)
├─ package.json
└─ README.md
```

---

## Using the App

- **Canvas**: choose orientation, aspect ratio, number of sections (stripes). Set each stripe’s color + weight.
- **Overlays**: add rectangle, circle, star, custom path, or **Symbol** from the dropdown.  
  - Drag overlays directly on the flag.  
  - Adjust fill/stroke/opacity/size/rotation; lock/unlock; z‑order; delete.
- **Symbol Library**:
  - Includes a small built‑in starter set (star, crescent, crosses, etc.).
  - Auto‑loads `public/symbols.json` if present.
  - Supports **full multi‑shape SVG** emblems via `{ svg, viewBox }`.
- **Export**: download as SVG or PNG.

**Tip:** The app reads `symbols.json` at `/symbols.json`. With Vite, place it in **`public/`**.

---

## Adding Official Emblems (Two Tools)

### A) `fetch_emblems.py` – download SVG emblems from Wikimedia

Fetches original **SVG** emblem files (when available) for UN‑recognized countries, then you can convert them into `symbols.json` with the converter (tool B).

#### Setup
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install requests lxml
```

#### IMPORTANT: Set a compliant User‑Agent
Edit the script header to include a real website/GitHub and email (Wikimedia policy):

```python
# inside tools/fetch_emblems.py
CONTACT = "https://your-site-or-github ; email: you@example.com"
USER_AGENT = f"FlagMakerCollector/1.0 ({CONTACT}) requests"
```

If you don’t, Wikimedia may return **403 Forbidden**.

#### Run it
```bash
python tools/fetch_emblems.py
```

- Downloads raw SVGs into `downloads/emblems/`.
- It’s polite (rate‑limited, retries, backoff) and merges results on subsequent runs.
- Some countries may fail or have multiple variants; you can add filename overrides later if needed.

> Licensing: many emblems on Commons are public domain or permissive, but **always check each file’s page**. The script stores a `source`/`license` hint per entry when you later build `symbols.json`.

---

### B) `svg2symbols.mjs` – convert SVG files → `public/symbols.json`

Reads a folder of SVGs, **preserves viewBox**, inlines styles, and emits a `symbols.json` that your app loads.  
Can output **authentic colors** or **tintable** (recolorable) symbols.

#### Install dependencies
```bash
npm i -D svgo@^3 fast-xml-parser
```

#### Usage

Convert all SVGs in a folder to a merged `symbols.json`:

```bash
# Keep official colors
node tools/svg2symbols.mjs --in downloads/emblems --out public/symbols.json --category "National Emblems"

# Make a tintable library (use overlay Fill/Stroke in the app)
node tools/svg2symbols.mjs --in downloads/emblems --out public/symbols.json --mode currentColor --strip

# Force a monochrome color (e.g., dark gray)
node tools/svg2symbols.mjs --in downloads/emblems --out public/symbols.json --mode mono:#222222 --strip
```

#### Flags
- `--in <dir>`: input directory with SVG files (e.g., `downloads/emblems`).
- `--out <file>`: output JSON file (default `public/symbols.json`).
- `--category <name>`: category label shown in the app.
- `--mode`:
  - `keep` (default): keep official colors.
  - `currentColor`: converts fills/strokes to `currentColor` so the app can tint them.
  - `mono:#RRGGBB`: hard‑color a monochrome version.
- `--strip`: remove existing fills/strokes/styles before recoloring (useful for tinting).
- `--keepIds`: preserve element IDs/classes (default: clean them).
- `--prefix`: prefix to prepend to each generated `id` (optional).
- `--verbose`: log each processed file.

#### What it writes
Each symbol entry looks like:
```json
{
  "id": "uae_emblem",
  "name": "United Arab Emirates – Emblem",
  "category": "National Emblems",
  "viewBox": "0 0 2335.24 2754.38",
  "svg": "<g>…inner SVG markup only…</g>"
}
```

Your app’s renderer scales it with the original `viewBox` for crisp, accurate results.

---

## `symbols.json` Format (App‑Ready)

`public/symbols.json` must be an **array** of objects. Each object can be:

- **Full emblem (preferred)**
  ```json
  {
    "id": "country_emblem",
    "name": "Country – National emblem",
    "category": "National Emblems",
    "viewBox": "0 0 800 800",
    "svg": "<g>...inner SVG children (no outer <svg>)...</g>"
  }
  ```

- **Simple path (legacy)** — scaled in a 100×100 box
  ```json
  { "id": "hexagram", "name": "Hexagram", "category": "Stars", "path": "M...Z" }
  ```

- **Generated** — star, etc.
  ```json
  { "id": "star5", "name": "Star (5‑point)", "category": "Stars", "generator": "star5" }
  ```

The app merges this with built‑in symbols.

---

## Recoloring Emblems (two approaches)

1. **Bake a tintable library** (recommended for design flexibility)  
   Generate with:
   ```bash
   node tools/svg2symbols.mjs --in downloads/emblems --out public/symbols.json --mode currentColor --strip
   ```
   In the app UI, set overlay **Fill/Stroke** to recolor the emblem.

2. **Keep official colors**  
   Use `--mode keep` (default). The app will render the emblem in its original colors.

> The app’s renderer handles both. If you want in‑app toggles (original vs tinted), you can add an overlay option and set the `<g>` wrapper’s fill/stroke accordingly.

---

## Troubleshooting

### `symbols.json` doesn’t load
- Ensure it’s at `public/symbols.json` (Vite serves `public/` at the site root).
- Visit `http://localhost:5173/symbols.json` directly; you should see JSON.
- It **must be an array**. A top‑level object will be ignored.
- Check the app console: it prints a status (“Loaded N symbols…” or an error).

### Fetcher gets 403 from Wikimedia
- You **must** set a descriptive User‑Agent + contact in `fetch_emblems.py`.
- Try a smaller subset of countries while testing.
- Be patient; the script has polite backoff/retries.

### SVGO plugin errors
- Use **SVGO v3**.  
  `npm i -D svgo@^3 fast-xml-parser`
- The script already uses a v3‑safe config with `preset-default` and `removeViewBox: false`.

### Tailwind / PostCSS warnings
- For Tailwind v4 with PostCSS:  
  `npm i -D @tailwindcss/postcss postcss autoprefixer`  
  `postcss.config.js` should reference `@tailwindcss/postcss`.

### TypeScript path alias for imports like `@/…`
Make sure your `tsconfig.json` has:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

---

## Development Tips

- Start with a tiny `public/symbols.json` to verify loading:
  ```json
  [
    { "id": "test_star", "name": "Test Star", "category": "Test", "generator": "star5" }
  ]
  ```
- Then build your full pack with `svg2symbols.mjs`.
- If a specific emblem fails extraction, re‑run `svg2symbols.mjs` with `--verbose` to see which file is problematic; the extractor is robust to nested `<svg>`, but malformed files can still need manual cleanup.

---

## License & Attribution

- This project’s code is MIT‑style (adjust to your preference).
- **Emblems** come from third‑party sources (e.g., Wikimedia Commons).  
  You are responsible for reviewing and complying with each emblem’s **license and usage terms** on its file page. Some are public domain; others may have restrictions.

---

## Commands Recap

```bash
# Dev
npm run dev

# Build & preview
npm run build
npm run preview

# Fetch raw emblems (requires Python; set UA/contact!)
python tools/fetch_emblems.py

# Convert SVGs → symbols.json (authentic colors)
node tools/svg2symbols.mjs --in downloads/emblems --out public/symbols.json --category "National Emblems"

# Convert SVGs → tintable pack
node tools/svg2symbols.mjs --in downloads/emblems --out public/symbols.json --mode currentColor --strip
```
