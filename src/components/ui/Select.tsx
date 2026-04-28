import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { Icon } from "./Icon";

// Drop-in replacement for `<select>` that renders its own chevron via an
// inline <Icon>, so the chevron picks up `var(--fg-muted)` directly and
// stays correct across all 25+ themes. Uses appearance: none on the native
// select; the wrapper holds the chevron and forwards click-through.
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <span className="select-shell">
        <select ref={ref} className={className} {...rest}>
          {children}
        </select>
        <span className="select-chevron" aria-hidden="true">
          <Icon name="chevron-down" size={14} />
        </span>
      </span>
    );
  },
);
