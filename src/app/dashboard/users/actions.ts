"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// First real set of Server Actions in the app. Every one runs on the
// privileged service-role client (bypasses RLS + grants), so authorization is
// entirely our job: requireAdmin() re-verifies the caller server-side from the
// session cookie — NEVER from a client-passed argument — BEFORE any service
// client is constructed. A single missing gate is a privilege-escalation hole.

export interface ActionResult {
  error: string | null;
}

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES = ["admin", "accountant", "salesman", "godown"] as const;
type Role = (typeof ROLES)[number];

// The action gate. Throws (never returns) for a non-admin so a caller can
// never accidentally proceed past it — and it runs before createServiceClient,
// so a rejected caller triggers zero mutations. Returns the caller's own id
// for the self-lockout guards.
async function requireAdmin(): Promise<{ callerId: string }> {
  const supabase = await createClient(); // RLS, session-scoped
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: me } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();
  if (!me || !me.active || me.role !== "admin") throw new Error("Forbidden");
  return { callerId: user.id };
}

// True when demoting/deactivating `targetId` would leave zero active admins.
// Counts active admins other than the target; if the target isn't currently an
// active admin, the change can't reduce the count, so it's always allowed.
async function wouldOrphanAdmins(
  service: ReturnType<typeof createServiceClient>,
  targetId: string,
): Promise<boolean> {
  const { data: target } = await service
    .from("profiles")
    .select("role, active")
    .eq("id", targetId)
    .maybeSingle();
  if (!target || target.role !== "admin" || !target.active) return false;
  const { count } = await service
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("active", true);
  return (count ?? 0) <= 1;
}

export async function createUser(input: {
  email: string;
  password: string;
  username: string;
  full_name: string;
  role: string;
}): Promise<ActionResult> {
  await requireAdmin();

  const email = input.email.trim();
  const username = input.username.trim();
  const full_name = input.full_name.trim();
  const role = input.role;
  const password = input.password;

  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (!USERNAME_RE.test(username))
    return { error: "Username must be 3–20 characters: letters, numbers, dot or underscore." };
  if (!full_name) return { error: "Display name is required." };
  if (!ROLES.includes(role as Role)) return { error: "Pick a valid role." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const service = createServiceClient();

  // Friendly pre-check (DB citext-unique is the real guard, caught below too).
  const { data: dupe } = await service.from("profiles").select("id").eq("username", username).maybeSingle();
  if (dupe) return { error: "That username is already taken." };

  // D3: auto-confirm — no verification email round-trip.
  const {
    data: { user },
    error: createErr,
  } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr || !user) {
    const msg = createErr?.message ?? "";
    if (/already|registered|exists/i.test(msg)) return { error: "That email is already in use." };
    return { error: msg || "Could not create the user." };
  }

  // The create_profile_for_new_user trigger already inserted the row (role
  // salesman, username null, full_name = email) in the same txn; set our app
  // fields. If this fails (e.g. a username race), the account still exists as a
  // salesman with no username — inert (can't username-login) and fixable via
  // the Edit modal. We never delete it (guardrail: deactivate, never delete).
  const { error: profErr } = await service.from("profiles").update({ username, full_name, role }).eq("id", user.id);
  if (profErr) {
    if (/duplicate key|unique/i.test(profErr.message)) return { error: "That username is already taken." };
    return { error: profErr.message };
  }
  return { error: null };
}

export async function updateUserProfile(
  targetId: string,
  input: { username: string; full_name: string; role: string },
): Promise<ActionResult> {
  const { callerId } = await requireAdmin();

  const username = input.username.trim();
  const full_name = input.full_name.trim();
  const role = input.role;

  if (!USERNAME_RE.test(username))
    return { error: "Username must be 3–20 characters: letters, numbers, dot or underscore." };
  if (!full_name) return { error: "Display name is required." };
  if (!ROLES.includes(role as Role)) return { error: "Pick a valid role." };

  // Self-lockout: an admin can't strip their own admin role.
  if (targetId === callerId && role !== "admin") return { error: "You can't remove your own admin role." };

  const service = createServiceClient();

  // Last-admin guard: block a demotion that would leave zero active admins.
  if (role !== "admin" && (await wouldOrphanAdmins(service, targetId)))
    return { error: "There must be at least one active admin." };

  const { data: dupe } = await service
    .from("profiles")
    .select("id")
    .eq("username", username)
    .neq("id", targetId)
    .maybeSingle();
  if (dupe) return { error: "That username is already taken." };

  const { error } = await service.from("profiles").update({ username, full_name, role }).eq("id", targetId);
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return { error: "That username is already taken." };
    return { error: error.message };
  }
  return { error: null };
}

export async function resetUserPassword(targetId: string, password: string): Promise<ActionResult> {
  await requireAdmin();
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const service = createServiceClient();
  const { error } = await service.auth.admin.updateUserById(targetId, { password });
  if (error) return { error: error.message };
  return { error: null };
}

export async function setUserActive(targetId: string, active: boolean): Promise<ActionResult> {
  const { callerId } = await requireAdmin();

  // Self-lockout: an admin can't deactivate their own account.
  if (targetId === callerId && !active) return { error: "You can't deactivate your own account." };

  const service = createServiceClient();

  // Last-admin guard: block a deactivation that would leave zero active admins.
  if (!active && (await wouldOrphanAdmins(service, targetId)))
    return { error: "There must be at least one active admin." };

  const { error } = await service.from("profiles").update({ active }).eq("id", targetId);
  if (error) return { error: error.message };
  return { error: null };
}
