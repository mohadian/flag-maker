import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Flag Maker – Single File App (standalone TSX)
 * - No external UI libs. Uses native inputs + Tailwind.
 * - Auto‑loads /symbols.json and merges with built-ins.
 * - Stripes, overlays (rect/circle/star/custom path/symbol), drag, edit, export.
 */

type Orientation = "horizontal" | "vertical";
type OverlayType = "rectangle" | "circle" | "star" | "custom" | "symbol";

type Overlay = {
  id: string;
  type: OverlayType;
  x: number;  // percent 0..100
  y: number;  // percent 0..100
  w: number;  // percent
  h: number;  // percent
  rotation: number; // deg
  fill: string;
  stroke: string;
  strokeWidth: number; // px relative to canvas
  opacity: number; // 0..1
  locked?: boolean;
  path?: string; // for custom & symbol
  symbolId?: string; // for symbol overlays
};

type SymbolDef = {
  id: string;
  name: string;
  category: string;
  path?: string;
  generator?: "star5";
  svg?: string;        // <— add
  viewBox?: string;    // <— add
};


const BUILTIN_SYMBOLS: SymbolDef[] = [
  { id: "star5", name: "Star (5‑point)", category: "Stars", generator: "star5" },
  { id: "star6_hexagram", name: "Star of David (hexagram)", category: "Stars", path: "M50 8 L90 78 L10 78 Z M50 92 L10 22 L90 22 Z" },
  { id: "crescent", name: "Crescent", category: "Religious/Heraldic", path: "M70 50 A30 30 0 1 1 40 50 A18 22 0 1 0 70 50 Z" },
  { id: "star_crescent", name: "Star & Crescent", category: "Religious/Heraldic", path: "M70 50 A30 30 0 1 1 40 50 A18 22 0 1 0 70 50 Z M86 40 L91 50 L102 50 L93 56 L96 66 L86 60 L76 66 L79 56 L70 50 L81 50 Z" },
  { id: "greek_cross", name: "Greek Cross", category: "Crosses", path: "M42 10 H58 V42 H90 V58 H58 V90 H42 V58 H10 V42 H42 Z" },
  { id: "latin_cross", name: "Latin Cross", category: "Crosses", path: "M45 10 H55 V45 H85 V55 H55 V90 H45 V55 H15 V45 H45 Z" },
  { id: "triangle_isosceles", name: "Triangle (isosceles)", category: "Geometric", path: "M10 90 L90 90 L50 10 Z" },
  { id: "sun_12", name: "Sun (12 rays)", category: "Celestial", path: (() => {
      const cx = 50, cy = 50, R = 28, r = 14; const rays = 12; let p = ""; const step = Math.PI / rays;
      for (let i = 0; i < 2 * rays; i++) { const rr = i % 2 === 0 ? R : r; const a = -Math.PI / 2 + i * step; const x = cx + rr * Math.cos(a); const y = cy + rr * Math.sin(a); p += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`); }
      return p + " Z";
    })() },
  { id: "maple_leaf_simple", name: "Maple Leaf (simple)", category: "Plants", path: "M50 15 L58 28 L72 26 L66 38 L78 44 L64 48 L68 62 L54 54 L50 70 L46 54 L32 62 L36 48 L22 44 L34 38 L28 26 L42 28 Z" },
  { id: "cedar_simple", name: "Cedar Tree (simple)", category: "Plants", path: "M50 18 L65 28 L55 28 L70 36 L58 36 L75 44 L58 44 L82 54 L50 54 L18 54 L42 44 L25 44 L42 36 L30 36 L45 28 L35 28 Z M46 54 V82 H54 V54 Z" },
];

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const uid = () => Math.random().toString(36).slice(2, 9);

function starPath(cx: number, cy: number, outer: number, inner: number, points = 5) {
  let path = "";
  const step = Math.PI / points;
  for (let i = 0; i < 2 * points; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = i * step - Math.PI / 2;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  return path + " Z";
}

function download(filename: string, data: string, type = "image/svg+xml;charset=utf-8") {
  const blob = new Blob([data], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function svgToPng(svgEl: SVGSVGElement, scale = 1) {
  const xml = new XMLSerializer().serializeToString(svgEl);
  const image64 = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = svgEl.viewBox.baseVal.width * scale;
      canvas.height = svgEl.viewBox.baseVal.height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve("");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.src = image64;
  });
}

export default function FlagMaker() {
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [ratio, setRatio] = useState<[number, number]>([2, 3]);
  const [sections, setSections] = useState<number>(3);
  const [weights, setWeights] = useState<number[]>([1, 1, 1]);
  const [colors, setColors] = useState<string[]>(["#ce1126", "#ffffff", "#000000"]);
  const [showGuides, setShowGuides] = useState<boolean>(false);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [customSymbolsJson, setCustomSymbolsJson] = useState<string>("");
  const [remoteSymbols, setRemoteSymbols] = useState<SymbolDef[]>([]);
  const [symbolsStatus, setSymbolsStatus] = useState<string>("Loading symbols…");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);

  const snapshot = () => JSON.stringify({ orientation, ratio, sections, weights, colors, overlays });
  const restore = (json: string) => {
    const data = JSON.parse(json);
    setOrientation(data.orientation);
    setRatio(data.ratio);
    setSections(data.sections);
    setWeights(data.weights);
    setColors(data.colors);
    setOverlays(data.overlays);
  };
  const pushHistory = () => setHistory((h) => [...h, snapshot()]);
  const totalWeight = useMemo(() => weights.reduce((a, b) => a + b, 0), [weights]);

  // Keep arrays in sync with `sections`
  useEffect(() => {
    setWeights((w) => (w.length === sections ? w : Array.from({ length: sections }, (_, i) => w[i] ?? 1)));
    setColors((c) => (c.length === sections ? c : Array.from({ length: sections }, (_, i) => c[i] ?? `#${((Math.random()*0xffffff)|0).toString(16).padStart(6,"0")}`)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  const ALL_SYMBOLS = useMemo(() => [...BUILTIN_SYMBOLS, ...remoteSymbols], [remoteSymbols]);

  async function loadSymbolsJson() {
    try {
      setSymbolsStatus("Loading symbols…");
      const res = await fetch("/symbols.json", { cache: "no-store" });
      if (!res.ok) { setSymbolsStatus("No /symbols.json found (using built‑ins)."); return; }
      const data = await res.json();
      const cleaned = data
        .filter((s: any) =>
          s && typeof s.id === "string" &&
          (typeof s.path === "string" || typeof s.svg === "string" || s.generator === "star5")
        )
        .map((s: any) => ({
          id: String(s.id),
          name: String(s.name || s.id),
          category: String(s.category || "Imported"),
          path: typeof s.path === "string" ? s.path : undefined,
          svg: typeof s.svg === "string" ? s.svg : undefined,          // <—
          viewBox: typeof s.viewBox === "string" ? s.viewBox : undefined, // <—
          generator: s.generator === "star5" ? "star5" : undefined,
        }));
      setRemoteSymbols(cleaned);
      setSymbolsStatus(`Loaded ${cleaned.length} symbols from symbols.json`);
    } catch (e) {
      console.error(e);
      setSymbolsStatus("Failed to load symbols.json");
    }
  }
  useEffect(() => { loadSymbolsJson(); }, []);

  const addOverlay = (type: OverlayType) => {
    pushHistory();
    const base: Overlay = {
      id: uid(),
      type,
      x: 50,
      y: 50,
      w: 30,
      h: 30,
      rotation: 0,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 8,
      opacity: 1,
    };
    if (type === "custom") base.path = "M 50 10 L 90 90 L 10 90 Z";
    setOverlays((o) => [...o, base]);
    setSelectedId(base.id);
  };

  const addSymbolOverlay = (symbolId: string) => {
    if (!symbolId) return;
    pushHistory();
    const def = ALL_SYMBOLS.find((s) => s.id === symbolId);
    if (!def) return;
    const base: Overlay = {
      id: uid(),
      type: def.generator ? "star" : "symbol",
      symbolId: def.id,
      x: 50,
      y: 50,
      w: 30,
      h: 30,
      rotation: 0,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 8,
      opacity: 1,
      path: def.path,
    };
    setOverlays((o) => [...o, base]);
    setSelectedId(base.id);
  };

  const importCustomSymbols = () => {
    try {
      const arr = JSON.parse(customSymbolsJson);
      if (!Array.isArray(arr)) return alert("JSON should be an array of symbols.");
      const cleaned: SymbolDef[] = arr
        .filter((s: any) => s && typeof s.id === "string" && (typeof s.path === "string" || s.generator === "star5"))
        .map((s: any) => ({ id: String(s.id), name: String(s.name || s.id), category: String(s.category || "Custom"), path: s.path ? String(s.path) : undefined, generator: s.generator === "star5" ? "star5" : undefined }));
      setRemoteSymbols((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        const merged = [...prev];
        cleaned.forEach((c) => { if (!ids.has(c.id)) merged.push(c); });
        return merged;
      });
      alert("Symbols imported. They will appear in the dropdown.");
      setCustomSymbolsJson("");
    } catch (e: any) {
      alert("Invalid JSON: " + e.message);
    }
  };

  const removeOverlay = (id: string) => {
    pushHistory();
    setOverlays((o) => o.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const updateOverlay = (id: string, patch: Partial<Overlay>) => {
    pushHistory();
    setOverlays((o) => o.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const bringForward = (id: string) => {
    pushHistory();
    setOverlays((o) => {
      const idx = o.findIndex((x) => x.id === id);
      if (idx < 0) return o;
      const copy = [...o];
      const [item] = copy.splice(idx, 1);
      copy.splice(Math.min(copy.length, idx + 1), 0, item);
      return copy;
    });
  };

  const sendBackward = (id: string) => {
    pushHistory();
    setOverlays((o) => {
      const idx = o.findIndex((x) => x.id === id);
      if (idx < 0) return o;
      const copy = [...o];
      const [item] = copy.splice(idx, 1);
      copy.splice(Math.max(0, idx - 1), 0, item);
      return copy;
    });
  };

  const undo = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [snapshot(), ...f]);
    restore(prev);
  };
  const redo = () => {
    if (!future.length) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, snapshot()]);
    restore(next);
  };

  const viewW = 1200;
  const viewH = useMemo(() => Math.round((viewW * ratio[0]) / ratio[1]), [ratio]);

  const stripeRects = useMemo(() => {
    const rects: { x: number; y: number; w: number; h: number; fill: string }[] = [];
    let offset = 0;
    for (let i = 0; i < sections; i++) {
      const frac = weights[i] / totalWeight;
      if (orientation === "horizontal") {
        const h = viewH * frac;
        rects.push({ x: 0, y: offset, w: viewW, h, fill: colors[i] });
        offset += h;
      } else {
        const w = viewW * frac;
        rects.push({ x: offset, y: 0, w, h: viewH, fill: colors[i] });
        offset += w;
      }
    }
    return rects;
  }, [sections, weights, totalWeight, colors, orientation, viewH]);

  const dragInfo = useRef<{ id: string; startX: number; startY: number; startPos: { x: number; y: number } } | null>(null);
  const onMouseDown = (e: React.MouseEvent, id: string) => {
    const rect = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const item = overlays.find((o) => o.id === id)!;
    dragInfo.current = { id, startX: x, startY: y, startPos: { x: item.x, y: item.y } };
    setSelectedId(id);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragInfo.current) return;
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const dx = x - dragInfo.current.startX;
    const dy = y - dragInfo.current.startY;
    const id = dragInfo.current.id;
    const start = dragInfo.current.startPos;
    setOverlays((o) => o.map((it) => (it.id === id ? { ...it, x: clamp(start.x + dx, 0, 100), y: clamp(start.y + dy, 0, 100) } : it)));
  };
  const onMouseUp = () => {
    if (dragInfo.current) pushHistory();
    dragInfo.current = null;
  };

  const SelectedControls = () => {
    const item = overlays.find((o) => o.id === selectedId);
    if (!item) return null;
    return (
      <div className="mt-4 rounded-xl border p-4 bg-white shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Overlay settings</div>
          <div className="flex gap-2">
            <button className="px-2 py-1 text-sm rounded border hover:bg-neutral-50" onClick={() => sendBackward(item.id)} title="Send backward">⬇︎</button>
            <button className="px-2 py-1 text-sm rounded border hover:bg-neutral-50" onClick={() => bringForward(item.id)} title="Bring forward">⬆︎</button>
            <button className="px-2 py-1 text-sm rounded border border-red-300 text-red-600 hover:bg-red-50" onClick={() => removeOverlay(item.id)} title="Delete">🗑</button>
          </div>
        </div>

        {(item.type === "custom" || item.type === "symbol") && (
          <div className="mt-3">
            <label className="block text-sm mb-1">SVG Path (d)</label>
            <textarea
              className="w-full border rounded p-2 font-mono h-24"
              value={item.path || ""}
              onChange={(e) => updateOverlay(item.id, { path: e.target.value })}
              placeholder="Paste an SVG path 'd' here"
            />
            <p className="text-xs text-neutral-500 mt-1">Paths use a 100×100 box and are auto‑scaled.</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="block text-sm mb-1">Fill</label>
            <input type="color" className="h-9 w-full" value={item.fill} onChange={(e) => updateOverlay(item.id, { fill: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm mb-1">Stroke</label>
            <input type="color" className="h-9 w-full" value={item.stroke} onChange={(e) => updateOverlay(item.id, { stroke: e.target.value })} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="block text-sm mb-1">Stroke width</label>
            <input type="range" min={0} max={40} step={1} value={item.strokeWidth} onChange={(e) => updateOverlay(item.id, { strokeWidth: Number(e.target.value) })} className="w-full" />
          </div>
          <div>
            <label className="block text-sm mb-1">Opacity</label>
            <input type="range" min={0} max={100} step={1} value={Math.round(item.opacity * 100)} onChange={(e) => updateOverlay(item.id, { opacity: Number(e.target.value) / 100 })} className="w-full" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="block text-sm mb-1">Width (%)</label>
            <input type="range" min={2} max={100} step={1} value={item.w} onChange={(e) => updateOverlay(item.id, { w: Number(e.target.value) })} className="w-full" />
          </div>
          <div>
            <label className="block text-sm mb-1">Height (%)</label>
            <input type="range" min={2} max={100} step={1} value={item.h} onChange={(e) => updateOverlay(item.id, { h: Number(e.target.value) })} className="w-full" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="block text-sm mb-1">X (%)</label>
            <input type="range" min={0} max={100} step={1} value={item.x} onChange={(e) => updateOverlay(item.id, { x: Number(e.target.value) })} className="w-full" />
          </div>
          <div>
            <label className="block text-sm mb-1">Y (%)</label>
            <input type="range" min={0} max={100} step={1} value={item.y} onChange={(e) => updateOverlay(item.id, { y: Number(e.target.value) })} className="w-full" />
          </div>
        </div>

        <div className="mt-3">
          <label className="block text-sm mb-1">Rotation (°)</label>
          <input type="range" min={-180} max={180} step={1} value={item.rotation} onChange={(e) => updateOverlay(item.id, { rotation: Number(e.target.value) })} className="w-full" />
        </div>
      </div>
    );
  };

  const addPreset = (type: OverlayType) => () => addOverlay(type);

  return (
    <div className="p-4 md:p-6 grid gap-4 md:gap-6 grid-cols-1 xl:grid-cols-3">
      {/* Left Panel */}
      <div className="space-y-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-lg font-semibold mb-3">Canvas</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Orientation</label>
              <select className="w-full border rounded h-9 px-2" value={orientation} onChange={(e) => { pushHistory(); setOrientation(e.target.value as Orientation); }}>
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">Aspect ratio</label>
              <select
                className="w-full border rounded h-9 px-2"
                value={`${ratio[0]}:${ratio[1]}`}
                onChange={(e) => {
                  pushHistory();
                  const [h, w] = e.target.value.split(":").map((n) => parseInt(n, 10));
                  setRatio([h, w]);
                }}
              >
                <option value="1:2">1:2 (UK)</option>
                <option value="2:3">2:3 (EU)</option>
                <option value="3:5">3:5</option>
                <option value="5:8">5:8</option>
                <option value="1:1">1:1 (Square)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 items-end mt-3">
            <div className="col-span-2">
              <label className="block text-sm mb-1">Sections</label>
              <input type="range" min={1} max={9} step={1} value={sections} onChange={(e) => { pushHistory(); setSections(Number(e.target.value)); }} className="w-full" />
            </div>
            <div className="text-right text-sm text-neutral-500">{sections}</div>
          </div>

          <div className="flex items-center justify-between mt-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
              Show guides
            </label>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 rounded border hover:bg-neutral-50" onClick={undo} title="Undo">↩︎ Undo</button>
              <button className="px-3 py-1.5 rounded border hover:bg-neutral-50" onClick={redo} title="Redo">↪︎ Redo</button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-lg font-semibold mb-3">Sections</div>
          <div className="space-y-3">
            {Array.from({ length: sections }).map((_, i) => (
              <div key={i} className="grid grid-cols-12 gap-3 items-center">
                <div className="col-span-3">
                  <label className="block text-xs mb-1">Color {i + 1}</label>
                  <input type="color" className="h-9 w-full" value={colors[i]} onChange={(e) => { pushHistory(); setColors((c) => c.map((x, idx) => (idx === i ? e.target.value : x))); }} />
                </div>
                <div className="col-span-8">
                  <label className="block text-xs mb-1">Weight</label>
                  <input type="range" min={1} max={20} step={1} value={weights[i]} onChange={(e) => { pushHistory(); setWeights((w) => w.map((x, idx) => (idx === i ? Number(e.target.value) : x))); }} className="w-full" />
                </div>
                <div className="col-span-1 text-right text-sm text-neutral-500">{weights[i]}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-lg font-semibold mb-3">Overlays</div>
          <div className="grid grid-cols-4 gap-2">
            <button onClick={addPreset("rectangle")} className="rounded border px-3 py-2 hover:bg-neutral-50">+ Rect</button>
            <button onClick={addPreset("circle")} className="rounded border px-3 py-2 hover:bg-neutral-50">+ Circle</button>
            <button onClick={addPreset("star")} className="rounded border px-3 py-2 hover:bg-neutral-50">+ Star</button>
            <button onClick={addPreset("custom")} className="rounded border px-3 py-2 hover:bg-neutral-50">+ Custom</button>
          </div>

          <div className="grid grid-cols-12 gap-2 items-end mt-3">
            <div className="col-span-8">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm">Symbol library</label>
                <span className="text-xs text-neutral-500">{symbolsStatus}</span>
              </div>
              <select className="w-full border rounded h-9 px-2" value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}>
                <option value="" disabled>Choose a symbol…</option>
                {Array.from(new Set(ALL_SYMBOLS.map(s => s.category))).map((cat) => (
                  <optgroup key={cat} label={cat}>
                    {ALL_SYMBOLS.filter(s => s.category === cat).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="col-span-4">
              <button disabled={!selectedSymbol} onClick={() => addSymbolOverlay(selectedSymbol)} className="w-full rounded border px-3 py-2 hover:bg-neutral-50 disabled:opacity-50">Add symbol</button>
            </div>
          </div>

          <div className="flex justify-end mt-2">
            <button onClick={loadSymbolsJson} className="rounded border px-3 py-1.5 hover:bg-neutral-50">Reload symbols.json</button>
          </div>

          <div className="mt-3">
            <label className="block text-xs mb-1">Import custom symbols (JSON array of {"{id,name,category,path}"})</label>
            <textarea className="w-full border rounded p-2 font-mono h-28" value={customSymbolsJson} onChange={(e) => setCustomSymbolsJson(e.target.value)} placeholder='[
  {"id":"eagle_outline","name":"Eagle (outline)","category":"Animals","path":"M ... Z"}
]'></textarea>
            <div className="flex justify-end mt-2">
              <button onClick={importCustomSymbols} className="rounded border px-3 py-1.5 hover:bg-neutral-50">Import</button>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {overlays.length === 0 && <p className="text-sm text-neutral-500">No overlays yet. Click a button above to add one.</p>}
            {overlays.map((o) => (
              <div key={o.id} className={`flex items-center justify-between rounded-lg border p-2 ${selectedId === o.id ? "ring-2 ring-blue-500" : ""}`}>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ background: o.fill }} />
                  <button className="text-sm underline-offset-2 hover:underline" onClick={() => setSelectedId(o.id)}>
                    {(o.type === "symbol" && o.symbolId) ? `symbol:${o.symbolId}` : o.type} @ {Math.round(o.x)}%,{Math.round(o.y)}%
                  </button>
                </div>
                <div className="flex gap-1">
                  <button className="px-2 py-1 text-sm rounded border hover:bg-neutral-50" onClick={() => updateOverlay(o.id, { locked: !o.locked })} title={o.locked ? "Unlock" : "Lock"}>{o.locked ? "🔒" : "🔓"}</button>
                  <button className="px-2 py-1 text-sm rounded border hover:bg-neutral-50" onClick={() => bringForward(o.id)} title="Bring forward">⬆︎</button>
                  <button className="px-2 py-1 text-sm rounded border hover:bg-neutral-50" onClick={() => sendBackward(o.id)} title="Send backward">⬇︎</button>
                  <button className="px-2 py-1 text-sm rounded border border-red-300 text-red-600 hover:bg-red-50" onClick={() => removeOverlay(o.id)} title="Delete">🗑</button>
                </div>
              </div>
            ))}
          </div>

          {SelectedControls()}
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-lg font-semibold mb-3">Export</div>
          <div className="flex gap-2">
            <button className="rounded border px-3 py-2 hover:bg-neutral-50" onClick={() => {
              const svg = svgRef.current;
              if (!svg) return;
              const xml = new XMLSerializer().serializeToString(svg);
              download("flag.svg", xml);
            }}>Download SVG</button>
            <button className="rounded border px-3 py-2 hover:bg-neutral-50" onClick={async () => {
              const svg = svgRef.current;
              if (!svg) return;
              const dataUrl = await svgToPng(svg, 1);
              const a = document.createElement("a");
              a.href = dataUrl;
              a.download = "flag.png";
              a.click();
            }}>Download PNG</button>
          </div>
        </div>
      </div>

      {/* Right Panel: Canvas */}
      <div className="xl:col-span-2">
        <div className="rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-4 py-2 font-semibold">Design</div>
          <div className="p-4">
            <div className="w-full overflow-auto">
              <svg
                ref={svgRef}
                xmlns="http://www.w3.org/2000/svg"
                viewBox={`0 0 ${viewW} ${viewH}`}
                className="w-full h-auto rounded-lg bg-white"
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
              >
                {/* Stripes */}
                {stripeRects.map((r, i) => (
                  <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
                ))}

                {/* Guides */}
                {showGuides && (
                  <g opacity={0.2}>
                    <rect x={0} y={0} width={viewW} height={viewH} fill="none" stroke="#000" strokeDasharray="8 8" />
                    <line x1={viewW / 2} y1={0} x2={viewW / 2} y2={viewH} stroke="#000" strokeDasharray="6 6" />
                    <line x1={0} y1={viewH / 2} x2={viewW} y2={viewH / 2} stroke="#000" strokeDasharray="6 6" />
                  </g>
                )}

                {/* Overlays */}
                {overlays.map((o) => {
                  const cx = (o.x / 100) * viewW;
                  const cy = (o.y / 100) * viewH;
                  const w = (o.w / 100) * viewW;
                  const h = (o.h / 100) * viewH;
                  const tx = cx - w / 2;
                  const ty = cy - h / 2;
                  const common: any = {
                    transform: `rotate(${o.rotation}, ${cx}, ${cy})`,
                    opacity: o.opacity,
                    onMouseDown: (e: React.MouseEvent) => !o.locked && onMouseDown(e, o.id),
                    style: { cursor: o.locked ? "not-allowed" : "grab" },
                  };
                  const scalePath = (d: string) => (
                    <g transform={`translate(${tx}, ${ty})`}>
                      <path d={d} fill={o.fill} stroke={o.stroke} strokeWidth={o.strokeWidth} transform={`scale(${w / 100}, ${h / 100})`} />
                    </g>
                  );
                  return (
                    <g key={o.id} {...common}>
                      {o.type === "rectangle" && (
                        <rect x={tx} y={ty} width={w} height={h} fill={o.fill} stroke={o.stroke} strokeWidth={o.strokeWidth} />
                      )}
                      {o.type === "circle" && (
                        <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} fill={o.fill} stroke={o.stroke} strokeWidth={o.strokeWidth} />
                      )}
                      {o.type === "star" && (
                        <path d={starPath(cx, cy, Math.min(w, h) / 2, Math.min(w, h) / 4, 5)} fill={o.fill} stroke={o.stroke} strokeWidth={o.strokeWidth} />
                      )}
                      {o.type === "custom" && o.path && scalePath(o.path)}
                      {o.type === "symbol" && (() => {
                        const def = ALL_SYMBOLS.find(s => s.id === o.symbolId);
                        if (!def) return null;

                        const cx = (o.x / 100) * viewW;
                        const cy = (o.y / 100) * viewH;
                        const w  = (o.w / 100) * viewW;
                        const h  = (o.h / 100) * viewH;
                        const tx = cx - w / 2;
                        const ty = cy - h / 2;

                        // generator star (legacy)
                        if (def.generator === "star5") {
                          return <path d={starPath(cx, cy, Math.min(w,h)/2, Math.min(w,h)/4, 5)} fill={o.fill} stroke={o.stroke} strokeWidth={o.strokeWidth} />;
                        }

                        // FULL SVG emblem (this is your case)
                        if (def.svg && def.viewBox) {
                          const [minX, minY, vbW, vbH] = def.viewBox.split(/\s+/).map(Number);
                          const scaleX = w / vbW;
                          const scaleY = h / vbH;
                          return (
                            <g
                              transform={`translate(${tx}, ${ty}) translate(${-minX * scaleX}, ${-minY * scaleY}) scale(${scaleX}, ${scaleY})`}
                              // uncomment next two lines if you generated a tintable set (currentColor):
                              // fill={o.fill}
                              // stroke={o.stroke}
                              dangerouslySetInnerHTML={{ __html: def.svg }}
                            />
                          );
                        }

                        // single-path fallback (100×100 box)
                        if (def.path) {
                          return (
                            <g transform={`translate(${tx}, ${ty})`}>
                              <path d={def.path} fill={o.fill} stroke={o.stroke} strokeWidth={o.strokeWidth} transform={`scale(${w/100}, ${h/100})`} />
                            </g>
                          );
                        }
                        return null;
                      })()
                    }
                      {selectedId === o.id && (
                        <rect x={tx} y={ty} width={w} height={h} fill="none" stroke="#00f" strokeDasharray="6 6" opacity={0.5} />
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>
        <div className="text-sm text-neutral-600 mt-3">
          Tip: Drop a <code>symbols.json</code> file into <code>public/</code>. The app loads it automatically on start (or via “Reload symbols.json”). Paths should use a 100×100 box.
        </div>
      </div>
    </div>
  );
}
