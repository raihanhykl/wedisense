/**
 * TourPopover — custom shadcn-styled card component for NextStep.js.
 *
 * Receives CardComponentProps from NextStep and renders a polished popover
 * with full a11y: role="dialog", aria-modal, focus trap, keyboard shortcuts,
 * and a live-region update on every step change.
 *
 * Animation: framer-motion entry with reduced-motion awareness.
 * Responsive: max-w-[320px] desktop, full-width on mobile (< 640px).
 */
"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import { tTour } from "@/lib/tour-i18n";
import type { CardComponentProps } from "nextstepjs";

export default function TourPopover({
  step,
  currentStep,
  totalSteps,
  nextStep,
  prevStep,
  skipTour,
  arrow,
}: CardComponentProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const prefersReducedMotion = useReducedMotion();

  const lang = useAuthStore((s) => s.user?.preferredLanguage ?? "id");

  // ── Resolve i18n keys ────────────────────────────────────────────────
  // step.title and step.content may be i18n keys (e.g. "admin.dashboard.title")
  // or already-resolved strings. tTour falls back gracefully.
  const titleKey = typeof step.title === "string" ? step.title : "";
  const descKey =
    typeof step.content === "string" ? step.content : "";

  const title = tTour(lang, titleKey);
  const description = tTour(lang, descKey);

  const stepCounterText = tTour(lang, "common.stepCounter", {
    current: currentStep + 1,
    total: totalSteps,
  });
  const isLastStep = currentStep === totalSteps - 1;

  // ── Accessibility: live region update ───────────────────────────────
  useEffect(() => {
    const region = document.getElementById("tour-live-region");
    if (region) {
      region.textContent = `${stepCounterText}: ${title}`;
    }
  }, [currentStep, stepCounterText, title]);

  // ── Accessibility: auto-focus primary button on step change ─────────
  useEffect(() => {
    const primary = cardRef.current?.querySelector<HTMLElement>(
      "[data-tour-primary]",
    );
    if (primary) {
      // Defer by one frame so the motion animation doesn't clip the focus
      requestAnimationFrame(() => {
        primary.focus();
      });
    }
  }, [currentStep]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────
  // NextStep ships with its own keyboard handlers (Arrow Left/Right + Esc),
  // so we DON'T re-bind Escape here — that previously caused skipTour to
  // fire twice on a single keypress. We add Enter as our own convenience
  // (NextStep doesn't bind it), and only when focus is inside the popover
  // so the shortcut doesn't intercept Enter inside forms elsewhere on the
  // page while a tour is open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (cardRef.current?.contains(document.activeElement)) {
        nextStep();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nextStep]);

  // ── Focus trap ───────────────────────────────────────────────────────
  const getFocusable = useCallback((): HTMLElement[] => {
    if (!cardRef.current) return [];
    return Array.from(
      cardRef.current.querySelectorAll<HTMLElement>(
        'button, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
  }, []);

  useEffect(() => {
    const onTabKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (!cardRef.current?.contains(document.activeElement)) return;

      const focusable = getFocusable();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: wrap from first to last
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        // Tab: wrap from last to first
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onTabKeyDown);
    return () => window.removeEventListener("keydown", onTabKeyDown);
  }, [getFocusable]);

  // ── Animation variants ───────────────────────────────────────────────
  const motionProps = prefersReducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.15 },
      }
    : {
        initial: { opacity: 0, scale: 0.95, y: 4 },
        animate: { opacity: 1, scale: 1, y: 0 },
        transition: { duration: 0.2, ease: "easeOut" as const },
      };

  // Progress bar fill — 1-indexed because users expect "step 1 of 5" to
  // already register some progress on the bar, not start empty.
  const progressPct = ((currentStep + 1) / totalSteps) * 100;
  const progressLabel = tTour(lang, "common.progressLabel");

  return (
    <motion.div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className={cn(
        // Width: 360 on desktop (slight bump from 320 for breathing room with
        // the progress bar + actions). Mobile: viewport minus a 1rem gutter
        // on each side so the card never bleeds off-screen.
        "w-[360px] max-w-[calc(100vw-2rem)]",
        "overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xl",
      )}
      {...motionProps}
    >
      {/* Progress bar — flush with the top edge of the card. We render it
          outside the inner padding so it spans the full card width. The
          aria-* attrs expose progress to screen readers without needing
          a separate live region. */}
      <div
        role="progressbar"
        aria-label={progressLabel}
        aria-valuemin={0}
        aria-valuemax={totalSteps}
        aria-valuenow={currentStep + 1}
        className="h-1 w-full bg-muted"
      >
        <div
          className="h-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="p-4">
        {/* Header: title + close button */}
        <div className="mb-2 flex items-start justify-between gap-2">
          <h2
            id={titleId}
            className="text-base font-semibold leading-tight"
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label={tTour(lang, "common.close")}
            onClick={() => skipTour?.()}
            className={cn(
              // Slightly larger tap target on touch devices — 36px hits Apple's
              // and Material's accessibility minimum; we used 32 before.
              "inline-flex h-9 w-9 shrink-0 items-center justify-center",
              "rounded-md text-muted-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body — scrolls if a single step's description runs long on a
            short-viewport phone. Cap at 60vh so the popover never exceeds
            the screen. */}
        <p
          id={descId}
          className="max-h-[60vh] overflow-y-auto text-sm text-muted-foreground leading-relaxed"
        >
          {description}
        </p>

        {/* Divider + footer */}
        <div className="mt-3 border-t pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Step counter — left side */}
            <span className="text-xs text-muted-foreground">
              {stepCounterText}
            </span>

            {/* Buttons — right side */}
            <div className="flex items-center gap-1.5">
              {/* Prev — only shown when not on first step */}
              {currentStep > 0 && (
                <button
                  type="button"
                  onClick={prevStep}
                  className={cn(
                    "inline-flex h-9 items-center justify-center rounded-md px-3",
                    "text-sm font-medium text-foreground",
                    "hover:bg-accent hover:text-accent-foreground",
                    "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {tTour(lang, "common.previous")}
                </button>
              )}

              {/* Skip */}
              <button
                type="button"
                onClick={() => skipTour?.()}
                className={cn(
                  "inline-flex h-9 items-center justify-center rounded-md border px-3",
                  "text-sm font-medium",
                  "hover:bg-accent hover:text-accent-foreground",
                  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {tTour(lang, "common.skip")}
              </button>

              {/* Next / Finish — primary action */}
              <button
                type="button"
                data-tour-primary
                onClick={nextStep}
                className={cn(
                  "inline-flex h-9 items-center justify-center rounded-md px-3",
                  "text-sm font-medium",
                  "bg-primary text-primary-foreground",
                  "hover:bg-primary/90",
                  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {isLastStep
                  ? tTour(lang, "common.finish")
                  : tTour(lang, "common.next")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Arrow rendered by NextStep */}
      {arrow}
    </motion.div>
  );
}
