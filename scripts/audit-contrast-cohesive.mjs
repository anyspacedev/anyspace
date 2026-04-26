// Post-pass: replace harsh #000000 accentFg/dangerFg with the theme's own bg
// color when that also passes 4.5:1 — for visual cohesion (dracula pattern).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
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
function contrast(h1, h2) {
  const l1 = relLuminance(hexToRgb(h1));
  const l2 = relLuminance(hexToRgb(h2));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
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
  themes.push({ id, name, kind, ui: tokens });
}

let swapped = 0;
for (const t of themes) {
  for (const fgKey of ["accentFg", "dangerFg"]) {
    const bgKey = fgKey === "accentFg" ? "accent" : "danger";
    if (t.ui[fgKey] !== "#000000") continue;
    const bg = t.ui[bgKey];
    if (!bg) continue;
    if (contrast(t.ui.bg, bg) >= 4.5) {
      // Swap to the theme bg color in-place — but only inside this theme's block.
      const marker = `id: "${t.id}"`;
      const startIdx = src.indexOf(marker);
      let endIdx = src.indexOf("terminal:", startIdx);
      const ansiIdx = src.indexOf("ansi:", startIdx);
      if (ansiIdx !== -1 && (endIdx === -1 || ansiIdx < endIdx)) endIdx = ansiIdx;
      if (endIdx === -1) continue;
      const before = src.slice(0, startIdx);
      let block = src.slice(startIdx, endIdx);
      const after = src.slice(endIdx);
      const r = new RegExp(`(\\b${fgKey}:\\s*)"#000000"`);
      if (r.test(block)) {
        block = block.replace(r, `$1"${t.ui.bg}"`);
        src = before + block + after;
        swapped++;
        console.log(`  ${t.id}: ${fgKey} #000000 → ${t.ui.bg}  (vs ${bg}: ${contrast(t.ui.bg, bg).toFixed(2)}:1)`);
      }
    }
  }
}

writeFileSync(defsPath, src);
console.log(`\n✓ Swapped ${swapped} aggressive black FGs with theme bg color.`);
