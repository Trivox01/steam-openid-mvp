import {
  useCallback, useEffect, useMemo, useRef, useState
} from "react";
import {
  Eye, Medal, Plus, RefreshCw, RotateCcw, Search, ShieldX, X
} from "lucide-react";
import { Surface } from "../../../components/ui/Surface";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { useTranslation } from "../../../i18n/TranslationContext";
import type { AuthorizationSnapshot } from "../authorizationTypes";
import {
  BadgeAssignmentClient,
  BadgeAssignmentClientError
} from "./BadgeAssignmentClient";
import type {
  AssignmentSource, AssignmentStatus, AssignmentUser, BadgeAssignment
} from "./types";
import type { ManagedBadge } from "../badges/types";
import { publishPublicBadgeChange } from "../../../services/dataEvents";

const PAGE_SIZE = 20;
const sources: AssignmentSource[] = ["manual", "automatic", "system", "migration"];

export function BadgeAssignmentsPanel({
  snapshot, client
}: {
  snapshot: AuthorizationSnapshot;
  client?: BadgeAssignmentClient;
}) {
  const { t, language } = useTranslation();
  const can = (permission: string) => snapshot.permissions.includes(permission);
  const [items, setItems] = useState<BadgeAssignment[]>([]);
  const [users, setUsers] = useState<AssignmentUser[]>([]);
  const [badges, setBadges] = useState<ManagedBadge[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<AssignmentStatus>("active");
  const [source, setSource] = useState("");
  const [userId, setUserId] = useState("");
  const [badgeId, setBadgeId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("assigned_desc");
  const [loadState, setLoadState] = useState<"loading"|"ready"|"error">("loading");
  const [error, setError] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const [selected, setSelected] = useState<BadgeAssignment>();
  const [revokeTarget, setRevokeTarget] = useState<BadgeAssignment>();
  const [notice, setNotice] = useState("");

  const query = useMemo(() => {
    const result = new URLSearchParams({
      page: String(page), pageSize: String(PAGE_SIZE), status, sort
    });
    if (source) result.set("source", source);
    if (userId) result.set("userId", userId);
    if (badgeId) result.set("badgeId", badgeId);
    if (from) result.set("from", new Date(`${from}T00:00:00`).toISOString());
    if (to) result.set("to", new Date(`${to}T23:59:59`).toISOString());
    return result;
  }, [badgeId, from, page, sort, source, status, to, userId]);

  const loadReferences = useCallback(async (signal?: AbortSignal) => {
    if (!client) return;
    const [userPage, badgePage] = await Promise.all([
      client.listUsers("", signal), client.listBadges(signal)
    ]);
    setUsers(userPage.items);
    setBadges(badgePage.items);
  }, [client]);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!client) { setError("CLIENT_UNAVAILABLE"); setLoadState("error"); return; }
    setLoadState("loading"); setError("");
    try {
      const result = await client.list(query, signal);
      setItems(result.items); setTotal(result.total); setLoadState("ready");
      if (result.items.length === 0 && page > 1) setPage(page - 1);
    } catch (reason) {
      if (codeOf(reason) !== "REQUEST_ABORTED") {
        setError(codeOf(reason)); setLoadState("error");
      }
    }
  }, [client, page, query]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([load(controller.signal), loadReferences(controller.signal)])
      .catch((reason) => {
        if (codeOf(reason) !== "REQUEST_ABORTED") setError(codeOf(reason));
      });
    return () => controller.abort();
  }, [load, loadReferences]);

  const reset = () => {
    setStatus("active"); setSource(""); setUserId(""); setBadgeId("");
    setFrom(""); setTo(""); setSort("assigned_desc"); setPage(1);
  };
  const activeFilters = [source, userId, badgeId, from, to].filter(Boolean).length +
    (status !== "active" ? 1 : 0);
  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const badgeMap = useMemo(() => new Map(badges.map((badge) => [badge.id, badge])), [badges]);
  const labelUser = (id?: string) => id
    ? userMap.get(id)?.displayName ?? `${t("developer.assignments.user")} ${shortId(id)}`
    : t("developer.assignments.system");
  const formatDate = (value?: string) => value
    ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" })
        .format(new Date(value))
    : "—";

  if (!can("badges.view_assignments")) return null;
  return (
    <div className="assignment-admin">
      <header className="badge-admin-header">
        <div>
          <h2>{t("developer.assignments.title")}</h2>
          <p>{t("developer.assignments.description")}</p>
        </div>
        {can("badges.assign") && (
          <button className="primary-button" type="button" onClick={() => setGrantOpen(true)}>
            <Plus size={17}/>{t("developer.assignments.grant")}
          </button>
        )}
      </header>

      <Surface className="assignment-toolbar">
        <Select label={t("developer.assignments.status")} value={status}
          onChange={(value) => { setStatus(value as AssignmentStatus); setPage(1); }}
          options={["all", "active", "revoked"]}/>
        <Select label={t("developer.assignments.user")} value={userId}
          onChange={(value) => { setUserId(value); setPage(1); }}
          options={users.map((user) => user.id)}
          names={Object.fromEntries(users.map((user) => [user.id, `${user.displayName} · ${shortId(user.id)}`]))}/>
        <Select label={t("developer.assignments.badge")} value={badgeId}
          onChange={(value) => { setBadgeId(value); setPage(1); }}
          options={badges.map((badge) => badge.id)}
          names={Object.fromEntries(badges.map((badge) => [badge.id, badge.displayName]))}/>
        <Select label={t("developer.assignments.source")} value={source}
          onChange={(value) => { setSource(value); setPage(1); }} options={sources}/>
        <label><span>{t("developer.assignments.from")}</span>
          <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }}/></label>
        <label><span>{t("developer.assignments.to")}</span>
          <input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }}/></label>
        <Select label={t("developer.assignments.sort")} value={sort}
          onChange={(value) => { setSort(value); setPage(1); }}
          options={["assigned_desc", "assigned_asc", "updated_desc"]} allowEmpty={false}/>
        <button type="button" className="assignment-reset" disabled={!activeFilters} onClick={reset}>
          <RotateCcw size={15}/>{t("developer.assignments.reset")}
          {activeFilters ? <span>{activeFilters}</span> : null}
        </button>
      </Surface>

      {notice && <p className="assignment-notice" role="status">{notice}</p>}
      {loadState === "loading" ? (
        <Surface className="badge-state" aria-busy="true">{t("developer.assignments.loading")}</Surface>
      ) : loadState === "error" ? (
        <Surface className="badge-state">
          <ShieldX/><p>{errorMessage(error, t)}</p>
          <button type="button" onClick={() => void load()}><RefreshCw size={16}/>{t("developer.assignments.retry")}</button>
        </Surface>
      ) : items.length === 0 ? (
        <Surface className="badge-state"><Search/><p>{t("developer.assignments.empty")}</p>
          {activeFilters ? <button type="button" onClick={reset}>{t("developer.assignments.reset")}</button> : null}
        </Surface>
      ) : (
        <Surface className="assignment-list">
          {items.map((assignment) => {
            const badge = badgeMap.get(assignment.badgeDefinitionId);
            const revoked = Boolean(assignment.revokedAt);
            return <article key={assignment.id} className="assignment-row">
              <BadgeArtwork badge={badge} client={client}/>
              <div className="assignment-primary">
                <strong dir="auto">{badge?.displayName ?? t("developer.assignments.unknownBadge")}</strong>
                <small>{badge?.slug ?? shortId(assignment.badgeDefinitionId)}</small>
              </div>
              <div><span>{labelUser(assignment.userId)}</span><small dir="ltr">{shortId(assignment.userId)}</small></div>
              <StatusBadge tone={revoked ? "neutral" : "success"}>
                {t(revoked ? "developer.assignments.revoked" : "developer.assignments.active")}
              </StatusBadge>
              <div><span>{t(`developer.assignments.source.${assignment.source}`)}</span>
                <small>{formatDate(assignment.assignedAt)}</small></div>
              <div><span>{labelUser(assignment.assignedByUserId)}</span>
                <small>{revoked ? `${t("developer.assignments.revokedAt")} ${formatDate(assignment.revokedAt)}` : t("developer.assignments.current")}</small></div>
              <div className="assignment-actions">
                <button type="button" aria-label={t("developer.assignments.details")} onClick={() => setSelected(assignment)}><Eye size={16}/></button>
                {!revoked && can("badges.revoke") && <button type="button" className="danger" aria-label={t("developer.assignments.revoke")} onClick={() => setRevokeTarget(assignment)}><ShieldX size={16}/></button>}
              </div>
            </article>;
          })}
        </Surface>
      )}
      {total > PAGE_SIZE && <div className="badge-pagination">
        <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>{t("developer.badges.previous")}</button>
        <span>{page} / {Math.ceil(total / PAGE_SIZE)}</span>
        <button type="button" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((value) => value + 1)}>{t("developer.badges.next")}</button>
      </div>}

      {grantOpen && <GrantDialog client={client} users={users} badges={badges}
        onClose={() => setGrantOpen(false)}
        onSuccess={async () => {
          await publishPublicBadgeChange();
          setGrantOpen(false);
          setNotice(t("developer.assignments.granted"));
          await load();
        }}/>}
      {revokeTarget && <RevokeDialog assignment={revokeTarget}
        userName={labelUser(revokeTarget.userId)}
        badgeName={badgeMap.get(revokeTarget.badgeDefinitionId)?.displayName ?? t("developer.assignments.unknownBadge")}
        client={client} formatDate={formatDate}
        onClose={() => setRevokeTarget(undefined)}
        onSuccess={async () => {
          await publishPublicBadgeChange();
          setRevokeTarget(undefined);
          setNotice(t("developer.assignments.revokedNotice"));
          await load();
        }}/>}
      {selected && <DetailsDialog assignment={selected}
        userName={labelUser(selected.userId)}
        badgeName={badgeMap.get(selected.badgeDefinitionId)?.displayName ?? t("developer.assignments.unknownBadge")}
        actorName={labelUser(selected.assignedByUserId)}
        revokerName={labelUser(selected.revokedByUserId)}
        formatDate={formatDate} onClose={() => setSelected(undefined)}/>}
    </div>
  );
}

