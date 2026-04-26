// Lucide-style hand-rolled SVGs. 24px box, stroke=currentColor, 1.75 width.
// Inline so no extra dependency, no font flicker, and theme tokens drive color.

import type { ReactElement, SVGProps } from "react";

export type IconName =
  | "layers"
  | "list-checks"
  | "sparkles"
  | "settings"
  | "terminal"
  | "file-edit"
  | "globe"
  | "folder-tree"
  | "square-dashed"
  | "plus"
  | "x"
  | "chevron-down"
  | "chevron-up"
  | "chevron-left"
  | "chevron-right"
  | "check"
  | "alert-circle"
  | "dot"
  | "split-horizontal"
  | "split-vertical"
  | "play"
  | "search"
  | "refresh"
  | "external-link"
  | "folder"
  | "file"
  | "circle"
  | "mic";

type Props = SVGProps<SVGSVGElement> & { name: IconName; size?: number };

export function Icon({ name, size = 16, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}

const paths: Record<IconName, ReactElement> = {
  layers: (
    <>
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </>
  ),
  "list-checks": (
    <>
      <path d="M3 7h2.5l1.5 1.5L10 5.5" />
      <path d="M3 14h2.5L7 15.5l3-3" />
      <path d="M13 7h8" />
      <path d="M13 14h8" />
      <path d="M3 21h18" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M5 5l2 2" />
      <path d="M17 17l2 2" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="M5 19l2-2" />
      <path d="M17 7l2-2" />
      <path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4Z" />
    </>
  ),
  settings: (
    <>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  terminal: (
    <>
      <path d="m4 7 4 4-4 4" />
      <path d="M12 17h8" />
    </>
  ),
  "file-edit": (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <path d="m18 2 4 4-9 9h-4v-4l9-9Z" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
    </>
  ),
  "folder-tree": (
    <>
      <path d="M3 5a2 2 0 0 1 2-2h3l2 2h6a2 2 0 0 1 2 2v2H3V5Z" />
      <path d="M3 9h15v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
      <path d="M8 13h6" />
      <path d="M8 16h4" />
    </>
  ),
  "square-dashed": (
    <>
      <path d="M5 3h2" />
      <path d="M11 3h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v0" />
      <path d="M21 11v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h0" />
      <path d="M13 21h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v0" />
      <path d="M3 13v-2" />
      <path d="M3 7V5a2 2 0 0 1 2-2h0" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  x: (
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>
  ),
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-up": <path d="m6 15 6-6 6 6" />,
  "chevron-left": <path d="m15 6-6 6 6 6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  check: <path d="m5 12 4 4 10-10" />,
  "alert-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6" />
      <path d="M12 17h.01" />
    </>
  ),
  // `dot` intentionally fills (rest are stroke-only) — used as a small status pip.
  dot: <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />,
  "split-horizontal": (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 12h18" />
    </>
  ),
  "split-vertical": (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 3v18" />
    </>
  ),
  play: <path d="M7 4v16l13-8L7 4Z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  "external-link": (
    <>
      <path d="M14 4h6v6" />
      <path d="m20 4-9 9" />
      <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
    </>
  ),
  folder: <path d="M3 5a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z" />,
  file: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
      <path d="M14 3v6h6" />
    </>
  ),
  circle: <circle cx="12" cy="12" r="4" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </>
  ),
};
