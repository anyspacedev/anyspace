import { motion, useReducedMotion } from "framer-motion";
import { useId, useMemo } from "react";

type SphereState = "idle" | "listening";

interface Props {
  size?: number;
  state?: SphereState;
  className?: string;
  ariaLabel?: string;
}

/**
 * 6-point bezier blob path. r0/r1/r2 jitter the radius along three axes
 * to produce a slight, organic morph between keyframes. Returned as a
 * cubic-bezier closed path centered on (cx, cy).
 */
function blobPath(cx: number, cy: number, base: number, r0: number, r1: number, r2: number) {
  const points = [base, base * r0, base * r1, base, base * r2, base * r0];
  const n = points.length;
  const angle = (i: number) => (i * 2 * Math.PI) / n - Math.PI / 2;
  const cps: { x: number; y: number }[] = points.map((r, i) => ({
    x: cx + Math.cos(angle(i)) * r,
    y: cy + Math.sin(angle(i)) * r,
  }));

  let d = `M ${cps[0].x.toFixed(2)} ${cps[0].y.toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = cps[(i - 1 + n) % n];
    const p1 = cps[i];
    const p2 = cps[(i + 1) % n];
    const p3 = cps[(i + 2) % n];
    const cp1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const cp2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${cp1.x.toFixed(2)} ${cp1.y.toFixed(2)}, ${cp2.x.toFixed(2)} ${cp2.y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d + " Z";
}

export default function VoiceSphere({
  size = 140,
  state = "idle",
  className = "",
  ariaLabel = "AnySpace listening indicator",
}: Props) {
  const reduce = useReducedMotion();
  const filterId = useId();
  const cx = size / 2;
  const cy = size / 2;
  const ringStroke = Math.max(1, size / 90);

  const middleBase = size * 0.32;
  const innerBase = size * 0.2;

  // Four morph keyframes — slight asymmetric jitter for "living" feel.
  const middleKeyframes = useMemo(() => {
    return [
      blobPath(cx, cy, middleBase, 1.0, 1.0, 1.0),
      blobPath(cx, cy, middleBase, 1.07, 0.94, 1.03),
      blobPath(cx, cy, middleBase, 0.97, 1.06, 0.96),
      blobPath(cx, cy, middleBase, 1.04, 0.99, 1.05),
      blobPath(cx, cy, middleBase, 1.0, 1.0, 1.0),
    ];
  }, [cx, cy, middleBase]);

  const breathDuration = state === "listening" ? 1.8 : 3.2;
  const morphDuration = state === "listening" ? 3.6 : 5.2;
  const morphAmplitude = state === "listening" ? 1 : 0.6;

  // Reduced-motion: render a static set of rings + a slow opacity pulse on the core.
  if (reduce) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
        className={className}
      >
        <circle cx={cx} cy={cy} r={size * 0.46} fill="none" stroke="currentColor" strokeWidth={ringStroke} opacity="0.18" />
        <circle cx={cx} cy={cy} r={size * 0.32} fill="none" stroke="currentColor" strokeWidth={ringStroke} opacity="0.42" />
        <circle cx={cx} cy={cy} r={innerBase} fill="currentColor" className="animate-pulse-soft" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel}
      className={className}
    >
      <defs>
        <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3">
            <animate
              attributeName="baseFrequency"
              dur="9s"
              values="0.85;1.1;0.85"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale={size * 0.05} />
        </filter>
      </defs>

      {/* Outer breath ring — scales subtly to convey "alive" */}
      <motion.circle
        cx={cx}
        cy={cy}
        r={size * 0.46}
        fill="none"
        stroke="currentColor"
        strokeWidth={ringStroke}
        strokeOpacity={0.18}
        filter={`url(#${filterId})`}
        style={{ originX: `${cx}px`, originY: `${cy}px` }}
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: breathDuration, ease: "easeInOut", repeat: Infinity }}
      />

      {/* Middle ring — organic blob morph */}
      <motion.path
        fill="none"
        stroke="currentColor"
        strokeWidth={ringStroke * 1.2}
        strokeOpacity={0.5 * morphAmplitude + 0.25}
        animate={{ d: middleKeyframes }}
        transition={{ duration: morphDuration, ease: [0.22, 1, 0.36, 1], repeat: Infinity }}
        initial={{ d: middleKeyframes[0] }}
      />

      {/* Inner core — opacity shimmer */}
      <motion.circle
        cx={cx}
        cy={cy}
        r={innerBase}
        fill="currentColor"
        animate={{ opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
      />
    </svg>
  );
}
