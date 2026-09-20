/**
 * Who a practitioner may see on dashboard / alerts.
 *
 * Group practice: the owner (admin) sees every client in the practice.
 * Members see only their assigned caseload. Super-admin on this surface is
 * not a licence to dump the whole platform — they use the admin app.
 */
export type PracticeClientScope =
  | { mode: "practice"; practiceId: string }
  | { mode: "own"; practitionerId: string };

export function resolvePracticeClientScope(input: {
  userId: string;
  practiceId: string | null;
  isOwner: boolean;
}): PracticeClientScope {
  if (input.isOwner && input.practiceId) {
    return { mode: "practice", practiceId: input.practiceId };
  }
  return { mode: "own", practitionerId: input.userId };
}
