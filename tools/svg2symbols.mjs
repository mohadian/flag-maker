#!/usr/bin/env node
/**
 * Convert a folder of SVGs into symbols.json for Flag Maker.
 *
 * Features:
 * - SVGO v3 config that preserves viewBox + inlines styles
 * - Robust extraction of viewBox + inner SVG (supports nested <svg>)
 * - Modes:
 *    • keep (default)      – keep official colors
 *    • currentColor        – tintable in app via overlay fill/stroke
 *    • mono:#RRGGBB        – force one solid color
 * - --strip removes inline fill/stroke before recoloring
 * - --keepIds preserves element ids/classes (default: clean)
 * - Merges with existing symbols.json (by id)
 *
 * Usage:
 *   node tools/svg2symbols.mjs --in downloads/emblems --out public/symbols.json
 *   node tools/svg2symbols.mjs --in svgs --out public/symbols.json --mode currentColor --strip
 *   node tools/svg2symbols.mjs --in svgs --out public/symbols.json --mode mono:#222 --strip --category "National Emblems"
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { optimize } from "svgo";
import { XMLParser } from "fast-xml-parser";

// ----- CLI args -----
const args = parseArgs(process.argv.slice(2));
const INPUT_DIR = must(args["in"], "--in <dir> is required");
const OUTPUT = args["out"] || "public/symbols.json";
const CATEGORY = args["category"] || "National Emblems";
const PREFIX = args["prefix"] || ""; // e.g. "un_"
const MODE = (args["mode"] || "keep").toLowerCase(); // keep | currentColor | mono:#hex
const STRIP = Boolean(args["strip"]);
const KEEP_IDS = Boolean(args["keepIds"]);
const VERBOSE = Boolean(args["verbose"]);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true }).catch(() => {});
const files = (await fs.readdir(INPUT_DIR)).filter(f => f.toLowerCase().endsWith(".svg"));
if (!files.length) {
  console.error(`No SVG files in: ${INPUT_DIR}`);
  process.exit(1);
}

// ----- SVGO v3 config -----
const svgoConfig = {
  multipass: true,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          removeViewBox: false,                 // keep viewBox
          inlineStyles: { onlyMatchedOnce: false },
          removeUnknownsAndDefaults: false,     // some emblems rely on these
          cleanupIds: KEEP_IDS ? false : true,  // clean ids unless requested
        },
      },
    },
    // extra safety plugins
    { name: "removeViewBox", active: false },   // ensure viewBox remains
    { name: "convertPathData", active: true },
    "removeDoctype",
    "removeXMLProcInst",
    "removeComments",
    "removeMetadata",
    "removeEditorsNSData",
  ],
};

// ----- Process all files -----
const results = [];
for (const file of files) {
  const abs = path.join(INPUT_DIR, file);
  const raw = await fs.readFile(abs, "utf8");

  // 1) Optimize & inline styles
  const { data: optimized, error } = optimize(raw, { ...svgoConfig, path: abs });
  if (error) {
    console.warn(`✗ SVGO failed for ${file}:`, error);
    continue;
  }

  // 2) Extract viewBox + inner SVG (supports nested <svg>)
  const ex = extractViewBoxAndInner(optimized) || extractViewBoxAndInner(raw);
  if (!ex) {
    console.warn(`✗ Couldn’t extract viewBox/inner for ${file}`);
    continue;
  }
  const { viewBox, inner } = ex;

  // 3) Optional recolor
  let processed = inner;
  if (MODE !== "keep" || STRIP) {
    processed = recolorInner(processed, MODE, STRIP);
  }

  const base = path.basename(file, ".svg");
  const id = sanitizeId(`${PREFIX}${base.toLowerCase().replace(/\s+/g, "_")}`);
  const name = prettifyName(base);

  results.push({
    id,
    name,
    category: CATEGORY,
    viewBox,
    svg: processed,               // inner markup only
    sourceFile: path.relative(process.cwd(), abs),
  });

  if (VERBOSE) console.log(`• ${file} → id=${id}`);
}

// ----- Merge with existing -----
let existing = [];
try {
  const prev = await fs.readFile(OUTPUT, "utf8");
  existing = JSON.parse(prev);
} catch (_) { /* no-op */ }

const byId = new Map(existing.filter(isObj).map(x => [x.id, x]));
for (const r of results) byId.set(r.id, r);
const merged = [...byId.values()];

await fs.writeFile(OUTPUT, JSON.stringify(merged, null, 2), "utf8");
console.log(`✅ Wrote ${merged.length} symbols to ${OUTPUT}`);


// ======= helpers =======

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) out[k] = true;
    else { out[k] = v; i++; }
  }
  return out;
}

function must(v, msg) {
  if (!v) { console.error(msg); process.exit(1); }
  return v;
}

function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }

function sanitizeId(s) {
  return s
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9_.-]/g, "_");
}

