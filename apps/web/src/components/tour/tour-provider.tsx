/**
 * TourProvider — mounts the NextStep engine at the layout root.
 *
 * Responsibilities:
 * 1. Fetch /api/tours/my when the user is authenticated.
 * 2. Map TourDto[] → NextStep Tour[] (resolve i18n keys, map step fields).
 * 3. Autostart the first incomplete tour 1500ms after data is ready.
 * 4. Debounce progress PATCH calls (500ms) to avoid burst requests.
 * 5. Mark body[data-tour-active] for CSS beacon scoping.
 * 6. Clear tour store on logout.
 */
"use client";

import { useCallback, useEffect, useRef } from "react";
import { NextStepProvider, NextStep, useNextStep } from "nextstepjs";
import type { Tour } from "nextstepjs";
import { useAuthStore } from "@/stores/auth.store";
import { useTourStore } from "@/stores/tour.store";
import { apiGet, apiPut } from "@/lib/api";
import { tTour } from "@/lib/tour-i18n";
import TourPopover from "./tour-popover";
import TourLiveRegion from "./tour-live-region";
import type { TourDto } from "@/types/admin";
import "@/styles/tour.css";

// ── Inner component — has access to useNextStep() ────────────────────
function TourEngine({ children }: { children: React.ReactNode }) {
  const { startNextStep, closeNextStep, setCurrentStep } = useNextStep();
  const { isAuthenticated, accessToken, user } = useAuthStore();
  const {
    status,
    tours,
    activeTourId,
    autoStartHandled,
    setTours,
    setStatus,
    setActiveTour,
    markAutoStartHandled,
    clear,
  } = useTourStore();

  const lang = user?.preferredLanguage ?? "id";

  // Debounce ref for progress PATCH
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch tours on auth ready ──────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !accessToken || status !== "idle") return;

    setStatus("loading");
    apiGet<TourDto[]>("/api/tours/my")
      .then((data) => {
        setTours(data);
        setStatus("ready");
      })
      .catch(() => {
        setStatus("error");
      });
  }, [isAuthenticated, accessToken, status, setTours, setStatus]);

  // ── Autostart first incomplete tour ────────────────────────────────
  // A ref guards against re-entry. Calling markAutoStartHandled() inside the
  // effect synchronously is unsafe: the store update triggers a re-render and
  // the cleanup clears the pending setTimeout before it fires. The ref lets us
  // dedupe without depending on store state for the guard.
  const autoStartScheduledRef = useRef(false);
  useEffect(() => {
    if (status !== "ready" || autoStartHandled || tours.length === 0) return;
    if (autoStartScheduledRef.current) return;

    const target = tours.find(
      (t) =>
        t.isActive &&
        t.steps.length > 0 &&
        (t.progress === null ||
          (!t.progress.isCompleted && !t.progress.isSkipped)),
    );

    if (!target) {
      markAutoStartHandled();
      return;
    }

    autoStartScheduledRef.current = true;

    const timerId = setTimeout(() => {
      markAutoStartHandled();
      setActiveTour(target.id);
      startNextStep(target.id);

      // Resume at last seen step if applicable
      const progress = target.progress;
      if (progress && progress.lastStepIndex > 0) {
        const arrayPos = target.steps.findIndex(
          (s) => s.stepIndex === progress.lastStepIndex,
        );
        if (arrayPos > 0) {
          setTimeout(() => {
            setCurrentStep(arrayPos, 100);
          }, 100);
        }
      }
    }, 1500);

    return () => clearTimeout(timerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, autoStartHandled, tours.length]);

  // ── Body attribute for CSS beacon scoping ─────────────────────────
  useEffect(() => {
    if (activeTourId) {
      document.body.setAttribute("data-tour-active", "true");
    } else {
      document.body.removeAttribute("data-tour-active");
    }
    return () => {
      document.body.removeAttribute("data-tour-active");
    };
  }, [activeTourId]);

  // ── Clear store on logout ──────────────────────────────────────────
  useEffect(() => {
    const unsub = useAuthStore.subscribe((state, prevState) => {
      if (prevState.isAuthenticated && !state.isAuthenticated) {
        closeNextStep();
        clear();
      }
    });
    return unsub;
  }, [clear, closeNextStep]);

  // ── Progress callback (debounced 500ms) ────────────────────────────
  const handleStepChange = useCallback(
    (stepArrayIndex: number, tourId: string | null) => {
      if (!tourId) return;

      const tour = tours.find((t) => t.id === tourId);
      if (!tour) return;

      const step = tour.steps[stepArrayIndex];
      if (!step) return;

      const stepIndex = step.stepIndex;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        apiPut(`/api/tours/${tourId}/progress`, {
          stepIndex,
          action: "next",
        }).catch(() => {
          // Progress save failure is non-critical; tour continues
        });
      }, 500);
    },
    [tours],
  );

  const handleComplete = useCallback(
    (tourId: string | null) => {
      if (!tourId) return;

      const tour = tours.find((t) => t.id === tourId);
      if (!tour || tour.steps.length === 0) return;

      const lastStep = tour.steps[tour.steps.length - 1];
      if (!lastStep) return;

      setActiveTour(null);
      apiPut(`/api/tours/${tourId}/progress`, {
        stepIndex: lastStep.stepIndex,
        action: "complete",
      }).catch(() => {});
    },
    [tours, setActiveTour],
  );

  const handleSkip = useCallback(
    (stepArrayIndex: number, tourId: string | null) => {
      if (!tourId) return;

      const tour = tours.find((t) => t.id === tourId);
      if (!tour) return;

      const step = tour.steps[stepArrayIndex];
      const stepIndex = step?.stepIndex ?? 0;

      setActiveTour(null);
      apiPut(`/api/tours/${tourId}/progress`, {
        stepIndex,
        action: "skip",
      }).catch(() => {});
    },
    [tours, setActiveTour],
  );

  // ── Map TourDto[] → NextStep Tour[] ───────────────────────────────
  const nextStepTours: Tour[] = tours.map((tour) => ({
    tour: tour.id,
    steps: tour.steps.map((step, idx) => ({
      icon: null,
      title: tTour(lang, step.title),
      content: tTour(lang, step.description),
      selector: step.targetElement,
      side: step.position === "auto" ? "bottom" : step.position,
      pointerRadius: 8,
      pointerPadding: 4,
      // Cross-page navigation: tell NextStep where to go after/before this step
      nextRoute:
        idx < tour.steps.length - 1
          ? tour.steps[idx + 1]?.route
          : undefined,
      prevRoute: idx > 0 ? tour.steps[idx - 1]?.route : undefined,
    })),
  }));

  return (
    <NextStep
      steps={nextStepTours}
      cardComponent={TourPopover}
      shadowRgb="0,0,0"
      shadowOpacity="0.4"
      displayArrow={true}
      clickThroughOverlay={false}
      scrollToTop={false}
      onStepChange={handleStepChange}
      onComplete={handleComplete}
      onSkip={handleSkip}
    >
      {children}
    </NextStep>
  );
}

// ── Public export — wraps NextStepProvider ────────────────────────────
export default function TourProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextStepProvider>
      <TourEngine>
        {children}
        <TourLiveRegion />
      </TourEngine>
    </NextStepProvider>
  );
}
