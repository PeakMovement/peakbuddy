type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/**
 * Resolve an auth user id by email, paging through the full user list.
 *
 * A single listUsers page only returns 200 users, so a one-page lookup silently
 * fails for any account that sorts past the first page — breaking quick sign-in,
 * leaving "deleted" accounts still able to log in, and mis-inviting existing
 * practitioners. Page until a short page (bounded to 10k users for safety).
 */
export async function findAuthUserIdByEmail(admin: Admin, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 50; page += 1) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    const match = users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match.id;
    if (users.length < 200) break;
  }
  return null;
}
