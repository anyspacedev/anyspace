// Teamship preview element picker — runs in every frame at document_start.
// Listens for postMessage commands from the parent window and reports the
// element the user clicks back via postMessage. Cross-origin safe.
(() => {
  if (typeof window === "undefined" || window.__teamshipPicker) return;
  const SRC = "teamship";
  const OVERLAY_ID = "__teamship_picker_overlay__";
  const HINT_ID = "__teamship_picker_hint__";
  const MAX_HTML = 2048;
  const MAX_TEXT = 120;
  const MAX_PARENTS = 3;

  let active = false;
  let overlay = null;
  let hint = null;
  let prevCursor = "";

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483646",
      border: "2px solid #5cc8ff",
      background: "rgba(92,200,255,0.18)",
      boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
      transition: "all 60ms linear",
      display: "none",
      top: "0",
      left: "0",
      width: "0",
      height: "0",
      margin: "0",
      padding: "0",
      boxSizing: "border-box",
    });
    hint = document.createElement("div");
    hint.id = HINT_ID;
    Object.assign(hint.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483647",
      font: "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      color: "#fff",
      background: "rgba(20,20,28,0.92)",
      padding: "2px 6px",
      borderRadius: "4px",
      maxWidth: "60vw",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      display: "none",
    });
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(hint);
    return overlay;
  }

  function paint(el) {
    if (!el || !(el instanceof Element)) return;
    ensureOverlay();
    const r = el.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.top = r.top + "px";
    overlay.style.left = r.left + "px";
    overlay.style.width = r.width + "px";
    overlay.style.height = r.height + "px";
    hint.style.display = "block";
    hint.textContent = describe(el);
    const hintTop = r.top - 22 < 4 ? r.bottom + 6 : r.top - 22;
    hint.style.top = Math.max(4, hintTop) + "px";
    hint.style.left = Math.max(4, r.left) + "px";
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.classList && el.classList.length) {
      s += "." + Array.from(el.classList).slice(0, 3).join(".");
    }
    return s;
  }

  function onMove(e) {
    const target = e.target;
    if (target instanceof Element) paint(target);
  }

  function onClick(e) {
    const target = e.target;
    if (!(target instanceof Element)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const payload = serialize(target);
    try {
      window.parent.postMessage({ src: SRC, type: "picker:selected", payload }, "*");
    } catch {}
    deactivate();
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        window.parent.postMessage({ src: SRC, type: "picker:cancelled" }, "*");
      } catch {}
      deactivate();
    }
  }

  function activate() {
    if (active) return;
    active = true;
    ensureOverlay();
    prevCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseover", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    document.documentElement.style.cursor = prevCursor;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseover", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    if (overlay) overlay.style.display = "none";
    if (hint) hint.style.display = "none";
  }

  function onMessage(e) {
    const msg = e && e.data;
    if (!msg || msg.src !== SRC) return;
    if (msg.type === "picker:start") activate();
    else if (msg.type === "picker:stop") deactivate();
    else if (msg.type === "drive:click") handleDrive("click", msg);
    else if (msg.type === "drive:fill") handleDrive("fill", msg);
  }

  // ---- programmatic drive (Code-Agent preview API) ----------------------
  // Same envelope as the picker — postMessage in, postMessage out — but
  // request/response style: every drive carries a reqId and the script
  // replies with `{type:"drive:result", reqId, ok, …}`. The parent matches
  // reqId in `previewDrive.ts` to resolve the awaiting HTTP request.
  function handleDrive(kind, msg) {
    const reqId = msg && msg.reqId;
    const payload = (msg && msg.payload) || {};
    const reply = (extras) => {
      try {
        window.parent.postMessage(
          Object.assign({ src: SRC, type: "drive:result", reqId }, extras),
          "*",
        );
      } catch {}
    };
    try {
      if (kind === "click") {
        const sel = String(payload.selector || "");
        const el = sel ? document.querySelector(sel) : null;
        if (!el) return reply({ ok: false, matched: 0, error: "no match" });
        if (typeof el.click === "function") el.click();
        else el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return reply({ ok: true, matched: 1 });
      }
      if (kind === "fill") {
        const sel = String(payload.selector || "");
        const value = payload.value == null ? "" : String(payload.value);
        const submit = !!payload.submit;
        const el = sel ? document.querySelector(sel) : null;
        if (!el) return reply({ ok: false, matched: 0, error: "no match" });
        // Use the native value setter so React's onChange listeners pick it up.
        const proto =
          el.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement && window.HTMLInputElement.prototype;
        const desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        if (submit) {
          const form = el.form || (el.closest && el.closest("form"));
          if (form && typeof form.requestSubmit === "function") form.requestSubmit();
          else if (form && typeof form.submit === "function") form.submit();
        }
        return reply({ ok: true, matched: 1 });
      }
      reply({ ok: false, error: `unknown drive kind: ${kind}` });
    } catch (err) {
      reply({ ok: false, error: (err && err.message) || String(err) });
    }
  }

  // ---- serialization -----------------------------------------------------

  const INTERESTING_ATTRS = new Set([
    "id",
    "name",
    "type",
    "role",
    "href",
    "src",
    "alt",
    "title",
    "value",
    "placeholder",
    "for",
    "label",
    "aria-label",
    "aria-labelledby",
    "aria-describedby",
  ]);

  function pickAttributes(el) {
    const out = {};
    for (const attr of el.attributes) {
      const n = attr.name;
      if (
        INTERESTING_ATTRS.has(n) ||
        n.startsWith("data-") ||
        n.startsWith("aria-")
      ) {
        out[n] = attr.value.length > 200 ? attr.value.slice(0, 200) + "…" : attr.value;
      }
    }
    return out;
  }

  function classList(el) {
    return el.classList ? Array.from(el.classList) : [];
  }

  function buildSelector(el) {
    if (!(el instanceof Element)) return "";
    if (el.id) return "#" + cssEscape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      const testid = node.getAttribute && node.getAttribute("data-testid");
      if (testid) {
        part += `[data-testid="${cssEscape(testid)}"]`;
        parts.unshift(part);
        break;
      }
      if (node.id) {
        part = "#" + cssEscape(node.id);
        parts.unshift(part);
        break;
      }
      const cls = classList(node)
        .filter((c) => /^[A-Za-z_][\w-]*$/.test(c))
        .slice(0, 2);
      if (cls.length) part += "." + cls.join(".");
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (c) => c.tagName === node.tagName,
        );
        if (sameTag.length > 1) {
          const idx = sameTag.indexOf(node) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(part);
      node = parent;
      if (parts.length > 6) break;
    }
    return parts.join(" > ");
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
  }

  function truncateHtml(html) {
    if (html.length <= MAX_HTML) return html;
    // Cut at the last `>` before the limit so we don't slice a tag in half.
    const slice = html.slice(0, MAX_HTML);
    const lastClose = slice.lastIndexOf(">");
    return (lastClose > 0 ? slice.slice(0, lastClose + 1) : slice) + "\n<!-- truncated -->";
  }

  function findFiberSource(el) {
    try {
      let fiber = null;
      for (const k of Object.keys(el)) {
        if (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")) {
          fiber = el[k];
          break;
        }
      }
      let depth = 0;
      while (fiber && depth < 20) {
        const src = fiber._debugSource;
        if (src && src.fileName) {
          return {
            file: String(src.fileName),
            line: typeof src.lineNumber === "number" ? src.lineNumber : undefined,
            column: typeof src.columnNumber === "number" ? src.columnNumber : undefined,
          };
        }
        fiber = fiber.return;
        depth++;
      }
    } catch {}
    return undefined;
  }

  function serialize(el) {
    const rect = el.getBoundingClientRect();
    const text = (el.textContent || "").trim().replace(/\s+/g, " ");
    const parents = [];
    let p = el.parentElement;
    while (p && parents.length < MAX_PARENTS && p !== document.documentElement) {
      parents.unshift({
        tag: p.tagName.toLowerCase(),
        id: p.id || undefined,
        classes: classList(p),
      });
      p = p.parentElement;
    }
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: classList(el),
      attributes: pickAttributes(el),
      textPreview: text ? (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "…" : text) : undefined,
      outerHTML: truncateHtml(el.outerHTML || ""),
      selector: buildSelector(el),
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      parents,
      source: findFiberSource(el),
      url: location.href,
    };
  }

  window.addEventListener("message", onMessage);
  window.__teamshipPicker = { activate, deactivate };
})();