function GrantDialog({ client, users, badges, onClose, onSuccess }: {
  client?: BadgeAssignmentClient; users: AssignmentUser[]; badges: ManagedBadge[];
  onClose: () => void; onSuccess: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [userId, setUserId] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userOptions, setUserOptions] = useState(users);
  const [badgeId, setBadgeId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    void client.listUsers(userSearch, controller.signal)
      .then((result) => setUserOptions(result.items))
      .catch((cause) => {
        if (codeOf(cause) !== "REQUEST_ABORTED") setError(codeOf(cause));
      });
    return () => controller.abort();
  }, [client, userSearch]);
  const available = badges.filter(isGrantable);
  const user = userOptions.find((item) => item.id === userId) ??
    users.find((item) => item.id === userId);
  const badge = badges.find((item) => item.id === badgeId);
  const submit = async () => {
    if (!client || !userId || !badgeId || saving) return;
    setSaving(true); setError("");
    try {
      await client.assign({ userId, badgeDefinitionId: badgeId, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      await onSuccess();
    } catch (cause) { setError(codeOf(cause)); }
    finally { setSaving(false); }
  };
  return <Dialog title={t("developer.assignments.grant")} onClose={onClose} busy={saving}>
    <div className="assignment-form">
      <label>{t("developer.assignments.searchUsers")}
        <input value={userSearch} maxLength={80} placeholder={t("developer.assignments.searchUsersHint")}
          onChange={(event) => setUserSearch(event.target.value.replace(/[^0-9a-f-]/gi, ""))}/>
      </label>
      <Select label={t("developer.assignments.user")} value={userId} onChange={setUserId}
        options={userOptions.map((item) => item.id)}
        names={Object.fromEntries(userOptions.map((item) => [item.id, `${item.displayName} · ${shortId(item.id)}`]))}/>
      <Select label={t("developer.assignments.badge")} value={badgeId} onChange={setBadgeId}
        options={available.map((item) => item.id)}
        names={Object.fromEntries(available.map((item) => [item.id, `${item.displayName} · ${item.rarity}`]))}/>
      <label>{t("developer.assignments.reason")}<textarea maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label>
      {user && badge && <Surface className="assignment-preview" elevation="subtle">
        <div><strong>{user.displayName}</strong><small>{shortId(user.id)}</small></div>
        <span>→</span><div><strong>{badge.displayName}</strong><small>{badge.rarity}</small></div>
        {reason.trim() && <p>{reason.trim()}</p>}
      </Surface>}
      {error && <p className="field-error" role="alert">{errorMessage(error, t)}</p>}
    </div>
    <footer><button type="button" disabled={saving} onClick={onClose}>{t("common.cancel")}</button>
      <button className="primary-button" type="button" disabled={saving || !userId || !badgeId} onClick={() => void submit()}>
        {saving ? t("developer.assignments.processing") : t("developer.assignments.confirmGrant")}
      </button></footer>
  </Dialog>;
}

function RevokeDialog({ assignment, userName, badgeName, client, formatDate, onClose, onSuccess }: {
  assignment: BadgeAssignment; userName: string; badgeName: string;
  client?: BadgeAssignmentClient; formatDate: (value?: string) => string;
  onClose: () => void; onSuccess: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (!client || saving) return;
    setSaving(true); setError("");
    try { await client.revoke(assignment.id, reason.trim() || undefined); await onSuccess(); }
    catch (cause) { setError(codeOf(cause)); }
    finally { setSaving(false); }
  };
  return <Dialog title={t("developer.assignments.revokeTitle")} onClose={onClose} busy={saving}>
    <div className="assignment-form">
      <p>{t("developer.assignments.revokeExplanation")}</p>
      <dl><dt>{t("developer.assignments.user")}</dt><dd>{userName}</dd>
        <dt>{t("developer.assignments.badge")}</dt><dd>{badgeName}</dd>
        <dt>{t("developer.assignments.assignedAt")}</dt><dd>{formatDate(assignment.assignedAt)}</dd>
        <dt>{t("developer.assignments.source")}</dt><dd>{assignment.source}</dd></dl>
      <label>{t("developer.assignments.revokeReason")}<textarea maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label>
      {error && <p className="field-error" role="alert">{errorMessage(error, t)}</p>}
    </div>
    <footer><button type="button" disabled={saving} onClick={onClose}>{t("common.cancel")}</button>
      <button className="danger-button" type="button" disabled={saving} onClick={() => void submit()}>
        {saving ? t("developer.assignments.processing") : t("developer.assignments.confirmRevoke")}
      </button></footer>
  </Dialog>;
}

function DetailsDialog({ assignment, userName, badgeName, actorName, revokerName, formatDate, onClose }: {
  assignment: BadgeAssignment; userName: string; badgeName: string; actorName: string;
  revokerName: string; formatDate: (value?: string) => string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const rows: Array<[string, string]> = [
    [t("developer.assignments.assignmentId"), shortId(assignment.id)],
    [t("developer.assignments.user"), userName],
    [t("developer.assignments.badge"), badgeName],
    [t("developer.assignments.source"), assignment.source],
    [t("developer.assignments.reason"), assignment.assignmentReason ?? "—"],
    [t("developer.assignments.assignedBy"), actorName],
    [t("developer.assignments.assignedAt"), formatDate(assignment.assignedAt)],
    [t("developer.assignments.status"), t(assignment.revokedAt ? "developer.assignments.revoked" : "developer.assignments.active")]
  ];
  if (assignment.revokedAt) rows.push(
    [t("developer.assignments.revokedBy"), revokerName],
    [t("developer.assignments.revokedAt"), formatDate(assignment.revokedAt)],
    [t("developer.assignments.revokeReason"), assignment.revokeReason ?? "—"]
  );
  return <Dialog title={t("developer.assignments.details")} onClose={onClose}>
    <dl className="assignment-details">{rows.map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}</dl>
    <footer><button className="primary-button" type="button" onClick={onClose}>{t("common.cancel")}</button></footer>
  </Dialog>;
}

function Dialog({ title, onClose, busy = false, children }: {
  title: string; onClose: () => void; busy?: boolean; children: React.ReactNode;
}) {
  const titleId = useRef(`assignment-dialog-${crypto.randomUUID()}`);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  return <div className="dialog-backdrop" role="presentation">
    <Surface className="assignment-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId.current}>
      <header><h3 id={titleId.current}>{title}</h3><button ref={closeRef} type="button" aria-label={title} disabled={busy} onClick={onClose}><X size={18}/></button></header>
      {children}
    </Surface>
  </div>;
}

function Select({ label, value, onChange, options, names = {}, allowEmpty = true }: {
  label: string; value: string; onChange: (value: string) => void;
  options: readonly string[]; names?: Record<string, string>; allowEmpty?: boolean;
}) {
  return <label><span>{label}</span><select value={value} aria-label={label} onChange={(event) => onChange(event.target.value)}>
    {allowEmpty && <option value="">{label}</option>}
    {options.map((option) => <option key={option} value={option}>{names[option] ?? option}</option>)}
  </select></label>;
}

function BadgeArtwork({ badge, client }: { badge?: ManagedBadge; client?: BadgeAssignmentClient }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!badge?.iconAssetId || !client) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void client.loadAsset(badge.iconAssetId, controller.signal).then((blob) => {
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [badge?.iconAssetId, client]);
  return <span className="assignment-icon">{url ? <img src={url} alt="" loading="lazy"/> : <Medal size={20}/>}</span>;
}

function isGrantable(badge: ManagedBadge) {
  const now = Date.now();
  return !badge.archivedAt && badge.isActive && badge.grantMode === "manual" &&
    (!badge.startsAt || Date.parse(badge.startsAt) <= now) &&
    (!badge.endsAt || Date.parse(badge.endsAt) > now);
}
function shortId(id: string) { return `${id.slice(0, 8)}…${id.slice(-4)}`; }
function codeOf(error: unknown) {
  return error instanceof BadgeAssignmentClientError ? error.code
    : error instanceof Error ? error.message : "REQUEST_FAILED";
}
function errorMessage(code: string, t: (key: string) => string) {
  const known = new Set([
    "BADGE_ALREADY_ASSIGNED", "BADGE_ARCHIVED", "BADGE_INACTIVE",
    "BADGE_NOT_STARTED", "BADGE_EXPIRED", "BADGE_MANUAL_ASSIGNMENT_NOT_ALLOWED",
    "USER_NOT_FOUND", "USER_NOT_ELIGIBLE", "BADGE_ASSIGNMENT_ALREADY_REVOKED",
    "PERMISSION_DENIED", "AUTHENTICATION_REQUIRED", "NETWORK_ERROR",
    "MALFORMED_RESPONSE", "REQUEST_FAILED"
  ]);
  return t(`developer.assignments.error.${known.has(code) ? code : "REQUEST_FAILED"}`);
}
