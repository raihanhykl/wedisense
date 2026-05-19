/**
 * Tour store — client-side state for the onboarding tour engine.
 *
 * Intentionally NOT persisted: tour data is fetched fresh from the API on
 * every authenticated session so that server-side progress is always the
 * source of truth. Stale client state (e.g. "tour was active on last tab")
 * leads to confusing re-starts.
 *
 * Auth cleanup: TourProvider subscribes to useAuthStore and calls clear()
 * on logout so the store resets between sessions.
 */

import { create } from "zustand";
import type { TourDto } from "@/types/admin";

type TourStatus = "idle" | "loading" | "ready" | "error";

interface TourState {
  tours: TourDto[];
  activeTourId: string | null;
  status: TourStatus;
  autoStartHandled: boolean;
}

interface TourActions {
  setTours: (tours: TourDto[]) => void;
  setStatus: (status: TourStatus) => void;
  setActiveTour: (id: string | null) => void;
  markAutoStartHandled: () => void;
  clear: () => void;
}

const INITIAL_STATE: TourState = {
  tours: [],
  activeTourId: null,
  status: "idle",
  autoStartHandled: false,
};

export const useTourStore = create<TourState & TourActions>()((set) => ({
  ...INITIAL_STATE,

  setTours: (tours) => set({ tours }),
  setStatus: (status) => set({ status }),
  setActiveTour: (id) => set({ activeTourId: id }),
  markAutoStartHandled: () => set({ autoStartHandled: true }),
  clear: () => set({ ...INITIAL_STATE }),
}));
