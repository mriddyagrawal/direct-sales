import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { UsersAdmin } from "./UsersAdmin";

export interface UserRow {
  id: string;
  username: string | null;
  full_name: string;
  role: string;
  active: boolean;
  email: string;
  created_at: string;
}

const ROLE_ORDER: Record<string, number> = { admin: 0, accountant: 1, salesman: 2, godown: 3 };

// Admin-only user management. TWO independent gates protect this: the page gate
// here (redirect any non-admin — the list exposes emails + roles) and, more
// importantly, an action gate inside every mutation (actions.ts). Middleware
// only separates salesman from staff, so an accountant reaches this route at
// the middleware layer — the redirect below is what actually stops them.
export default async function UsersPage() {
  const supabase = await createClient(); // RLS, session-scoped
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login"); // middleware guarantees this, but no non-null assertion (㊵)
  const { data: me } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();
  if (!me || !me.active || me.role !== "admin") redirect("/dashboard");

  // Only now (past the gate) do we reach for the privileged client: emails live
  // in auth.users (listUsers), app fields in profiles — merge by id.
  const service = createServiceClient();
  const [{ data: profiles }, { data: authList }] = await Promise.all([
    service.from("profiles").select("id, username, full_name, role, active, created_at"),
    service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const emailById = new Map<string, string>();
  for (const u of authList?.users ?? []) emailById.set(u.id, u.email ?? "");

  const users: UserRow[] = (profiles ?? [])
    .map((p) => ({
      id: p.id,
      username: p.username,
      full_name: p.full_name,
      role: p.role,
      active: p.active,
      email: emailById.get(p.id) ?? "",
      created_at: p.created_at,
    }))
    .sort(
      (a, b) =>
        (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
        a.full_name.localeCompare(b.full_name),
    );

  return <UsersAdmin users={users} callerId={user.id} />;
}
