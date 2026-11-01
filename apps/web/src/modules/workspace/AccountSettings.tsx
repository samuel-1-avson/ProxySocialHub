"use client";

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import {
  Bell,
  Gift,
  History,
  Monitor,
  Moon,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api/client";
import {
  getMyProfile,
  updateProfile,
  type UserPublicProfile,
} from "@/lib/api/profile";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreference,
} from "@/lib/notifications-api";
import { Modal } from "@/components/patterns/Modal";
import ReferralPage from "@/components/settings/ReferralsPanel";
import {
  PageHeading,
  Loading,
  DataError,
  Status,
  EmptyState,
  shortDate,
} from "@/components/workspace/Patterns";

export function AccountSettings() {
  const params = useSearchParams();
  const tab = [
    "preferences",
    "security",
    "devices",
    "history",
    "referrals",
  ].includes(params.get("tab") ?? "")
    ? params.get("tab")!
    : "profile";
  return (
    <div className="ui-page">
      <PageHeading
        title="Settings"
        eyebrow="Account utility"
        description="Profile, preferences, and account security in one place."
        actions={
          <Link className="ui-button secondary" href="/app/wallet">
            Wallet settings →
          </Link>
        }
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings views">
          {[
            { key: "profile", label: "Profile", icon: UserRound },
            {
              key: "preferences",
              label: "Preferences",
              icon: SlidersHorizontal,
            },
            { key: "security", label: "Security", icon: ShieldCheck },
            { key: "devices", label: "Devices", icon: Monitor },
            { key: "history", label: "Security activity", icon: History },
            { key: "referrals", label: "Referrals", icon: Gift },
          ].map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              href={
                key === "profile" ? "/app/settings" : `/app/settings?tab=${key}`
              }
              className={tab === key ? "active" : ""}
              aria-current={tab === key ? "page" : undefined}
            >
              <Icon size={17} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "profile" ? (
            <ProfileSettings />
          ) : tab === "preferences" ? (
            <Preferences />
          ) : tab === "security" ? (
            <Authentication />
          ) : tab === "devices" ? (
            <Devices />
          ) : tab === "referrals" ? (
            <ReferralPage />
          ) : (
            <SecurityActivity />
          )}
        </div>
      </div>
      <details className="workflow-advanced ui-note">
        <summary>Advanced account tools</summary>
        <div className="ui-actions mt-3">
          <Link className="ui-link" href="/dashboard/settings/account">
            Account tier & data controls →
          </Link>
          <Link className="ui-link" href="/dashboard/settings/api-keys">
            API keys →
          </Link>
        </div>
      </details>
    </div>
  );
}

function ProfileSettings() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["account-profile", user?.id],
    queryFn: getMyProfile,
  });
  return (
    <>
      {query.isLoading && <Loading label="Loading your profile…" />}
      {query.isError && (
        <DataError error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data && <ProfileForm key={query.data.id} profile={query.data} />}
    </>
  );
}