function prettifyName(base) {
  return base
    .replace(/_/g, " ")
    .replace(/\bsvg$/i, "")
    .replace(/\bcoat of arms of\b/i, "")
    .replace(/\bemblem of\b/i, "")
    .replace(/\bnational\b/i, "")
    .trim()
    .replace(/\b\w/g, m => m.toUpperCase());
}

/**
 * Robustly extract { viewBox, inner }:
 * - accepts nested <svg> (walks until a real <svg> with content)
 * - if no viewBox, synthesizes from width/height
 */
function extractViewBoxAndInner_old(svgString) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    preserveOrder: true
  });

  try {
    const doc = parser.parse(svgString);
    // find first node named 'svg' (supports nested structure from preserveOrder)
    const svgNode = findFirstSvgNode(doc);
    if (!svgNode) return null;

    // svgNode is an object like { svg: [ {attr...}, child1, child2, ... ] }
    const arr = svgNode.svg;
    if (!Array.isArray(arr) || !arr.length) return null;
    const attrs = arr[0] || {};
    let viewBox = attrs.viewBox || synthesizeViewBox(attrs.width, attrs.height);
    if (!viewBox) return null;

    // Get the exact inner markup between <svg ...> and </svg> for THIS svg node.
    // We can’t easily slice the original string for nested nodes,
    // so rebuild inner from the preserved-order object (excluding attr object).
    const inner = stringifyInner(arr.slice(1));
    if (!inner.trim()) return null;

    return { viewBox: String(viewBox), inner: inner.trim() };
  } catch {
    // Fallback: last-ditch string slicing for the outermost <svg>
    const startTag = svgString.match(/<svg\b[^>]*>/i);
    const endTag = svgString.match(/<\/svg>/i);
    if (!startTag || !endTag) return null;
    const startIdx = startTag.index + startTag[0].length;
    const endIdx = svgString.lastIndexOf("</svg>");
    const inner = svgString.slice(startIdx, endIdx).trim();

    // try to read a viewBox from the start tag
    const vbMatch = startTag[0].match(/\bviewBox="([^"]+)"/i);
    let viewBox = vbMatch ? vbMatch[1] : null;
    if (!viewBox) {
      const wMatch = startTag[0].match(/\bwidth="([^"]+)"/i);
      const hMatch = startTag[0].match(/\bheight="([^"]+)"/i);
      if (wMatch && hMatch) {
        const w = (wMatch[1] || "").replace(/[^0-9.\-]/g, "");
        const h = (hMatch[1] || "").replace(/[^0-9.\-]/g, "");
        if (w && h) viewBox = `0 0 ${w} ${h}`;
      }
    }
    if (!viewBox) return null;
    return { viewBox, inner };
  }
}

/**
 * Find the best <svg> block (handles nesting) and return { viewBox, inner }.
 * Strategy:
 *  1) Collect ALL <svg>...</svg> blocks by walking the string with a stack.
 *  2) Score each block by depth + presence of vector tags.
 *  3) Choose the highest-score block; read viewBox or synthesize from width/height.
 */
function extractViewBoxAndInner(svgString) {
  const blocks = findSvgBlocks(svgString);
  if (!blocks.length) return null;

  // Score blocks: deeper (nested) svg with vector content wins
  const vectorRe = /<(path|polygon|polyline|circle|ellipse|rect|g|use)\b/i;

  const scored = blocks.map(b => {
    const hasVector = vectorRe.test(b.content);
    // prefer deeper and with vector content
    const score = (b.depth * 10) + (hasVector ? 5 : 0) + Math.min(5, (b.content.match(vectorRe) || []).length);
    return { ...b, hasVector, score };
  });

  // sort by score desc, then by length desc (more content tends to be the real one)
  scored.sort((a, b) => b.score - a.score || b.content.length - a.content.length);

  for (const cand of scored) {
    const startTag = cand.startTag;
    const attrs = parseStartTagAttrs(startTag);
    let viewBox = attrs.viewBox || synthesizeViewBox(attrs.width, attrs.height);
    if (!viewBox) continue;

    // inner is everything between the chosen <svg ...> and </svg>
    const inner = cand.content.trim();
    if (!inner) continue;

    return { viewBox: String(viewBox), inner };
  }

  // As a last resort, try the outermost block
  const outer = scored[scored.length - 1];
  if (outer) {
    const attrs = parseStartTagAttrs(outer.startTag);
    const vb = attrs.viewBox || synthesizeViewBox(attrs.width, attrs.height);
    if (vb && outer.content.trim()) {
      return { viewBox: String(vb), inner: outer.content.trim() };
    }
  }

  return null;
}

/** Lightweight attribute parser for an <svg ...> start tag. */
function parseStartTagAttrs(startTag) {
  const attrs = {};
  // Strip "<svg" and the ending ">"
  const body = startTag.replace(/^<svg\b/i, "").replace(/>$/,"");
  // Match key="value" or key='value'
  const re = /(\w[\w:-]*)\s*=\s*("(?:[^"]*)"|'(?:[^']*)')/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const key = m[1];
    const val = m[2].slice(1, -1); // drop quotes
    attrs[key] = val;
  }
  return attrs;
}

