import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LogOut, Trash2, Mail, Phone, ClipboardCheck, Settings as SettingsIcon, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { deleteMyAccount } from "@/lib/account-delete.functions";
import { updateMyEmail, updatePractitionerPhone } from "@/lib/client-profile.functions";
import { EditableTextField } from "@/routes/client.app.profile";
import {
  countPendingProgramSuggestions,
  getProgramsFeatureEnabled,
} from "@/lib/client-program.functions";
import type { Profile } from "@/lib/types";

export const Route = createFileRoute("/practitioner/app/profile")({
  head: () => ({ meta: [{ title: "Profile — Buddy" }] }),
  component: PractitionerProfile,
});

function PractitionerProfile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [programsEnabled, setProgramsEnabled] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const flag = await getProgramsFeatureEnabled();
        setProgramsEnabled(flag?.enabled !== false);
        if (flag?.enabled !== false) {
          const c = await countPendingProgramSuggestions().catch(() => 0);
          setQueueCount(typeof c === "number" ? c : 0);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        navigate({ to: "/practitioner/login" });
        return;
      }
      setEmail(u.user.email ?? null);
      setPhone(u.user.phone ?? null);
      const { data: prof } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", u.user.id)
        .maybeSingle();
      setProfile(prof as Profile | null);
      setLoading(false);
    })();
  }, [navigate]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/practitioner/login" });
  };

  const saveEmail = useServerFn(updateMyEmail);
  const [emailEdit, setEmailEdit] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const savePhone = useServerFn(updatePractitionerPhone);
  const [phoneEdit, setPhoneEdit] = useState(false);
  const [phoneValue, setPhoneValue] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const deleteAccount = useServerFn(deleteMyAccount);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await deleteAccount();
      if (res.ok) {
        await supabase.auth.signOut();
        navigate({ to: "/practitioner/login" });
        return;
      }
      setDeleteError(res.error ?? "Could not delete your account. Please try again.");
    } catch {
      setDeleteError("Could not delete your account. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div style={{ padding: 24, color: "var(--white-muted)" }}>Loading…</div>;

  return (
    <div style={{ padding: "24px 20px 32px" }}>
      <h1
        style={{
          fontFamily: "var(--font-hero)",
          fontWeight: 400,
          fontSize: 28,
          color: "var(--white)",
        }}
      >
        Profile
      </h1>

      <div
        style={{
          marginTop: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <ProfileField label="Name" value={profile?.full_name} />
        <EditableTextField
          label="Email"
          icon={<Mail size={12} />}
          type="email"
          placeholder="Enter email address"
          emptyText="Tap to add your email"
          currentValue={email}
          edit={emailEdit}
          value={emailValue}
          busy={emailBusy}
          error={emailError}
          onStartEdit={() => {
            setEmailValue(email || "");
            setEmailEdit(true);
            setEmailError(null);
          }}
          onCancel={() => setEmailEdit(false)}
          onChange={setEmailValue}
          onSave={async (val) => {
            const next = val.trim();
            if (!next) {
              setEmailError("Email is required.");
              return;
            }
            setEmailBusy(true);
            setEmailError(null);
            try {
              const res = await saveEmail({ data: { email: next } });
              setEmail(res.email);
              setEmailEdit(false);
            } catch (e: any) {
              setEmailError(e?.message || "Could not save email.");
            } finally {
              setEmailBusy(false);
            }
          }}
        />
        <EditableTextField
          label="Phone"
          icon={<Phone size={12} />}
          type="tel"
          placeholder="Enter phone number"
          emptyText="Tap to add your phone number"
          currentValue={phone}
          edit={phoneEdit}
          value={phoneValue}
          busy={phoneBusy}
          error={phoneError}
          onStartEdit={() => {
            setPhoneValue(phone || "");
            setPhoneEdit(true);
            setPhoneError(null);
          }}
          onCancel={() => setPhoneEdit(false)}
          onChange={setPhoneValue}
          onSave={async (val) => {
            setPhoneBusy(true);
            setPhoneError(null);
            try {
              await savePhone({ data: { phone: val.trim() || null } });
              setPhone(val.trim() || null);
              setPhoneEdit(false);
            } catch (e: any) {
              setPhoneError(e?.message || "Could not save phone number.");
            } finally {
              setPhoneBusy(false);
            }
          }}
        />
      </div>

      <button
        type="button"
        onClick={signOut}
        style={{
          marginTop: 32,
          minHeight: 48,
          width: "100%",
          background: "transparent",
          color: "var(--white-muted)",
          border: "1px solid var(--navy-border)",
          borderRadius: 8,
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <LogOut size={16} />
        Sign out
      </button>

      <DeleteAccountSection
        confirm={confirmDelete}
        deleting={deleting}
        error={deleteError}
        onAskConfirm={() => setConfirmDelete(true)}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteError(null);
        }}
        onConfirm={handleDeleteAccount}
      />
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          color: "var(--white-muted)",
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--white)",
          fontFamily: "var(--font-ui)",
          fontSize: 16,
          wordBreak: "break-word",
        }}
      >
        {value || "—"}
      </div>
    </div>
  );
}

function DeleteAccountSection({
  confirm,
  deleting,
  error,
  onAskConfirm,
  onCancel,
  onConfirm,
}: {
  confirm: boolean;
  deleting: boolean;
  error: string | null;
  onAskConfirm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 28,
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 8,
        padding: "16px 14px",
      }}
    >
      <div
        style={{
          color: "var(--white-muted)",
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        Delete account
      </div>
      <p
        style={{
          color: "var(--white-muted)",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          lineHeight: 1.5,
          margin: "0 0 14px",
        }}
      >
        Permanently delete your practitioner account. This also removes your practice and every
        patient you manage, including their check-ins, symptom notes and alerts. This cannot be
        undone.
      </p>

      {error && (
        <p
          style={{
            color: "var(--red, #ff6b6b)",
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            margin: "0 0 12px",
          }}
        >
          {error}
        </p>
      )}

      {!confirm ? (
        <button
          type="button"
          onClick={onAskConfirm}
          style={{
            minHeight: 44,
            width: "100%",
            background: "transparent",
            color: "var(--red, #ff6b6b)",
            border: "1px solid var(--red, #ff6b6b)",
            borderRadius: 8,
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Trash2 size={16} />
          Delete my account
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p
            style={{
              color: "var(--white)",
              fontFamily: "var(--font-ui)",
              fontSize: 14,
              fontWeight: 600,
              margin: 0,
            }}
          >
            Are you sure? This permanently deletes your account, your practice and all your
            patients&rsquo; data.
          </p>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            style={{
              minHeight: 44,
              width: "100%",
              background: "var(--red, #ff6b6b)",
              color: "var(--white)",
              border: "none",
              borderRadius: 8,
              fontFamily: "var(--font-ui)",
              fontWeight: 700,
              fontSize: 14,
              cursor: deleting ? "default" : "pointer",
              opacity: deleting ? 0.7 : 1,
            }}
          >
            {deleting ? "Deleting…" : "Yes, permanently delete my account"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            style={{
              minHeight: 40,
              width: "100%",
              background: "transparent",
              color: "var(--white-muted)",
              border: "1px solid var(--navy-border)",
              borderRadius: 8,
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
