/**
 * Who should be told about an alert.
 *
 * Until now a red flag pushed to one person: the treating practitioner on the
 * alert row. In a five-practitioner practice that means a red flag raised while
 * that practitioner is hands-on with another patient sits unread, and the
 * escalation that would have chased it has never run in production.
 *
 * Justin asked on 2 October to receive red flag alerts himself, in hours and
 * after hours. This resolves the treating practitioner PLUS the practice owner,
 * deduplicated. Additive on purpose: nobody who was being told stops being
 * told. Only red flags fan out; ordinary alerts stay with the treating
 * practitioner so the owner's phone does not become noise.
 */

export type AlertFanout = {
  /** Auth user ids to notify, deduplicated, treating practitioner first. */
  userIds: string[];
  /** True when the practice owner was added on top of the treating practitioner. */
  includedOwner: boolean;
};

export interface RecipientLookup {
  /** The practice a client belongs to, or null. */
  practiceIdForClient(clientId: string): Promise<string | null>;
  /** The owning practitioner's auth user id for a practice, or null. */
  ownerForPractice(practiceId: string): Promise<string | null>;
}

/** Alert types that fan out to the practice owner as well. */
export const FANOUT_ALERT_TYPES: ReadonlySet<string> = new Set(["red_flag"]);

export async function resolveAlertRecipients(
  lookup: RecipientLookup,
  alert: { practitioner_id: string; client_id: string; alert_type?: string | null },
): Promise<AlertFanout> {
  const base = alert.practitioner_id;
  const type = alert.alert_type ?? "";
  if (!FANOUT_ALERT_TYPES.has(type)) {
    return { userIds: base ? [base] : [], includedOwner: false };
  }

  let owner: string | null = null;
  try {
    const practiceId = await lookup.practiceIdForClient(alert.client_id);
    if (practiceId) owner = await lookup.ownerForPractice(practiceId);
  } catch {
    // A lookup failure must never cost the treating practitioner their alert.
    owner = null;
  }

  const ids: string[] = [];
  if (base) ids.push(base);
  if (owner && owner !== base) ids.push(owner);
  return { userIds: ids, includedOwner: Boolean(owner) && owner !== base };
}

/** Supabase-backed lookup. Kept separate so the logic above stays testable. */
export function createRecipientLookup(admin: {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        col: string,
        val: string,
      ) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> };
    };
  };
}): RecipientLookup {
  return {
    async practiceIdForClient(clientId) {
      const { data } = await admin
        .from("clients")
        .select("practice_id")
        .eq("id", clientId)
        .maybeSingle();
      return (data?.practice_id as string | null) ?? null;
    },
    async ownerForPractice(practiceId) {
      const { data } = await admin
        .from("practices")
        .select("practitioner_id")
        .eq("id", practiceId)
        .maybeSingle();
      return (data?.practitioner_id as string | null) ?? null;
    },
  };
}
