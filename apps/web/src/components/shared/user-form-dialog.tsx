"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, ChevronDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost, apiPut, apiGet } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import PasswordInput from "@/components/shared/password-input";
import LocationTreePicker from "@/components/shared/location-tree-picker";
import type {
  UserListItem,
  Role,
  Permission,
} from "@/types/admin";

// ── Local assignment draft ─────────────────────────────────────────
//
// Wire-shape `{ roleId, locationId }` is what the API takes. While the
// admin is editing, we carry a `localId` for stable React keys and allow
// `roleId === null` for a fresh "+Add role" card that the user hasn't
// picked a role for yet. Filtered out on submit.
interface AssignmentDraft {
  localId: string;
  roleId: string | null;
  locationId: string | null;
}

function newDraftId(): string {
  // crypto.randomUUID exists in modern browsers + Node 14.17+. The
  // dialog is client-only ("use client"), so we're fine without polyfill.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Status enum kept in lockstep with backend Prisma + Zod
// (apps/api/src/modules/users/schema.ts → userStatusEnum). Earlier
// versions of this dialog used lowercase strings ("active"/"suspended")
// which silently failed the backend's 422 → swallowed catch → user saw
// no feedback at all. Always uppercase, always one of these three.
const STATUS_OPTIONS = ["ACTIVE", "INACTIVE", "RESIGNED"] as const;
type UserStatus = (typeof STATUS_OPTIONS)[number];

// A User row is an EMPLOYEE record; the login account on top of it is
// optional. The base schema covers the employee fields; email + password
// requirements are layered on by `buildSchema()` depending on whether an
// account is being created / already exists.
const employeeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  // Empty string = no email. Validated as an address only when present
  // (or when an account needs it — see buildSchema).
  email: z
    .string()
    .trim()
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "Invalid email",
    }),
  password: z.string().optional().default(""),
  // Backend requires a non-empty employee ID (uniqueness key). Form-level
  // guard so the user sees a clear error inline instead of a 422.
  employeeId: z.string().min(1, "Employee ID is required").max(50),
  phone: z.string().max(20).optional().default(""),
  status: z.enum(STATUS_OPTIONS),
});

type UserFormValues = z.infer<typeof employeeSchema>;

/**
 * - `needsEmail`   → the row has (or will get) an account: login is by
 *                     email, so it can't be blank.
 * - `needsPassword`→ an account is being CREATED in this submit. Edits of
 *                     an existing account never carry a password here —
 *                     that's the audited "Reset password" flow.
 */
function buildSchema(needsEmail: boolean, needsPassword: boolean) {
  return employeeSchema.superRefine((value, ctx) => {
    if (needsEmail && value.email === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Email is required for a login account",
      });
    }
    // Match backend's min (createUserSchema.password).
    if (needsPassword && value.password.length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: "Password must be at least 8 characters",
      });
    }
  });
}

interface UserFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingUser?: UserListItem | null;
  /** Open with "Create login account" already ticked (users page "Grant login" action). */
  initialCreateAccount?: boolean;
}