function ProfileForm({ profile }: { profile: UserPublicProfile }) {
  const { refreshUser } = useAuth();
  const client = useQueryClient();
  const [draft, setDraft] = useState({
    display_name: profile.display_name ?? "",
    username: profile.username ?? "",
    bio: profile.bio ?? "",
    location: profile.location ?? "",
    website: profile.website ?? "",
    avatar_url: profile.avatar_url ?? "",
    professional_title: profile.professional_title ?? "",
  });
  const [avatarError, setAvatarError] = useState("");
  const save = useMutation({
    retry: false,
    mutationFn: () =>
      updateProfile({
        ...draft,
        username: draft.username.trim(),
        display_name: draft.display_name.trim(),
      }),
    onSuccess: async (updated) => {
      client.setQueryData(["account-profile", profile.id], updated);
      await refreshUser();
    },
  });
  async function upload(file?: File) {
    if (!file) return;
    setAvatarError("");
    try {
      if (!file.type.startsWith("image/") || file.size > 2_000_000)
        throw new Error("Choose an image smaller than 2 MB.");
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image processing is unavailable.");
      const scale = Math.max(256 / bitmap.width, 256 / bitmap.height);
      context.drawImage(
        bitmap,
        (256 - bitmap.width * scale) / 2,
        (256 - bitmap.height * scale) / 2,
        bitmap.width * scale,
        bitmap.height * scale,
      );
      bitmap.close();
      const value = canvas.toDataURL("image/jpeg", 0.72);
      if (value.length > 80000)
        throw new Error("This image remains too large. Try a simpler picture.");
      setDraft((current) => ({ ...current, avatar_url: value }));
    } catch (error) {
      setAvatarError(
        error instanceof Error
          ? error.message
          : "Could not prepare this image.",
      );
    }
  }
  return (
    <form
      className="ui-surface ui-page"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.username.trim()) save.mutate();
      }}
    >
      <div className="settings-section-heading">
        <UserRound size={20} aria-hidden="true" />
        <div>
          <h2>Public profile</h2>
          <p>Choose how you appear to buyers, providers, and the community.</p>
        </div>
      </div>
      <div className="profile-preview">
        <span className="profile-preview-avatar">
          {draft.avatar_url ? (
            <Image
              src={draft.avatar_url}
              width={64}
              height={64}
              unoptimized
              alt="Your profile photo"
            />
          ) : (
            (draft.display_name || draft.username || "P")
              .slice(0, 2)
              .toUpperCase()
          )}
        </span>
        <div>
          <strong>
            {draft.display_name || draft.username || "Your public profile"}
          </strong>
          <p>
            {draft.username ? "@" + draft.username : "Choose a username below"}
          </p>
        </div>
      </div>
      <fieldset className="ui-form-grid" disabled={save.isPending}>
        {[
          ["display_name", "Display name"],
          ["username", "Username"],
          ["professional_title", "Professional title"],
          ["location", "Location"],
          ["website", "Website"],
        ].map(([key, label]) => (
          <label key={key} className="ui-field">
            {label}
            <input
              className="ui-input"
              required={key === "username"}
              maxLength={key === "website" ? 500 : 150}
              type={key === "website" ? "url" : "text"}
              value={draft[key as keyof typeof draft]}
              onChange={(e) =>
                setDraft((current) => ({ ...current, [key]: e.target.value }))
              }
            />
          </label>
        ))}
        <label className="ui-field">
          Profile photo
          <input
            className="ui-input"
            type="file"
            accept="image/*"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </label>
      </fieldset>
      <label className="ui-field">
        Bio
        <textarea
          className="ui-input"
          maxLength={2000}
          rows={4}
          disabled={save.isPending}
          value={draft.bio}
          onChange={(e) =>
            setDraft((current) => ({ ...current, bio: e.target.value }))
          }
        />
      </label>
      {avatarError && <DataError error={new Error(avatarError)} />}
      {save.isError && <DataError error={save.error} />}
      {save.isSuccess && (
        <p className="ui-note" role="status">
          Profile saved.
        </p>
      )}
      <button
        className="ui-button self-start"
        disabled={save.isPending || !draft.username.trim()}
      >
        {save.isPending ? "Saving…" : "Save profile"}
      </button>
      <p className="ui-note">
        These details may appear on your public profile. Wallet linking and
        security settings remain separate.
      </p>
    </form>
  );
}

