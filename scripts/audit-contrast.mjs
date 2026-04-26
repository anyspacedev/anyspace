// One-shot WCAG contrast audit + (optional) auto-patch across all themes.
// Run:
//   node scripts/audit-contrast.mjs            # report failures
//   node scripts/audit-contrast.mjs --suggest  # report failures + suggestions
//   node scripts/audit-contrast.mjs --apply    # rewrite definitions.ts in place

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const suggest = args.has("--suggest") || args.has("--apply");
const apply = args.has("--apply");
const defsPath = resolve(__dirname, "../src/themes/definitions.ts");
let src = readFileSync(defsPath, "utf8");

function relLuminance({ r, g, b }) {
  const ch = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex({ r, g, b }) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
function contrast(h1, h2) {
  const l1 = relLuminance(hexToRgb(h1));
  const l2 = relLuminance(hexToRgb(h2));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
function adjust(hex, deltaL) {
  const { r, g, b } = hexToRgb(hex);
  const r1 = r / 255, g1 = g / 255, b1 = b / 255;
  const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r1: h = (g1 - b1) / d + (g1 < b1 ? 6 : 0); break;
      case g1: h = (b1 - r1) / d + 2; break;
      default: h = (r1 - g1) / d + 4;
    }
    h /= 6;
  }
  const newL = Math.max(0, Math.min(1, l + deltaL));
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r2, g2, b2;
  if (s === 0) { r2 = g2 = b2 = newL; }
  else {
    const q = newL < 0.5 ? newL * (1 + s) : newL + s - newL * s;
    const p = 2 * newL - q;
    r2 = hue2rgb(p, q, h + 1 / 3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1 / 3);
  }
  return rgbToHex({ r: r2 * 255, g: g2 * 255, b: b2 * 255 });
}

