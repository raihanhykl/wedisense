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
import { useAuthStore } from "@/stores/auth.store";
import { useTourStore } from "@/stores/tour.store";
import { apiGet, apiPut } from "@/lib/api";
import type { TourDto } from "@/types/admin";

export function useTour() {
  const { startNextStep, closeNextStep, setCurrentStep } = useNextStep();
  const { tours, setTours, setActiveTour, setStatus } = useTourStore();

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

      setActiveTour(tourId);
      startNextStep(tourId);

      // Determine resume position from server-side progress
      const progress = tour.progress;
      if (progress && !progress.isCompleted && !progress.isSkipped) {
        const lastStepIndex = progress.lastStepIndex;
        const arrayPos = tour.steps.findIndex(
          (s) => s.stepIndex === lastStepIndex,
        );
        const resolvedPos = arrayPos > 0 ? arrayPos : 0;
        if (resolvedPos > 0) {
          // Give NextStep a tick to mount before seeking
          setTimeout(() => {
            setCurrentStep(resolvedPos, 100);
          }, 100);
        }
      }
    },
    [tours, startNextStep, setCurrentStep, setActiveTour],
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
