"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, RefreshCw, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth.store";
import { useTour } from "@/hooks/use-tour";
import { tTour } from "@/lib/tour-i18n";
import { TOURS_ENABLED } from "@/lib/feature-flags";

/**
 * Profile page — minimal Tier 6 scope.
 *
 * Two responsibilities: surface the account info the user already has
 * (name, email, employeeId, roles, language) and a "Restart Tutorial"
 * button per applicable tour. Password change / language switcher /
 * notification prefs land in Phase 14 (i18n) and later phases.
 */
export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const { tours, restartTour } = useTour();
  const [restartingId, setRestartingId] = useState<string | null>(null);

  const lang = user?.preferredLanguage ?? "id";

  if (!user) {
    // ProtectedRoute in admin/layout already gates this; defensive null
    // render avoids a TS narrow that would force optional chains downstream.
    return null;
  }

  const handleRestart = async (tourId: string, tourName: string) => {
    setRestartingId(tourId);
    try {
      await restartTour(tourId);
      toast.success(`${tTour(lang, "common.restartTutorial")} — ${tourName}`);
    } finally {
      setRestartingId(null);
    }
  };

  const progressLabel = (
    progress: NonNullable<typeof tours[number]["progress"]>,
    totalSteps: number,
  ): string => {
    if (progress.isCompleted) return tTour(lang, "profile.progressCompleted");
    if (progress.isSkipped) return tTour(lang, "profile.progressSkipped");
    return tTour(lang, "profile.progressInProgress", {
      current: progress.lastStepIndex + 1,
      total: totalSteps,
    });
  };

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {tTour(lang, "profile.backToDashboard")}
      </Link>

      <header className="mb-8 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UserIcon className="h-8 w-8" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{user.name}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
      </header>

      <section className="mb-6 rounded-lg border bg-card p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {tTour(lang, "profile.account")}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
          <dt className="text-muted-foreground">
            {tTour(lang, "profile.employeeId")}
          </dt>
          <dd>{user.employeeId || "—"}</dd>
          <dt className="text-muted-foreground">
            {tTour(lang, "profile.language")}
          </dt>
          <dd className="uppercase">{user.preferredLanguage}</dd>
          <dt className="text-muted-foreground">
            {tTour(lang, "profile.status")}
          </dt>
          <dd>{user.status}</dd>
          <dt className="text-muted-foreground">
            {tTour(lang, "profile.roles")}
          </dt>
          <dd>{user.roles.map((r) => r.name).join(", ") || "—"}</dd>
        </dl>
      </section>

      {/* Tutorial section gated by the TOURS_ENABLED feature flag — when
          off, in-app tours are dormant and the restart UI would point at
          a feature the user can't reach via the sidebar anyway. The hook
          calls above stay so flipping the flag back on requires zero
          edits here. */}
      {TOURS_ENABLED && (
      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {tTour(lang, "profile.tutorials")}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {tTour(lang, "profile.tutorialsDescription")}
        </p>
        {tours.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tTour(lang, "profile.noTutorials")}
          </p>
        ) : (
          <ul className="space-y-2">
            {tours.map((tour) => (
              <li
                key={tour.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{tour.name}</p>
                  {tour.description && (
                    <p className="truncate text-xs text-muted-foreground">
                      {tour.description}
                    </p>
                  )}
                  {tour.progress && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {progressLabel(tour.progress, tour.steps.length)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRestart(tour.id, tour.name)}
                  disabled={restartingId === tour.id}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      restartingId === tour.id ? "animate-spin" : ""
                    }`}
                  />
                  {tTour(lang, "common.restartTutorial")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
    </div>
  );
}
