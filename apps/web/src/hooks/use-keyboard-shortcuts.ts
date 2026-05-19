"use client";

import { useEffect } from "react";

export interface ShortcutBinding {
  /**
   * The key string as reported by KeyboardEvent.key. Use the literal char
   * for letters/numbers ("n", "/", "?") and the conventional names for
   * special keys ("Escape", "Enter", "ArrowUp"). Comparison is case-sensitive
   * so "?" and "/" don't conflict via Shift.
   */
  key: string;
  /** Handler — receives the event so the binding can call preventDefault. */
  run: (event: KeyboardEvent) => void;
  /** Whether to also prevent the browser default (search box focus, etc.). */
  preventDefault?: boolean;
}

/**
 * Page-level keyboard shortcuts. Skips firing when the user is typing into
 * an input, textarea, or contenteditable element, so a "/" inside a search
 * box doesn't trigger the global focus-search shortcut and create a
 * confusing recursion.
 *
 * `enabled` lets callers temporarily disable all bindings without
 * unmounting — useful when a modal owns the keyboard.
 */
export function useKeyboardShortcuts(
  bindings: ShortcutBinding[],
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        // Allow Escape to bubble through forms — it's a universal "abort"
        // key and most forms expect it to close themselves.
        if (e.key !== "Escape") return;
      }

      for (const b of bindings) {
        if (b.key === e.key) {
          if (b.preventDefault) e.preventDefault();
          b.run(e);
          return;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // `bindings` is re-created every parent render; we trust callers to
    // wrap their handlers in stable refs / useCallback when stability
    // matters. For the typical case (page-level shortcuts), the listener
    // attach/detach cost is negligible compared to a render.
  }, [bindings, enabled]);
}
