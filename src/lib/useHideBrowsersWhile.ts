import { useEffect } from "react";
import { useBrowserVisibilityStore } from "../stores/browserVisibilityStore";

/** Hides every browser-pane child WebView while `open` is true. Use this in
 *  any modal/overlay component that the main WebView renders on top of the
 *  page — child WebViews can't be z-ordered below the parent on
 *  Linux/WebKitGTK or Windows/WebView2, so we just hide them. The push/pop
 *  is reference-counted; multiple modals can stack safely. */
export function useHideBrowsersWhile(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const store = useBrowserVisibilityStore.getState();
    store.pushHide();
    return () => {
      useBrowserVisibilityStore.getState().popHide();
    };
  }, [open]);
}
