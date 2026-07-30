import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Eye, Medal, Search, Users, X } from "lucide-react";
import { Surface } from "../../../components/ui/Surface";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { ProfileAvatar } from "../../../components/ui/ProfileAvatar";
import { useTranslation } from "../../../i18n/TranslationContext";
import type { UserAdminClient } from "./UserAdminClient";
import type { ManagedUser, ManagedUserDetails } from "./types";

const PAGE_SIZE = 20;

export function UserManagementPanel({
  client,
  onOpenAssignments
}: {
  client?: UserAdminClient;
  onOpenAssignments?: () => void;
}) {
  const { t, language } = useTranslation();
  const [items, setItems] = useState<ManagedUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [sort, setSort] = useState("created_desc");
  const [state, setState] = useState<"loading"|"ready"|"error">("loading");
  const [selectedId, setSelectedId] = useState<string>();
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeDetails = () => {
    setSelectedId(undefined);
    requestAnimationFrame(() => returnFocus.current?.focus());
  };
  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page), pageSize: String(PAGE_SIZE), sort, status
    });
    if (search.trim()) params.set("search", search.trim());
    return params;
  }, [page, search, sort, status]);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!client) return setState("error");
    setState("loading");
    try {
      const result = await client.list(query, signal);
      setItems(result.items);
      setTotal(result.total);
      setState("ready");
    } catch {
      if (!signal?.aborted) setState("error");
    }
  }, [client, query]);
  useEffect(() => {
    const request = new AbortController();
    void load(request.signal);
    return () => request.abort();
  }, [load]);
  useEffect(() => client?.subscribeSession(() => void load()), [client, load]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const format = (value: string) => new Intl.DateTimeFormat(language, {
    dateStyle: "medium", timeStyle: "short"
  }).format(new Date(value));

  return (
    <section className="user-admin" aria-labelledby="user-admin-title">
      <header className="badge-admin-header">
        <div>
          <h2 id="user-admin-title">{t("developer.users.title")}</h2>
          <p>{t("developer.users.description")}</p>
        </div>
        <StatusBadge tone="neutral">{t("developer.users.readOnly")}</StatusBadge>
      </header>
      <Surface className="user-toolbar">
        <label>
          <span>{t("developer.users.search")}</span>
          <span className="user-search"><Search size={16}/><input
            value={search}
            maxLength={80}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          /></span>
        </label>
        <label><span>{t("developer.users.status")}</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="active">{t("developer.users.active")}</option>
          </select>
        </label>
        <label><span>{t("developer.users.sort")}</span>
          <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
            <option value="created_desc">{t("developer.users.newest")}</option>
            <option value="created_asc">{t("developer.users.oldest")}</option>
            <option value="last_login_desc">{t("developer.users.lastLoginSort")}</option>
            <option value="name_asc">{t("developer.users.nameSort")}</option>
            <option value="badges_desc">{t("developer.users.badgesSort")}</option>
          </select>
        </label>
      </Surface>
      {state === "loading" ? <Surface className="badge-state">{t("developer.users.loading")}</Surface>
        : state === "error" ? <Surface className="badge-state" role="alert">
          <p>{t("developer.users.error")}</p><button type="button" onClick={() => void load()}>{t("common.retry")}</button>
        </Surface>
          : !items.length ? <Surface className="badge-state"><Users/><p>{t("developer.users.empty")}</p></Surface>
            : <Surface className="user-table-wrap"><table className="user-table">
              <thead><tr>
                <th>{t("developer.users.user")}</th><th>{t("developer.users.created")}</th>
                <th>{t("developer.users.lastLogin")}</th><th>{t("developer.users.status")}</th>
                <th>{t("developer.users.badges")}</th><th>{t("developer.users.roles")}</th>
                <th><span className="sr-only">{t("developer.users.actions")}</span></th>
              </tr></thead>
              <tbody>{items.map((user) => <tr key={user.id}>
                <td><ProfileAvatar src={user.avatarUrl} name={user.displayName ?? user.steamNickname ?? user.id}/>
                  <span><strong dir="auto">{user.displayName ?? user.steamNickname ?? t("developer.users.unknown")}</strong>
                    <small dir="ltr" title={user.id}>{shortId(user.id)}</small></span></td>
                <td>{format(user.createdAt)}</td><td>{format(user.lastLoginAt)}</td>
                <td><StatusBadge tone="success">{t("developer.users.active")}</StatusBadge></td>
                <td>{user.badgeCount}</td><td>{user.roleCount}</td>
                <td><button type="button" aria-label={t("developer.users.viewDetails")} onClick={(event) => {
                  returnFocus.current = event.currentTarget;
                  setSelectedId(user.id);
                }}><Eye size={16}/></button></td>
              </tr>)}</tbody>
            </table></Surface>}
      <nav className="badge-pagination" aria-label={t("developer.users.pagination")}>
        <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16}/>{t("developer.badges.previous")}</button>
        <span>{page} / {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>{t("developer.badges.next")}<ChevronRight size={16}/></button>
      </nav>
      {selectedId && <UserDetailsDrawer
        id={selectedId} client={client} format={format}
        onClose={closeDetails}
        onOpenAssignments={onOpenAssignments
          ? () => { setSelectedId(undefined); onOpenAssignments(); }
          : undefined}
      />}
    </section>
  );
}

