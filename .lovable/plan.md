## Goal

Let the super admin add a practitioner directly from `/admin/app/practitioners` by entering their name, email and profession. The system creates the account, sets it up as a practitioner, marks the practice as approved (super-admin invited → no separate approval step), and sends a branded invite email so the practitioner can set their password and sign in.

## What the super admin sees

At the top of the **All Practitioners** page, above the current list:

```text
┌────────────────────────────────────────────────┐
│  Invite a practitioner                         │
│  ─────────────────────────────────────────────  │
│  Full name         [                    ]       │
│  Email             [                    ]       │
│  Profession        [ Physiotherapist  ▾ ]      │
│  Practice name     [ optional          ]       │
│                                                │
│  [  Send invite  ]     status message here     │
└────────────────────────────────────────────────┘
```

On success: green confirmation "Invite sent to <email>", form resets, list refreshes so the new practitioner appears (Active badge).
On duplicate email: amber notice "This email is already registered — profile updated to practitioner."
On error: red message with the reason.

## Behind the scenes

1. **New server function** `adminInvitePractitioner` (`src/lib/admin-invite-practitioner.functions.ts`)
   - Auth-gated via `requireSupabaseAuth`, then verified as super admin via the existing `is_super_admin` RPC.
   - Validates input with zod (email, full name, profession required; practice name optional).
   - Checks whether an auth user with that email already exists:
     - If not → `supabaseAdmin.auth.admin.inviteUserByEmail(email, { data: { full_name, role: 'practitioner' }, redirectTo: '<site>/practitioner/login' })`. This triggers the existing auth webhook at `/lovable/email/auth/webhook`, which uses the already-scaffolded **invite** React Email template — so the branded Buddy invite email is sent automatically with a set-password link.
     - If yes → skip the invite email; report `alreadyExisted: true`.
   - Upserts `profiles` row with `role='practitioner'`, `full_name`, `profession`.
   - Upserts `practices` row with `is_approved=true`, `onboarding_complete=false`, `profession`, and the optional `practice_name`. (`ignoreDuplicates` so re-inviting doesn't clobber existing practice data.)
   - Returns `{ ok, userId, alreadyExisted }`.

2. **UI update** `src/routes/admin.app.practitioners.tsx`
   - Add an `<InvitePractitionerCard />` above the existing list.
   - Uses the same Buddy dark-navy card styling as the rest of the admin views (`var(--navy-card)`, `var(--navy-border)`, Rajdhani UI font, Cold Blue accent).
   - Profession select mirrors the practitioner signup options (Physiotherapist, Chiropractor, Osteopath, Biokineticist, Strength & Conditioning Coach, Other).
   - On submit → calls `adminInvitePractitioner`, shows inline status, then calls the existing `load()` so the new row appears.

## Email

No new template needed — the invite email template is already scaffolded and wired through the auth webhook. The Supabase invite flow (`inviteUserByEmail`) is the standard mechanism that fires it. If the user later wants a different invite copy specifically for practitioners (vs. clients), that's a separate follow-up.

## Files touched

- **New:** `src/lib/admin-invite-practitioner.functions.ts`
- **Edit:** `src/routes/admin.app.practitioners.tsx` (add form section + submit handler)

## Out of scope

- No changes to the existing self-signup flow (`/practitioner/signup`) or the pending-approval logic — practitioners who sign up themselves still hit the current approval gate.
- No changes to the auth email template itself; branding is already in place.
- No client-invite flow changes.