/**
 * Return ALL <svg ...>...</svg> blocks with depth info.
 * We walk the string, pushing indices on <svg ...> and popping on </svg>.
 * Output: [{ start, end, startTag, content, depth }]
 */
function findSvgBlocks(s) {
  const openRe = /<svg\b[^>]*>/ig;
  const closeRe = /<\/svg>/ig;

  // Collect all open and close tag positions
  const tags = [];
  let m;
  while ((m = openRe.exec(s)) !== null) {
    tags.push({ type: "open", index: m.index, len: m[0].length, text: m[0] });
  }
  while ((m = closeRe.exec(s)) !== null) {
    tags.push({ type: "close", index: m.index, len: m[0].length, text: m[0] });
  }
  // Order by position
  tags.sort((a, b) => a.index - b.index);

  const res = [];
  const stack = [];
  for (const t of tags) {
    if (t.type === "open") {
      stack.push(t);
    } else {
      // pop matching open
      const open = stack.pop();
      if (!open) continue;
      const start = open.index;
      const end = t.index + t.len;
      const startTagEnd = open.index + open.len;
      const content = s.slice(startTagEnd, t.index);
      const depth = stack.length + 1; // deeper if more opens remain
      res.push({
        start,
        end,
        startTag: open.text,
        content,
        depth
      });
    }
  }
  return res;
}

function findFirstSvgNode(preserveOrderDoc) {
  // preserveOrderDoc is an array of nodes like { svg: [ {attr}, ...children ] }, { g: [...] }, { "#text": "..." }, ...
  const stack = Array.isArray(preserveOrderDoc) ? [...preserveOrderDoc] : [preserveOrderDoc];
  while (stack.length) {
    const node = stack.shift();
    if (!node || typeof node !== "object") continue;
    if (node.svg) return node;
    // push children arrays
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (Array.isArray(val)) stack.push(...val);
    }
  }
  return null;
}

// stringify children back to XML
function stringifyInner(nodes) {
  return nodes.map(n => toXml(n)).join("");
}

function toXml(node) {
  if (node == null) return "";
  if (typeof node === "string") return escapeText(node);
  if (typeof node !== "object") return String(node);

  // text nodes from fast-xml-parser
  if (node["#text"] != null) return escapeText(String(node["#text"]));

  // element nodes: { tagName: [ {attrs}, ...children ] }
  const keys = Object.keys(node);
  if (!keys.length) return "";

  const tag = keys[0];
  const arr = node[tag];
  if (!Array.isArray(arr) || !arr.length) return `<${tag}/>`;
  const attrs = arr[0] && typeof arr[0] === "object" && !Array.isArray(arr[0]) ? arr[0] : {};
  const children = arr.slice(1);

  const attrsStr = Object.entries(attrs)
    .filter(([k,v]) => v != null && k !== "#text")
    .map(([k,v]) => `${k}="${escapeAttr(String(v))}"`)
    .join(" ");

  const open = attrsStr ? `<${tag} ${attrsStr}>` : `<${tag}>`;
  if (!children.length) return `${open}</${tag}>`;
  return `${open}${children.map(c => toXml(c)).join("")}</${tag}>`;
}

function escapeText(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function escapeAttr(s) {
  return s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
}

function synthesizeViewBox(width, height) {
  if (!width || !height) return null;
  const w = String(width).replace(/[^0-9.\-]/g, "");
  const h = String(height).replace(/[^0-9.\-]/g, "");
  if (!w || !h) return null;
  return `0 0 ${w} ${h}`;
}

/**
 * Recolor inner markup:
 * - STRIP removes fill/stroke + style fill/stroke fragments
 * - currentColor: wraps in <g fill="currentColor" stroke="currentColor">
 * - mono:#hex: wraps in <g fill="#hex" stroke="#hex">
 */
function recolorInner(inner, mode, strip) {
  let s = inner;

  if (strip) {
    s = s
      .replace(/\sfill="[^"]*"/gi, "")
      .replace(/\sstroke="[^"]*"/gi, "")
      .replace(/\sstyle="[^"]*?fill:[^;"]*;?[^"]*"/gi, m => m.replace(/fill:[^;"]*;?/gi, ""))
      .replace(/\sstyle="[^"]*?stroke:[^;"]*;?[^"]*"/gi, m => m.replace(/stroke:[^;"]*;?/gi, ""));
  }

  if (mode === "currentcolor") {
    return `<g fill="currentColor" stroke="currentColor">${s}</g>`;
  }

  const monoMatch = /^mono:(#[0-9a-f]{3}(?:[0-9a-f]{3})?)$/i.exec(mode);
  if (monoMatch) {
    const col = monoMatch[1];
    return `<g fill="${col}" stroke="${col}">${s}</g>`;
  }

  return s; // keep
}