function UserDetailsDrawer({ id, client, format, onClose, onOpenAssignments }: {
  id: string; client?: UserAdminClient; format: (value: string) => string;
  onClose: () => void; onOpenAssignments?: () => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading"|"ready"|"error">("loading");
  const [user, setUser] = useState<ManagedUserDetails>();
  const [revision, setRevision] = useState(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const request = new AbortController();
    client?.get(id, request.signal).then(
      (value) => { setUser(value); setState("ready"); },
      () => { if (!request.signal.aborted) setState("error"); }
    );
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      const root = closeButton.current?.closest<HTMLElement>(".user-details-drawer");
      if (event.key === "Tab" && root) trapFocus(event, root);
    };
    document.addEventListener("keydown", escape);
    return () => { request.abort(); document.removeEventListener("keydown", escape); };
  }, [client, id, onClose, revision]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <Surface className="user-details-drawer" role="dialog" aria-modal="true" aria-labelledby="user-details-title">
      <header><h3 id="user-details-title">{t("developer.users.details")}</h3>
        <button ref={closeButton} type="button" onClick={onClose} aria-label={t("common.close")}><X/></button></header>
      {state === "loading" ? <div className="badge-state">{t("developer.users.loadingDetails")}</div>
        : state === "error" || !user ? <div className="badge-state" role="alert"><p>{t("developer.users.detailsError")}</p>
          <button type="button" onClick={() => { setState("loading"); setRevision((value) => value + 1); }}>{t("common.retry")}</button></div>
          : <div className="user-details-content">
            <ProfileAvatar src={user.avatarUrl} name={user.displayName ?? user.steamNickname ?? user.id}/>
            <h4 dir="auto">{user.displayName ?? user.steamNickname ?? t("developer.users.unknown")}</h4>
            <dl>
              <div><dt>{t("developer.users.uuid")}</dt><dd><ShortIdentifier value={user.id}/></dd></div>
              <Row label={t("developer.users.steamId")} value={user.steamId64} ltr/>
              <Row label={t("developer.users.steamNickname")} value={user.steamNickname ?? "—"}/>
              <Row label={t("developer.users.created")} value={format(user.createdAt)}/>
              <Row label={t("developer.users.lastLogin")} value={format(user.lastLoginAt)}/>
              <Row label={t("developer.users.status")} value={t("developer.users.active")}/>
            </dl>
            <h5>{t("developer.users.roles")}</h5>
            <div className="user-chip-list">{user.roles.length ? user.roles.map((role) =>
              <StatusBadge key={role.slug}>{role.displayName}</StatusBadge>) : "—"}</div>
            <h5>{t("developer.users.assignedBadges")}</h5>
            <div className="user-chip-list">{user.badges.length ? user.badges.map((badge) =>
              <span key={badge.slug}><UserBadgeIcon src={badge.iconUrl}/><span dir="auto">{badge.displayName}</span></span>) : "—"}</div>
            {onOpenAssignments && <button className="secondary-button" type="button" onClick={onOpenAssignments}>{t("developer.users.openAssignments")}</button>}
          </div>}
    </Surface>
  </div>;
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return <div><dt>{label}</dt><dd dir={ltr ? "ltr" : "auto"}>{value}</dd></div>;
}

function ShortIdentifier({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return <span className="user-short-id" dir="ltr" title={value}>
    <code>{shortId(value)}</code>
    <button
      type="button"
      aria-label={t(copied ? "developer.users.copied" : "developer.users.copyUuid")}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
      }}
    >{copied ? <Check size={15}/> : <Copy size={15}/>}</button>
  </span>;
}

function shortId(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function UserBadgeIcon({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed
    ? <img src={src} alt="" onError={() => setFailed(true)}/>
    : <Medal size={18} aria-hidden="true"/>;
}

function trapFocus(event: KeyboardEvent, root: HTMLElement) {
  const controls = [...root.querySelectorAll<HTMLElement>(
    "button,[href],input,select,textarea,[tabindex='0']"
  )].filter((element) => !element.hasAttribute("disabled"));
  if (!controls.length) return;
  const [first] = controls;
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}
