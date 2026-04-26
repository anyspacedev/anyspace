import { useEffect } from "react";

/**
 * Snapshot whatever was focused at the time the consumer activates and
 * refocus it on deactivation. Use for modals/dialogs/popovers so closing
 * returns focus to the trigger button instead of dropping to <body>.
 *
 * Pass `active` to gate by an open/closed flag when the consumer keeps the
 * trigger and the modal in the same component (the modal isn't actually
 * mounted/unmounted — only its `open` state toggles).
 *
 * For consumers that conditionally render the modal element itself
 * (mount on open, unmount on close), the default `active = true` is fine
 * — the hook captures on mount and restores on unmount.
 */
export function useFocusReturn(active: boolean = true): void {
  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      if (prev && typeof prev.focus === "function" && document.body.contains(prev)) {
        prev.focus({ preventScroll: true });
      }
    };
  }, [active]);
}