export default function UserFormDialog({
  open,
  onClose,
  onSuccess,
  editingUser,
  initialCreateAccount = false,
}: UserFormDialogProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [assignments, setAssignments] = useState<AssignmentDraft[]>([]);
  // Effective-permissions preview panel state. We fetch the permission
  // catalog and each assigned role's permission list lazily on first
  // open, then cache so subsequent toggles are instant.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [permissionCatalog, setPermissionCatalog] = useState<Permission[] | null>(
    null,
  );
  const [rolePermissionMap, setRolePermissionMap] = useState<
    Map<string, Permission[]>
  >(new Map());
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Server-side error surface. Without this the form silently swallowed
  // the 422 from /api/users (status enum / password length / employee
  // id) and the Save button appeared to do nothing.
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isEditing = !!editingUser;
  const hasExistingAccount = editingUser?.hasAccount ?? false;
  // "Create login account" checkbox. Irrelevant (and hidden) when the
  // employee already has one.
  const [createAccount, setCreateAccount] = useState(false);
  // Whether this submit ends with the employee holding an account — that
  // decides whether email + roles are mandatory.
  const willHaveAccount = hasExistingAccount || createAccount;

  const schema = useMemo(
    () => buildSchema(willHaveAccount, createAccount && !hasExistingAccount),
    [willHaveAccount, createAccount, hasExistingAccount],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UserFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      employeeId: "",
      phone: "",
      status: "ACTIVE",
    },
  });

  useEffect(() => {
    if (open) {
      // Locations are loaded on demand by the LocationTreePicker hook —
      // we don't need a separate fetch here. Just roles for the role
      // selector dropdown options.
      apiGet<Role[]>("/api/roles")
        .then((r) => setRoles(r))
        .catch(() => {});

      // Reset preview-panel cache so the next opening of the dialog
      // re-fetches role permissions — they may have changed via the
      // Roles & Permissions editor between dialog opens.
      setPreviewOpen(false);
      setPermissionCatalog(null);
      setRolePermissionMap(new Map());

      setSubmitError(null);
      setCreateAccount(initialCreateAccount && !(editingUser?.hasAccount ?? false));
      if (editingUser) {
        // Coerce the editing user's status to one of the known enum
        // members. Defensive: prevents a stale lowercased value (from
        // pre-fix data) from reaching the resolver and being rejected.
        const editingStatus = STATUS_OPTIONS.includes(
          editingUser.status as UserStatus,
        )
          ? (editingUser.status as UserStatus)
          : "ACTIVE";
        reset({
          name: editingUser.name,
          email: editingUser.email ?? "",
          password: "",
          employeeId: editingUser.employeeId ?? "",
          phone: editingUser.phone ?? "",
          status: editingStatus,
        });
        // Map existing user-role assignments to local drafts. Adds a
        // localId for stable React keys; the wire-shape only carries
        // roleId + locationId.
        setAssignments(
          (editingUser.userRoles ?? []).map((ur) => ({
            localId: newDraftId(),
            roleId: ur.roleId,
            locationId: ur.locationId,
          })),
        );
      } else {
        reset({
          name: "",
          email: "",
          password: "",
          employeeId: "",
          phone: "",
          status: "ACTIVE",
        });
        // Start a fresh user with one empty assignment card so the admin
        // immediately sees the role+scope picker — better discovery than
        // a blank list with a "+ Add" hint.
        setAssignments([{ localId: newDraftId(), roleId: null, locationId: null }]);
      }
    }
  }, [open, editingUser, reset, initialCreateAccount]);

  const addAssignment = () => {
    setAssignments((prev) => [
      ...prev,
      { localId: newDraftId(), roleId: null, locationId: null },
    ]);
  };

  const removeAssignment = (localId: string) => {
    setAssignments((prev) => prev.filter((a) => a.localId !== localId));
  };

  const updateAssignment = (localId: string, patch: Partial<AssignmentDraft>) => {
    setAssignments((prev) =>
      prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)),
    );
  };

  // Duplicate-scope detection. The DB enforces a unique constraint on
  // (userId, roleId, locationId), so submitting two cards with the same
  // pair would fail at save. Surface inline for early feedback.
  const duplicateLocalIds = useMemo(() => {
    const seen = new Map<string, string>(); // key → first localId
    const dupes = new Set<string>();
    for (const a of assignments) {
      if (!a.roleId) continue;
      const key = `${a.roleId}::${a.locationId ?? "global"}`;
      const first = seen.get(key);
      if (first) {
        dupes.add(a.localId);
        dupes.add(first);
      } else {
        seen.set(key, a.localId);
      }
    }
    return dupes;
  }, [assignments]);

  // ── Effective permissions preview ─────────────────────────────────
  //
  // Computed client-side from the cached role→permissions map. Each row
  // shows source attribution (which role(s) granted it). Loading lazily
  // — first toggle of the preview triggers fetches; subsequent toggles
  // reuse the cache for the dialog's lifetime.
  const ensurePreviewData = async () => {
    if (permissionCatalog === null) {
      setPreviewLoading(true);
      try {
        const catalog = await apiGet<Permission[]>("/api/permissions");
        setPermissionCatalog(catalog);
      } catch {
        // Fail silent — preview just won't render. Toast skipped to
        // avoid spamming the submit-error banner space.
        setPermissionCatalog([]);
      } finally {
        setPreviewLoading(false);
      }
    }
    // Fetch permission lists for any role we don't already have cached.
    const neededRoleIds = assignments
      .map((a) => a.roleId)
      .filter((id): id is string => !!id && !rolePermissionMap.has(id));
    if (neededRoleIds.length === 0) return;
    setPreviewLoading(true);
    try {
      const results = await Promise.all(
        Array.from(new Set(neededRoleIds)).map((id) =>
          apiGet<Array<{ permission: Permission }>>(
            `/api/roles/${id}/permissions`,
          ).then((rows) => ({ id, perms: rows.map((rp) => rp.permission) })),
        ),
      );
      setRolePermissionMap((prev) => {
        const next = new Map(prev);
        for (const { id, perms } of results) next.set(id, perms);
        return next;
      });
    } catch {
      // ignore — partial cache still renders what we have
    } finally {
      setPreviewLoading(false);
    }
  };

  const togglePreview = () => {
    const nowOpen = !previewOpen;
    setPreviewOpen(nowOpen);
    if (nowOpen) void ensurePreviewData();
  };

  // Re-fetch missing role permissions whenever the assignment set changes
  // while the preview panel is open.
  useEffect(() => {
    if (previewOpen) void ensurePreviewData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen, assignments]);

  // Compute the effective permission grid for display: each permission
  // becomes a row with the list of roles that granted it. Unioned across
  // all assignments; location scope doesn't filter the permission set
  // itself (location scopes accessibleLocationIds, not permissions —
  // see auth/service.ts:resolveAuthenticatedUser).
  const effectivePermissions = useMemo(() => {
    if (!permissionCatalog) return [];
    const granters = new Map<string, string[]>(); // permission key → role names
    for (const a of assignments) {
      if (!a.roleId) continue;
      const role = roles.find((r) => r.id === a.roleId);
      const perms = rolePermissionMap.get(a.roleId);
      if (!role || !perms) continue;
      for (const p of perms) {
        const key = `${p.resource}:${p.action}`;
        const prev = granters.get(key) ?? [];
        if (!prev.includes(role.name)) {
          granters.set(key, [...prev, role.name]);
        }
      }
    }
    // Group by resource for display.
    const grouped: Record<
      string,
      Array<{ permission: Permission; sources: string[] }>
    > = {};
    for (const p of permissionCatalog) {
      const sources = granters.get(`${p.resource}:${p.action}`) ?? [];
      (grouped[p.resource] ??= []).push({ permission: p, sources });
    }
    return Object.entries(grouped)
      .map(([resource, items]) => ({
        resource,
        items: items.sort((a, b) =>
          a.permission.action.localeCompare(b.permission.action),
        ),
      }))
      .sort((a, b) => a.resource.localeCompare(b.resource));
  }, [permissionCatalog, rolePermissionMap, assignments, roles]);

  // Filter draft assignments to wire-shape: drop empty cards (no role
  // selected). Used by both validation and submit so client + server
  // agree on what counts as a "real" assignment.
  const validAssignments = useMemo(
    () =>
      assignments
        .filter((a): a is AssignmentDraft & { roleId: string } => a.roleId !== null)
        .map((a) => ({ roleId: a.roleId, locationId: a.locationId })),
    [assignments],
  );

  // Roles only matter for someone who can sign in. A plain employee
  // record is saved without any, and the role section is hidden.
  const rolesRequired = willHaveAccount;
  const canSave =
    duplicateLocalIds.size === 0 && (!rolesRequired || validAssignments.length > 0);

  const onSubmit = async (data: UserFormValues) => {
    if (!canSave) {
      setSubmitError(
        rolesRequired && validAssignments.length === 0
          ? "A login account must have at least one role assigned."
          : "Resolve duplicate role/location pairs before saving.",
      );
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Build the payload to match the backend Zod schema:
      // - phone / email are nullable; turn an empty form input into null
      //   so it doesn't store as a literal empty string
      // - password is only sent when CREATING an account (edit flow for
      //   an existing account uses the dedicated reset-password dialog)
      const trimmedPhone = data.phone.trim();
      const email = data.email.trim() === "" ? null : data.email.trim();
      const payload: Record<string, unknown> = {
        name: data.name,
        email,
        employeeId: data.employeeId,
        phone: trimmedPhone === "" ? null : trimmedPhone,
        status: data.status,
      };

      let userId: string;
      if (editingUser) {
        await apiPut(`/api/users/${editingUser.id}`, payload);
        userId = editingUser.id;
        if (createAccount && !hasExistingAccount) {
          await apiPost(`/api/users/${userId}/account`, {
            email,
            password: data.password,
          });
        }
      } else {
        if (createAccount) payload.password = data.password;
        const created = await apiPost<{ id: string }>("/api/users", payload);
        userId = created.id;
      }

      // Assign roles — only for someone who can sign in, and only the
      // valid (non-empty) cards.
      if (willHaveAccount) {
        await apiPut(`/api/users/${userId}/roles`, {
          roles: validAssignments,
        });
      }

      toast.success(
        editingUser
          ? createAccount && !hasExistingAccount
            ? `Login account created for ${data.name}`
            : `Employee updated: ${data.name}`
          : createAccount
            ? `Employee + login account created: ${data.name}`
            : `Employee created: ${data.name}`,
      );
      onSuccess();
      onClose();
    } catch (err) {
      // Surface the actual reason — backend Zod errors carry a useful
      // `message` (e.g. "Email already exists", "Employee ID already
      // exists", "Password must be at least 8 characters"). Anything
      // generic falls back to a sensible default.
      setSubmitError(getApiErrorMessage(err, "Failed to save user"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <h2 className="mb-1 text-lg font-semibold">
          {isEditing ? "Edit Employee" : "Add Employee"}
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          {hasExistingAccount
            ? "This employee has a login account."
            : "Employee record for asset assignment and handover forms. A login account is optional."}
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              {...register("name")}
              className={cn(
                "w-full rounded-md border bg-background px-3 py-2 text-sm",
                errors.name && "border-destructive",
              )}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>

          {/* Employee ID + Phone */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Employee ID
              </label>
              <input
                {...register("employeeId")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Phone</label>
              <input
                {...register("phone")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="mb-1 block text-sm font-medium">Status</label>
            <select
              {...register("status")}
              className={cn(
                "w-full rounded-md border bg-background px-3 py-2 text-sm",
                errors.status && "border-destructive",
              )}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {/* Render as "Active" but submit the enum literal
                      "ACTIVE" so the backend accepts it directly. */}
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
            {errors.status && (
              <p className="mt-1 text-xs text-destructive">
                {errors.status.message}
              </p>
            )}
          </div>

          {/* Email — optional for a plain employee, required for an account. */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Email
              {!willHaveAccount && (
                <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
              )}
            </label>
            <input
              type="email"
              {...register("email")}
              className={cn(
                "w-full rounded-md border bg-background px-3 py-2 text-sm",
                errors.email && "border-destructive",
              )}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-destructive">
                {errors.email.message}
              </p>
            )}
          </div>

          {/* Login account — optional layer on top of the employee record. */}
          {!hasExistingAccount && (
            <div className="rounded-md border p-3" data-tour="user-create-account">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createAccount}
                  onChange={(e) => setCreateAccount(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span>
                  <span className="font-medium">Create login account</span>
                  <span className="block text-xs text-muted-foreground">
                    Most employees only hold assets and never sign in. Tick
                    this for staff who need to use Wedisense.
                  </span>
                </span>
              </label>
              {createAccount && (
                <div className="mt-3">
                  <label className="mb-1 block text-sm font-medium">Password</label>
                  <PasswordInput
                    autoComplete="new-password"
                    {...register("password")}
                    invalid={!!errors.password}
                    className="py-2"
                  />
                  {errors.password && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.password.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Role assignments — card per (role, location) pair. The
              backend allows multiple assignments of the same role with
              different location scopes (DB unique on the tuple), so the
              card model is more flexible than the previous checkbox UI.
              Only shown for someone who can sign in. */}
          {willHaveAccount && (
          <div>
            <label className="mb-2 block text-sm font-medium">
              Role assignments
            </label>
            <div className="space-y-2 rounded-md border p-2">
              {assignments.length === 0 ? (
                <p className="px-2 py-3 text-xs italic text-muted-foreground">
                  No roles assigned. Click + Add role assignment below.
                </p>
              ) : (
                assignments.map((a) => {
                  const isDuplicate = duplicateLocalIds.has(a.localId);
                  const isLastCard = assignments.length === 1;
                  // Disable Remove on the last remaining card iff the
                  // user has at least one valid assignment. Backend
                  // enforces min-1; client disables proactively for UX.
                  const removeDisabled =
                    isLastCard && validAssignments.length > 0;
                  return (
                    <div
                      key={a.localId}
                      className={cn(
                        "rounded-md border bg-background px-2 py-2",
                        isDuplicate && "border-amber-400",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 space-y-2">
                          {/* Role select */}
                          <select
                            value={a.roleId ?? ""}
                            onChange={(e) =>
                              updateAssignment(a.localId, {
                                roleId: e.target.value || null,
                              })
                            }
                            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                          >
                            <option value="">Select role…</option>
                            {roles.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                                {role.isSystem ? " (system)" : ""}
                              </option>
                            ))}
                          </select>
                          {/* Location scope picker — tree, not flat
                              dropdown. `null` value = global scope. */}
                          <LocationTreePicker
                            value={a.locationId}
                            onChange={(locationId) =>
                              updateAssignment(a.localId, { locationId })
                            }
                            placeholder="All locations (global)"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAssignment(a.localId)}
                          disabled={removeDisabled}
                          title={
                            removeDisabled
                              ? "User must have at least one role"
                              : "Remove assignment"
                          }
                          aria-label="Remove assignment"
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {isDuplicate && (
                        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-700">
                          <AlertTriangle className="h-3 w-3" />
                          Duplicate role + location pair
                        </p>
                      )}
                    </div>
                  );
                })
              )}
              <button
                type="button"
                onClick={addAssignment}
                className="inline-flex items-center gap-1 rounded-md border border-dashed bg-background px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                Add role assignment
              </button>
            </div>
            {validAssignments.length === 0 && (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                User must have at least one role
              </p>
            )}
          </div>
          )}

          {/* Effective permissions preview — collapsible. Loaded lazily
              on first toggle. Shows the union of permissions across all
              assigned roles with source attribution. Helpful for admins
              checking "what does this user actually get?" before save. */}
          {willHaveAccount && (
          <div className="rounded-md border">
            <button
              type="button"
              onClick={togglePreview}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              <span>Preview effective permissions</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  !previewOpen && "-rotate-90",
                )}
              />
            </button>
            {previewOpen && (
              <div className="max-h-64 overflow-y-auto border-t px-3 py-2">
                {previewLoading && effectivePermissions.length === 0 ? (
                  <p className="py-2 text-xs italic text-muted-foreground">
                    Loading…
                  </p>
                ) : validAssignments.length === 0 ? (
                  <p className="py-2 text-xs italic text-muted-foreground">
                    Assign at least one role to see effective permissions.
                  </p>
                ) : (
                  <div className="space-y-2 text-xs">
                    {effectivePermissions.map((group) => (
                      <div key={group.resource}>
                        <p className="font-semibold capitalize">
                          {group.resource.replace(/-/g, " ")}
                        </p>
                        <ul className="mt-0.5 space-y-0.5">
                          {group.items.map(({ permission, sources }) => (
                            <li
                              key={permission.id}
                              className={cn(
                                "flex items-baseline justify-between gap-2",
                                sources.length === 0 && "opacity-50",
                              )}
                            >
                              <span>
                                {sources.length > 0 ? "✓ " : "✗ "}
                                {permission.action}
                              </span>
                              <span className="text-muted-foreground">
                                {sources.length > 0
                                  ? `via ${sources.join(" + ")}`
                                  : "—"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {/* Server-side error surface. Sticks until the next submit
              attempt so the user can read the reason while editing. */}
          {submitError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {submitError}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !canSave}
              title={
                !canSave
                  ? rolesRequired && validAssignments.length === 0
                    ? "A login account must have at least one role"
                    : "Resolve duplicate role/location pairs"
                  : undefined
              }
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
