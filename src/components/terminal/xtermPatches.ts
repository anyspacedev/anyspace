import type { Terminal as XTerm } from "@xterm/xterm";

// Stable empty dimensions returned when the underlying renderer is missing.
// Mirrors the shape produced by xterm's RenderService so callers that read
// `dimensions.css.canvas.height` or `dimensions.css.cell.height` see zeros
// instead of throwing on `undefined.dimensions`.
const EMPTY_DIMENSIONS = Object.freeze({
  css: Object.freeze({
    canvas: Object.freeze({ width: 0, height: 0 }),
    cell: Object.freeze({ width: 0, height: 0 }),
  }),
  device: Object.freeze({
    canvas: Object.freeze({ width: 0, height: 0 }),
    cell: Object.freeze({ width: 0, height: 0 }),
    char: Object.freeze({ width: 0, height: 0, top: 0, left: 0 }),
  }),
});

const PATCHED = Symbol.for("anyspace.xterm.renderService.patched");

type RenderServiceLike = {
  _renderer?: { value?: { dimensions?: unknown } };
};

// xterm's RenderService.dimensions getter is `this._renderer.value.dimensions`.
// During React StrictMode unmount or any fast tab/pane swap, Viewport's
// constructor-scheduled `setTimeout(() => syncScrollArea())` can fire AFTER
// term.dispose() has nulled `_renderer.value`, throwing
// `TypeError: undefined is not an object (evaluating 'this._renderer.value.dimensions')`.
// We patch the prototype once to fall back to a stable empty-dimensions stub.
export function hardenRenderService(term: XTerm): void {
  const rs = (term as unknown as { _core?: { _renderService?: RenderServiceLike } })._core?._renderService;
  if (!rs) return;
  const proto = Object.getPrototypeOf(rs) as object & { [PATCHED]?: true };
  if (!proto || proto[PATCHED]) return;
  const desc = Object.getOwnPropertyDescriptor(proto, "dimensions");
  if (!desc?.get) return;
  const orig = desc.get;
  Object.defineProperty(proto, "dimensions", {
    configurable: true,
    get(this: RenderServiceLike) {
      if (!this._renderer?.value) return EMPTY_DIMENSIONS;
      try {
        return orig.call(this);
      } catch {
        return EMPTY_DIMENSIONS;
      }
    },
  });
  proto[PATCHED] = true;
}