const themes = [];
const uiRe = /id:\s*"([^"]+)"[\s\S]*?name:\s*"([^"]+)"[\s\S]*?kind:\s*"(dark|light)"[\s\S]*?ui:\s*\{([\s\S]*?)\n\s*\}/g;
let m;
while ((m = uiRe.exec(src))) {
  const [, id, name, kind, body] = m;
  const tokens = {};
  body.replace(/(\w+):\s*"(#[0-9a-fA-F]+)"/g, (_, k, v) => { tokens[k] = v; });
  themes.push({ id, name, kind, ui: tokens });
}
const mkRe = /mk\(\{[\s\S]*?id:\s*"([^"]+)"[\s\S]*?name:\s*"([^"]+)"[\s\S]*?kind:\s*"(dark|light)"[\s\S]*?\n\s*\}\)/g;
while ((m = mkRe.exec(src))) {
  const [block, id, name, kind] = m;
  if (themes.some((t) => t.id === id)) continue;
  const tokens = {};
  block.replace(/(\w+):\s*"(#[0-9a-fA-F]+)"/g, (_, k, v) => { tokens[k] = v; });
  if (!tokens.dangerFg) tokens.dangerFg = "#ffffff";
  themes.push({ id, name, kind, ui: tokens });
}

const PAIRS = [
  ["fg",       "bg",     4.5, "fg / bg"],
  ["fgMuted",  "bg",     4.5, "fgMuted / bg"],
  ["fgDim",    "bg",     3.0, "fgDim / bg (3:1)"],
  ["fgMuted",  "bgElev", 4.5, "fgMuted / bgElev"],
  ["fgDim",    "bgElev", 3.0, "fgDim / bgElev (3:1)"],
  ["accentFg", "accent", 4.5, "accentFg / accent"],
  ["dangerFg", "danger", 4.5, "dangerFg / danger"],
  ["fg",       "bgElev", 4.5, "fg / bgElev"],
];

function bestFgFor(bg, theme) {
  const candidates = ["#ffffff", "#000000", theme.ui.bg, theme.ui.fg];
  let best = "#ffffff", bestRatio = 0;
  for (const c of candidates) {
    const r = contrast(c, bg);
    if (r > bestRatio) { bestRatio = r; best = c; }
  }
  return { fg: best, ratio: bestRatio };
}
function adjustUntil(hex, against, threshold, kind) {
  let next = hex;
  const direction = kind === "dark" ? +0.02 : -0.02;
  for (let i = 0; i < 30; i++) {
    if (contrast(next, against) >= threshold) return next;
    next = adjust(next, direction);
  }
  return null;
}

let totalFails = 0;
const suggestions = {};

for (const t of themes) {
  for (const [fgKey, bgKey, threshold, label] of PAIRS) {
    const fg = t.ui[fgKey], bg = t.ui[bgKey];
    if (!fg || !bg) continue;
    const ratio = contrast(fg, bg);
    if (ratio < threshold) {
      totalFails++;
      let fix = null;
      if (fgKey === "accentFg" || fgKey === "dangerFg") {
        const best = bestFgFor(bg, t);
        if (best.ratio >= threshold) {
          fix = { token: fgKey, value: best.fg, newRatio: best.ratio.toFixed(2) };
        }
      } else if (fgKey === "fgDim" || fgKey === "fgMuted") {
        const adjusted = adjustUntil(fg, bg, threshold, t.kind);
        if (adjusted) fix = { token: fgKey, value: adjusted, newRatio: contrast(adjusted, bg).toFixed(2) };
      }
      suggestions[t.id] = suggestions[t.id] || [];
      suggestions[t.id].push({ label, fg, bg, ratio: ratio.toFixed(2), threshold, fgKey, fix });
    }
  }
}

console.log(`Themes: ${themes.length}  |  AA failures (with relaxed fgDim 3:1): ${totalFails}\n`);
for (const [id, list] of Object.entries(suggestions)) {
  console.log(`── ${id} ──`);
  for (const f of list) {
    console.log(`  ✗ ${f.label.padEnd(32)} ${f.fg} on ${f.bg}  ${f.ratio}`);
    if (suggest && f.fix) console.log(`    → ${f.fix.token}: ${f.fix.value}  → ${f.fix.newRatio}`);
  }
}

if (apply) {
  // Aggregate per-theme target token values (last suggestion wins; keys are unique per theme).
  // For each theme, build a map of token -> new value, then rewrite the line in src.
  for (const [id, list] of Object.entries(suggestions)) {
    const updates = {};
    for (const f of list) {
      if (!f.fix) continue;
      // Last write wins per token.
      updates[f.fix.token] = f.fix.value;
    }
    if (Object.keys(updates).length === 0) continue;

    // Locate this theme's block. We use the id marker; per-theme blocks end at the first `}` 2 levels up.
    // Easiest: target the substring from `id: "<id>"` to `terminal:` (the next sibling key).
    const marker = `id: "${id}"`;
    const startIdx = src.indexOf(marker);
    if (startIdx === -1) continue;
    // Find end of UI/ansi area — for explicit themes, look for `terminal: {`; for mk() blocks, look for `ansi:`.
    let endIdx = src.indexOf("terminal:", startIdx);
    const ansiIdx = src.indexOf("ansi:", startIdx);
    if (ansiIdx !== -1 && (endIdx === -1 || ansiIdx < endIdx)) endIdx = ansiIdx;
    if (endIdx === -1) continue;

    const before = src.slice(0, startIdx);
    let block = src.slice(startIdx, endIdx);
    const after = src.slice(endIdx);

    for (const [token, value] of Object.entries(updates)) {
      // Replace `token: "<#hex>"` — only the first match within block.
      const r = new RegExp(`(\\b${token}:\\s*)"#[0-9a-fA-F]+"`);
      if (r.test(block)) {
        block = block.replace(r, `$1"${value}"`);
      } else {
        // Token not present (mk extras don't list dangerFg) — inject before the closing brace.
        // Insert before `ansi:` for mk(), before terminal: for explicit. We're at the boundary.
        // Strategy: append a new line just before block ends.
        block = block.replace(/(\s*)$/, `,\n      ${token}: "${value}"$1`);
      }
    }

    src = before + block + after;
  }
  writeFileSync(defsPath, src);
  console.log("\n✓ Patched definitions.ts");
}
