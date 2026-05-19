/**
 * useTour — convenience wrapper over NextStep's useNextStep context.
 *
 * IMPORTANT: This hook calls useNextStep() internally, which means it can
 * ONLY be called from components rendered inside the <NextStep> provider
 * tree. Do NOT call useTour() in components outside TourProvider's children.
 *
 * Responsibilities:
 * - startTour(id): set active tour, kick off NextStep, resume at correct step
 * - closeTour(): close NextStep, clear active tour in store
 * - restartTour(id): reset progress via API, refetch tours, start from step 0
 * - refetchTours(): re-fetches /api/tours/my and refreshes the store
 *
 * Resume logic:
 *   Backend does NOT reindex stepIndex when filtering permissions. The returned
 *   steps array might be [idx0→stepIndex0, idx1→stepIndex1, idx2→stepIndex3].
 *   progress.lastStepIndex is the DB stepIndex value (e.g. 3), not the array
 *   position (2). We always derive array position via findIndex.
 */

"use client";

import { useCallback } from "react";
import { useNextStep } from "nextstepjs";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth.store";
import { useTourStore } from "@/stores/tour.store";
import { apiGet, apiPut } from "@/lib/api";
import type { TourDto } from "@/types/admin";

export function useTour() {
  const { startNextStep, closeNextStep, setCurrentStep } = useNextStep();
  const { tours, setTours, setActiveTour, setStatus, setPendingStart } =
    useTourStore();
  const router = useRouter();
  const pathname = usePathname();

  const refetchTours = useCallback(async (): Promise<TourDto[]> => {
    setStatus("loading");
    try {
      const fetched = await apiGet<TourDto[]>("/api/tours/my");
      setTours(fetched);
      setStatus("ready");
      return fetched;
    } catch {
      setStatus("error");
      return [];
    }
  }, [setTours, setStatus]);

  const startTour = useCallback(
    (tourId: string, currentTours?: TourDto[]) => {
      const tourList = currentTours ?? tours;
      const tour = tourList.find((t) => t.id === tourId);
      if (!tour || tour.steps.length === 0) return;

      // Determine resume position from server-side progress
      const progress = tour.progress;
      let arrayPos = 0;
      if (progress && !progress.isCompleted && !progress.isSkipped) {
        const idx = tour.steps.findIndex(
          (s) => s.stepIndex === progress.lastStepIndex,
        );
        arrayPos = idx > 0 ? idx : 0;
      }

      const startStep = tour.steps[arrayPos];
      if (!startStep) return;

      // If the first step's route differs from the current page, stage a
      // pending intent in the tour store and navigate. The current component
      // (often a button on /admin/profile) is about to unmount, so we can't
      // rely on a local setTimeout. TourProvider lives at the root layout
      // and survives the route change; it watches pendingStartTourId +
      // pathname and fires the actual startNextStep when both align.
      if (startStep.route !== pathname) {
        setPendingStart(tourId);
        router.push(startStep.route);
        return;
      }

      setActiveTour(tourId);
      startNextStep(tourId);
      if (arrayPos > 0) {
        // Give NextStep a tick to mount before seeking the resume position.
        setTimeout(() => {
          setCurrentStep(arrayPos, 100);
        }, 100);
      }
    },
    [
      tours,
      pathname,
      router,
      startNextStep,
      setCurrentStep,
      setActiveTour,
      setPendingStart,
    ],
  );

  const closeTour = useCallback(() => {
    closeNextStep();
    setActiveTour(null);
  }, [closeNextStep, setActiveTour]);

  const restartTour = useCallback(
    async (tourId: string) => {
      const { accessToken } = useAuthStore.getState();
      if (!accessToken) return;

      try {
        await apiPut(`/api/tours/${tourId}/restart`);
        const refreshed = await refetchTours();
        // Give layout a tick to settle after data refresh
        setTimeout(() => {
          startTour(tourId, refreshed);
        }, 300);
      } catch {
        // Silently ignore — tour restart failing is non-critical
      }
    },
    [refetchTours, startTour],
  );

  return {
    tours,
    startTour,
    closeTour,
    restartTour,
    refetchTours,
  };
}
