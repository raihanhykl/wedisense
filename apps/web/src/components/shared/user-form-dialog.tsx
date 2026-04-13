"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiPost, apiPut, apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  UserListItem,
  UserRoleAssignment,
  Role,
  LocationFlat,
} from "@/types/admin";

const userCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  employeeId: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  status: z.string().min(1, "Status is required"),
});

const userEditSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().optional().default(""),
  employeeId: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  status: z.string().min(1, "Status is required"),
});

type UserCreateValues = z.infer<typeof userCreateSchema>;
type UserEditValues = z.infer<typeof userEditSchema>;
type UserFormValues = UserCreateValues | UserEditValues;

const STATUS_OPTIONS = ["active", "inactive", "suspended"];

interface UserFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingUser?: UserListItem | null;
}

export default function UserFormDialog({
  open,
  onClose,
  onSuccess,
  editingUser,
}: UserFormDialogProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [locations, setLocations] = useState<LocationFlat[]>([]);
  const [roleAssignments, setRoleAssignments] = useState<UserRoleAssignment[]>(
    [],
  );
  const [submitting, setSubmitting] = useState(false);

  const isEditing = !!editingUser;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UserFormValues>({
    resolver: zodResolver(isEditing ? userEditSchema : userCreateSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      employeeId: "",
      phone: "",
      status: "active",
    },
  });

  useEffect(() => {
    if (open) {
      Promise.all([
        apiGet<Role[]>("/api/roles"),
        apiGet<LocationFlat[]>("/api/locations"),
      ])
        .then(([r, l]) => {
          setRoles(r);
          setLocations(l);
        })
        .catch(() => {});

      if (editingUser) {
        reset({
          name: editingUser.name,
          email: editingUser.email,
          password: "",
          employeeId: editingUser.employeeId ?? "",
          phone: editingUser.phone ?? "",
          status: editingUser.status,
        });
        setRoleAssignments(
          (editingUser.userRoles ?? []).map((ur) => ({
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
          status: "active",
        });
        setRoleAssignments([]);
      }
    }
  }, [open, editingUser, reset]);

  const toggleRole = (roleId: string) => {
    setRoleAssignments((prev) => {
      const existing = prev.find((r) => r.roleId === roleId);
      if (existing) {
        return prev.filter((r) => r.roleId !== roleId);
      }
      return [...prev, { roleId, locationId: null }];
    });
  };

  const setRoleLocation = (roleId: string, locationId: string | null) => {
    setRoleAssignments((prev) =>
      prev.map((r) => (r.roleId === roleId ? { ...r, locationId } : r)),
    );
  };

  const onSubmit = async (data: UserFormValues) => {
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: data.name,
        email: data.email,
        employeeId: data.employeeId,
        phone: data.phone,
        status: data.status,
      };

      if (!isEditing && data.password) {
        payload.password = data.password;
      }

      let userId: string;
      if (editingUser) {
        await apiPut(`/api/users/${editingUser.id}`, payload);
        userId = editingUser.id;
      } else {
        const created = await apiPost<{ id: string }>("/api/users", payload);
        userId = created.id;
      }

      // Assign roles
      await apiPut(`/api/users/${userId}/roles`, {
        roles: roleAssignments,
      });

      onSuccess();
      onClose();
    } catch {
      // Error handling
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">
          {isEditing ? "Edit User" : "Add User"}
        </h2>

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

          {/* Email */}
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
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

          {/* Password (create only) */}
          {!isEditing && (
            <div>
              <label className="mb-1 block text-sm font-medium">
                Password
              </label>
              <input
                type="password"
                {...register("password")}
                className={cn(
                  "w-full rounded-md border bg-background px-3 py-2 text-sm",
                  errors.password && "border-destructive",
                )}
              />
              {errors.password && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>
          )}

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
              <option value="">Select status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
            {errors.status && (
              <p className="mt-1 text-xs text-destructive">
                {errors.status.message}
              </p>
            )}
          </div>

          {/* Roles */}
          <div>
            <label className="mb-2 block text-sm font-medium">Roles</label>
            <div className="space-y-2 rounded-md border p-3">
              {roles.map((role) => {
                const assignment = roleAssignments.find(
                  (r) => r.roleId === role.id,
                );
                const isChecked = !!assignment;

                return (
                  <div key={role.id} className="space-y-1">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleRole(role.id)}
                        className="h-4 w-4 rounded border"
                      />
                      <span className="text-sm">{role.name}</span>
                    </label>
                    {isChecked && (
                      <select
                        value={assignment?.locationId ?? ""}
                        onChange={(e) =>
                          setRoleLocation(
                            role.id,
                            e.target.value || null,
                          )
                        }
                        className="ml-6 w-[calc(100%-1.5rem)] rounded-md border bg-background px-2 py-1 text-xs"
                      >
                        <option value="">All locations</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name} ({l.code})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
              {roles.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No roles available
                </p>
              )}
            </div>
          </div>

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
              disabled={submitting}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
