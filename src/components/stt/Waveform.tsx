// Live frequency-bar waveform driven by an AnalyserNode.
// Reads --accent / --fg-dim from CSS vars so it re-skins with the theme.

import { useEffect, useRef } from "react";

const BARS = 24;
const BAR_W = 2;
const BAR_GAP = 3;
const FLOOR = 3;

type Props = { analyser: AnalyserNode | null };

export function Waveform({ analyser }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const dpr = window.devicePixelRatio || 1;
    const cssW = (BARS * BAR_W + (BARS - 1) * BAR_GAP);
    const cssH = 28;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.scale(dpr, dpr);

    const styles = getComputedStyle(document.documentElement);
    const colorActive = styles.getPropertyValue("--accent").trim() || "#7c5cff";
    const colorFloor = styles.getPropertyValue("--fg-dim").trim() || "#5b6478";

    let raf = 0;

    const drawStatic = () => {
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = colorFloor;
      for (let i = 0; i < BARS; i++) {
        const x = i * (BAR_W + BAR_GAP);
        const y = (cssH - FLOOR) / 2;
        ctx.fillRect(x, y, BAR_W, FLOOR);
      }
    };

    if (!analyser || reduce) {
      drawStatic();
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, cssW, cssH);

      // Map analyser bins → BARS, take the local max in each bucket.
      const step = Math.max(1, Math.floor(data.length / BARS));
      for (let i = 0; i < BARS; i++) {
        let peak = 0;
        for (let j = 0; j < step; j++) {
          const v = data[i * step + j] ?? 0;
          if (v > peak) peak = v;
        }
        // peak: 0..255 → bar height
        const norm = peak / 255;
        const h = Math.max(FLOOR, Math.round(norm * (cssH - 4)));
        const y = (cssH - h) / 2;
        const x = i * (BAR_W + BAR_GAP);
        ctx.fillStyle = norm > 0.05 ? colorActive : colorFloor;
        ctx.fillRect(x, y, BAR_W, h);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return <canvas ref={canvasRef} className="stt-waveform" aria-hidden="true" />;
}
