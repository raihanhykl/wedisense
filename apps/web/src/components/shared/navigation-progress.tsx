"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Thin top-of-page progress bar that gives the user instant feedback
// during route navigation. App Router doesn't expose router events
// natively (gone since pages-router) so we lean on two signals:
//
//   1. Anchor-click capture — the moment a user clicks an in-app
//      <a> / <Link>, surface the bar. Server thinking time + the
//      next render then happens behind the bar.
//   2. Pathname / searchParams settle — once Next.js commits the new
//      URL, we drift the bar to 100% and fade it out.
//
// Deliberately dependency-free (no nprogress / nextjs-toploader) to
// keep the JS bundle small. The visible width is driven by a state
// machine: idle → starting → running → completing → idle.

type Stage = "idle" | "starting" | "running" | "completing";

const TICK_MS = 200;
const COMPLETE_FADE_MS = 220;
// "Cap" the indeterminate phase well below 100% so the user knows
// something is still pending. The 90% step is the standard nprogress
// behaviour — close enough to feel responsive without misleading.
const RUNNING_CAP = 90;

export default function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [stage, setStage] = useState<Stage>("idle");
  const [width, setWidth] = useState(0);

  // ── 1. Anchor-click capture ─────────────────────────────────────────
  // We capture in the bubbling phase so per-element handlers run first;
  // Next.js' Link rendering attaches its own click handler that calls
  // router.push synchronously, so by the time we run, navigation is
  // already underway. We only care about same-origin, primary-button
  // clicks without modifiers — anything else (new-tab, download) we
  // leave alone.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      // Walk up to find an <a>; Link renders an <a> with href.
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      // External / mail / download links — out of scope.
      if (
        href.startsWith("http") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        anchor.hasAttribute("download") ||
        (anchor.getAttribute("target") ?? "") === "_blank"
      ) {
        return;
      }
      // Same-route fragment jumps shouldn't trigger the bar.
      if (href.startsWith("#")) return;

      setStage("starting");
    };
    document.addEventListener("click", handler, { capture: false });
    return () => document.removeEventListener("click", handler);
  }, []);

  // ── 2. Path / search-params settle → finish ─────────────────────────
  // The pathname update is the signal that the new segment has rendered
  // (or at least its loading.tsx). Drift to 100% then idle.
  useEffect(() => {
    if (stage === "starting" || stage === "running") {
      setStage("completing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  // ── State machine: starting → running ramp → completing → idle ──────
  useEffect(() => {
    if (stage === "idle") {
      setWidth(0);
      return;
    }
    if (stage === "starting") {
      // Snap to a visible width immediately so the user sees motion on
      // click, then transition to the slow ramp.
      setWidth(20);
      const t = setTimeout(() => setStage("running"), 60);
      return () => clearTimeout(t);
    }
    if (stage === "running") {
      // Asymptotic ramp toward RUNNING_CAP. Each tick adds a fraction
      // of the remaining distance — fast at first, slowing as we
      // approach the cap. Mimics nprogress.
      const interval = setInterval(() => {
        setWidth((current) => {
          if (current >= RUNNING_CAP) return current;
          const remaining = RUNNING_CAP - current;
          return current + remaining * 0.15;
        });
      }, TICK_MS);
      return () => clearInterval(interval);
    }
    if (stage === "completing") {
      setWidth(100);
      const t = setTimeout(() => setStage("idle"), COMPLETE_FADE_MS);
      return () => clearTimeout(t);
    }
    return;
  }, [stage]);

  // Hide entirely when idle to keep the DOM noise-free for screen
  // readers and devtools inspectors.
  if (stage === "idle") return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 right-0 top-0 z-[999] h-0.5"
    >
      <div
        className="h-full bg-primary shadow-[0_0_8px_rgba(59,130,246,0.7)] transition-[width,opacity] duration-200 ease-out"
        style={{
          width: `${width}%`,
          opacity: stage === "completing" ? 0 : 1,
        }}
      />
    </div>
  );
}