function Preferences() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["notification-preferences", user?.id],
    queryFn: getNotificationPreferences,
  });
  return (
    <>
      <section className="ui-surface">
        <div className="settings-section-heading">
          <SlidersHorizontal size={20} aria-hidden="true" />
          <div>
            <h2>Appearance</h2>
            <p>Make the workspace comfortable on this device.</p>
          </div>
        </div>
        <AppearanceChoices />
        <p className="ui-note mt-3">
          System follows this device’s appearance. Your explicit light or dark
          choice is saved in this browser.
        </p>
      </section>
      {query.isLoading && <Loading label="Loading notification preferences…" />}
      {query.isError && (
        <DataError error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data && (
        <NotificationForm key={query.data.user_id} preferences={query.data} />
      )}
    </>
  );
}
function NotificationForm({
  preferences,
}: {
  preferences: NotificationPreference;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(preferences);
  const save = useMutation({
    retry: false,
    mutationFn: () => updateNotificationPreferences(draft),
    onSuccess: (updated) =>
      client.setQueryData(
        ["notification-preferences", preferences.user_id],
        updated,
      ),
  });
  return (
    <form
      className="ui-surface ui-page"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="settings-section-heading">
        <Bell size={20} aria-hidden="true" />
        <div>
          <h2>Notifications</h2>
          <p>Choose which activity reaches you and through which channels.</p>
        </div>
      </div>
      <div
        className="ui-table-wrap"
        role="region"
        tabIndex={0}
        aria-label="Notification delivery preferences"
      >
        <table className="ui-table">
          <thead>
            <tr>
              <th>Updates</th>
              <th>In app</th>
              <th>Email</th>
              <th>Push</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["business", "Orders & payments"],
              ["system", "Account & security"],
              ["social", "Social activity"],
              ["community", "Community"],
            ].map(([category, label]) => (
              <tr key={category}>
                <td>{label}</td>
                {["in_app", "email", "push"].map((channel) => {
                  const key =
                    `${category}_${channel}` as keyof NotificationPreference;
                  return (
                    <td key={channel}>
                      <input
                        type="checkbox"
                        aria-label={`${label} ${channel.replace("_", " ")}`}
                        checked={Boolean(draft[key])}
                        disabled={save.isPending}
                        onChange={(e) =>
                          setDraft((current) => ({
                            ...current,
                            [key]: e.target.checked,
                          }))
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="ui-field">
        Email digest
        <select
          className="ui-select"
          value={draft.email_digest_frequency}
          disabled={save.isPending}
          onChange={(e) =>
            setDraft((current) => ({
              ...current,
              email_digest_frequency: e.target
                .value as NotificationPreference["email_digest_frequency"],
            }))
          }
        >
          <option value="immediate">As updates arrive</option>
          <option value="hourly">Hourly digest</option>
          <option value="daily">Daily digest</option>
        </select>
      </label>
      {draft.email_digest_frequency === "daily" && (
        <label className="ui-field">
          Daily digest hour
          <select
            className="ui-select"
            value={draft.digest_hour}
            disabled={save.isPending}
            onChange={(e) =>
              setDraft((current) => ({
                ...current,
                digest_hour: Number(e.target.value),
              }))
            }
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option value={hour} key={hour}>
                {String(hour).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
      )}
      {save.isError && <DataError error={save.error} />}
      {save.isSuccess && (
        <p className="ui-note" role="status">
          Preferences saved.
        </p>
      )}
      <button className="ui-button self-start" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save preferences"}
      </button>
    </form>
  );
}

type Setup = { secret: string; qr_code: string; otpauth_url: string };
function Authentication() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const status = useQuery({
    queryKey: ["account-two-factor", user?.id],
    queryFn: async () => {
      try {
        const data = await apiGet<{ remaining_codes: number }>(
          "/v1/2fa/backup-codes",
        );
        return { enabled: true, remaining: data.remaining_codes };
      } catch (error) {
        if (error instanceof ApiError && error.status === 400)
          return { enabled: false, remaining: 0 };
        throw error;
      }
    },
    retry: 1,
  });
  const begin = useMutation({
    retry: false,
    mutationFn: () => apiPost<Setup>("/v1/2fa/setup", {}),
    onSuccess: (data) => {
      setSetup(data);
      setCode("");
    },
  });
  const enable = useMutation({
    retry: false,
    mutationFn: () =>
      apiPost<{ backup_codes: string[] }>("/v1/2fa/enable", { code }),
    onSuccess: (data) => {
      setCodes(data.backup_codes ?? []);
      setSetup(null);
      setCode("");
      void client.invalidateQueries({ queryKey: ["account-two-factor"] });
    },
  });
  const disable = useMutation({
    retry: false,
    mutationFn: () => apiPost("/v1/2fa/disable", { code }),
    onSuccess: () => {
      setDisableOpen(false);
      setCodes([]);
      setCode("");
      void client.invalidateQueries({ queryKey: ["account-two-factor"] });
    },
  });
  const regenerate = useMutation({
    retry: false,
    mutationFn: () =>
      apiPost<{ backup_codes: string[] }>(
        "/v1/2fa/backup-codes/regenerate",
        {},
      ),
    onSuccess: (data) => {
      setCodes(data.backup_codes ?? []);
      setRegenerateOpen(false);
      setCopied(false);
      void client.invalidateQueries({ queryKey: ["account-two-factor"] });
    },
  });
  return (
    <section className="ui-surface ui-page">
      <div className="ui-section-heading">
        <h2>Two-factor authentication</h2>
        <Status
          tone={status.isSuccess && status.data.enabled ? "good" : "neutral"}
        >
          {status.isSuccess
            ? status.data.enabled
              ? "Enabled"
              : "Not enabled"
            : "Status unavailable"}
        </Status>
      </div>
      {status.isLoading && (
        <Loading label="Checking authentication settings…" />
      )}
      {status.isError && (
        <DataError error={status.error} retry={() => void status.refetch()} />
      )}
      {status.isSuccess &&
        (status.data.enabled ? (
          <>
            <p className="ui-note">
              {status.data.remaining} backup codes remain. Keep them somewhere
              private and accessible.
            </p>
            <div className="ui-actions">
              <button
                className="ui-button secondary"
                onClick={() => setRegenerateOpen(true)}
              >
                Replace backup codes…
              </button>
              <button
                className="ui-button ghost"
                onClick={() => {
                  setCode("");
                  setDisableOpen(true);
                }}
              >
                Disable two-factor authentication…
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="ui-note">
              Add an authenticator app to protect supported account actions.
            </p>
            <button
              className="ui-button self-start"
              disabled={begin.isPending}
              onClick={() => begin.mutate()}
            >
              {begin.isPending ? "Preparing…" : "Set up authenticator"}
            </button>
          </>
        ))}
      {begin.isError && <DataError error={begin.error} />}
      {codes.length > 0 && (
        <section className="ui-attention">
          <h3>Save your backup codes</h3>
          <p>
            Each code can be used once. These codes are shown only in this
            session.
          </p>
          <pre className="ui-code">{codes.join("\n")}</pre>
          <button
            className="ui-button secondary"
            onClick={() => {
              void navigator.clipboard
                .writeText(codes.join("\n"))
                .then(() => setCopied(true));
            }}
          >
            {copied ? "Backup codes copied" : "Copy backup codes"}
          </button>
          <button className="ui-button ghost ml-4" onClick={() => setCodes([])}>
            Hide codes
          </button>
        </section>
      )}
      <Modal
        open={Boolean(setup)}
        onOpenChange={(open) => {
          if (!open && !enable.isPending) setSetup(null);
        }}
        title="Connect your authenticator"
        description="Scan the QR code or enter the setup key, then verify a code."
      >
        {setup && (
          <form
            className="ui-page"
            onSubmit={(e) => {
              e.preventDefault();
              enable.mutate();
            }}
          >
            <QRCodeSVG
              value={setup.otpauth_url}
              title="Authenticator setup QR code"
              size={200}
            />
            <details className="ui-note">
              <summary>Enter a setup key manually</summary>
              <code className="ui-code">{setup.secret}</code>
            </details>
            <label className="ui-field">
              Authenticator code
              <input
                className="ui-input"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            {enable.isError && <DataError error={enable.error} />}
            <button
              className="ui-button"
              disabled={enable.isPending || !/^\d{6}$/.test(code)}
            >
              Verify & enable
            </button>
          </form>
        )}
      </Modal>
      <Modal
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title="Disable two-factor authentication?"
        description="Enter an authenticator code or a valid backup code."
      >
        <form
          className="ui-page"
          onSubmit={(e) => {
            e.preventDefault();
            disable.mutate();
          }}
        >
          <label className="ui-field">
            Verification code
            <input
              className="ui-input"
              autoComplete="one-time-code"
              required
              minLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {disable.isError && <DataError error={disable.error} />}
          <button
            className="ui-button"
            disabled={disable.isPending || code.length < 6}
          >
            Verify & disable
          </button>
        </form>
      </Modal>
      <Modal
        open={regenerateOpen}
        onOpenChange={setRegenerateOpen}
        title="Replace backup codes?"
        description="Previously issued backup codes will stop working."
      >
        {regenerate.isError && <DataError error={regenerate.error} />}
        <button
          className="ui-button"
          disabled={regenerate.isPending}
          onClick={() => regenerate.mutate()}
        >
          Generate replacement codes
        </button>
      </Modal>
    </section>
  );
}

type Device = {
  id: string;
  browser: string;
  os: string;
  device_type: string;
  last_active_at: string;
  ip_address: string;
  is_active: boolean;
};
function Devices() {
  const { user, logout } = useAuth();
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["account-devices", user?.id],
    queryFn: () => apiGet<{ sessions: Device[] }>("/v1/security/sessions"),
  });
  const revoke = useMutation({
    retry: false,
    mutationFn: (id: string) =>
      apiDelete(
        id === "all"
          ? "/v1/security/sessions"
          : `/v1/security/sessions/${encodeURIComponent(id)}`,
      ),
    onSuccess: (_, id) => {
      setSelected(null);
      void client.invalidateQueries({ queryKey: ["account-devices"] });
      if (id === "all") void logout();
    },
  });
  return (
    <section className="ui-surface ui-page">
      <div className="ui-section-heading">
        <div className="settings-section-heading">
          <Monitor size={20} aria-hidden="true" />
          <div>
            <h2>Signed-in devices</h2>
            <p>Review browser sessions with access to your account.</p>
          </div>
        </div>
        <button
          className="ui-button secondary"
          onClick={() => setSelected("all")}
        >
          Sign out all devices…
        </button>
      </div>
      {query.isLoading && <Loading label="Loading signed-in devices…" />}
      {query.isError && (
        <DataError error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data?.sessions.map((device) => (
        <div className="ui-row" key={device.id}>
          <div>
            <h3>
              {device.browser || device.device_type} ·{" "}
              {device.os || "Unknown OS"}
            </h3>
            <p>
              Last active {shortDate(device.last_active_at)} ·{" "}
              {device.ip_address}
            </p>
          </div>
          <button
            className="ui-button secondary small"
            onClick={() => {
              revoke.reset();
              setSelected(device.id);
            }}
          >
            Sign out device…
          </button>
        </div>
      ))}
      {query.isSuccess && !query.data.sessions.length && (
        <p className="ui-note">
          No device sessions were returned. Your current login may be
          represented separately by the authentication service.
        </p>
      )}
      <Modal
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setSelected(null);
        }}
        title={
          selected === "all"
            ? "Sign out every device?"
            : "Sign out this device?"
        }
        description="The selected device will need to authenticate again."
      >
        {revoke.isError && <DataError error={revoke.error} />}
        <div className="ui-actions">
          <button
            className="ui-button secondary"
            disabled={revoke.isPending}
            onClick={() => setSelected(null)}
          >
            Keep signed in
          </button>
          <button
            className="ui-button"
            disabled={revoke.isPending}
            onClick={() => {
              if (selected) revoke.mutate(selected);
            }}
          >
            Confirm sign out
          </button>
        </div>
      </Modal>
    </section>
  );
}

type Audit = {
  id: string;
  event_type: string;
  description: string;
  success: boolean;
  created_at: string;
  ip_address: string;
};
type Anomaly = {
  id: string;
  anomaly_type: string;
  severity: string;
  is_resolved: boolean;
  created_at: string;
};
function SecurityActivity() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [resolution, setResolution] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const logs = useQuery({
    queryKey: ["account-login-history", user?.id],
    queryFn: () => apiGet<{ logs: Audit[] }>("/v1/audit/logs?limit=50"),
  });
  const alerts = useQuery({
    queryKey: ["account-security-alerts", user?.id],
    queryFn: () => apiGet<{ anomalies: Anomaly[] }>("/v1/audit/anomalies"),
  });
  const resolve = useMutation({
    retry: false,
    mutationFn: () =>
      apiPost(`/v1/audit/anomalies/${encodeURIComponent(selected!)}/resolve`, {
        resolution,
      }),
    onSuccess: () => {
      setSelected(null);
      setResolution("");
      void client.invalidateQueries({ queryKey: ["account-security-alerts"] });
    },
  });
  return (
    <>
      <section className="ui-surface">
        <h2 className="mb-4">Security alerts</h2>
        {alerts.isLoading && <Loading label="Loading security alerts…" />}
        {alerts.isError && (
          <DataError error={alerts.error} retry={() => void alerts.refetch()} />
        )}
        {alerts.data?.anomalies.map((alert) => (
          <div className="ui-row" key={alert.id}>
            <div>
              <h3>{alert.anomaly_type.replace(/_/g, " ")}</h3>
              <p>
                {alert.severity} · {shortDate(alert.created_at)} ·{" "}
                {alert.is_resolved ? "Resolved" : "Needs review"}
              </p>
            </div>
            {!alert.is_resolved && (
              <button
                className="ui-button secondary small"
                onClick={() => setSelected(alert.id)}
              >
                Review alert…
              </button>
            )}
          </div>
        ))}
        {alerts.isSuccess && !alerts.data.anomalies.length && (
          <EmptyState
            title="No alerts reported."
            description="Security alerts returned by your account will appear here for review."
            icon={<ShieldCheck size={24} />}
          />
        )}
      </section>
      <section className="ui-surface">
        <h2 className="mb-4">Recent sign-in activity</h2>
        {logs.isLoading && <Loading label="Loading security activity…" />}
        {logs.isError && (
          <DataError error={logs.error} retry={() => void logs.refetch()} />
        )}
        {logs.data?.logs
          .filter((log) => log.event_type.startsWith("auth."))
          .map((log) => (
            <div className="ui-row" key={log.id}>
              <div>
                <h3>{log.description || log.event_type}</h3>
                <p>
                  {shortDate(log.created_at)} · {log.ip_address}
                </p>
              </div>
              <Status tone={log.success ? "good" : "warning"}>
                {log.success ? "Succeeded" : "Failed"}
              </Status>
            </div>
          ))}
        {logs.isSuccess &&
          !logs.data.logs.some((log) => log.event_type.startsWith("auth.")) && (
            <EmptyState
              title="No sign-in events reported."
              description="Recent authentication activity will appear when it is available from the account service."
              icon={<History size={24} />}
            />
          )}
      </section>
      <Modal
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title="Review security alert"
        description="Record how you investigated this alert."
      >
        <form
          className="ui-page"
          onSubmit={(e) => {
            e.preventDefault();
            resolve.mutate();
          }}
        >
          <label className="ui-field">
            Review notes
            <textarea
              className="ui-input"
              required
              minLength={3}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
          </label>
          {resolve.isError && <DataError error={resolve.error} />}
          <button
            className="ui-button"
            disabled={resolve.isPending || resolution.trim().length < 3}
          >
            Mark reviewed
          </button>
        </form>
      </Modal>
    </>
  );
}

const subscribeToAppearance = () => () => {};
function AppearanceChoices() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeToAppearance,
    () => true,
    () => false,
  );
  return (
    <div className="appearance-choices">
      {[
        { value: "light", label: "Light", icon: Sun },
        { value: "dark", label: "Dark", icon: Moon },
        { value: "system", label: "System", icon: Monitor },
      ].map(({ value, label, icon: Icon }) => (
        <button
          type="button"
          key={value}
          aria-pressed={mounted && theme === value}
          onClick={() => setTheme(value)}
        >
          <span className={"appearance-preview " + value} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <Icon size={15} aria-hidden="true" />
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}
