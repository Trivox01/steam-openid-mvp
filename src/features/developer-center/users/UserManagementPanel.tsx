import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Eye, Medal, RefreshCw, Search, Users, X } from "lucide-react";
import { Surface } from "../../../components/ui/Surface";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { ProfileAvatar } from "../../../components/ui/ProfileAvatar";
import { useTranslation } from "../../../i18n/TranslationContext";
import type { UserAdminClient } from "./UserAdminClient";
import type { ManagedUser, ManagedUserDetails, UserAccountStatus } from "./types";

const PAGE_SIZE = 20;

export function UserManagementPanel({
  client,
  canChangeStatus,
  onOpenAssignments
}: {
  client?: UserAdminClient;
  canChangeStatus: boolean;
  onOpenAssignments?: () => void;
}) {
  const { t, language } = useTranslation();
  const [items, setItems] = useState<ManagedUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [state, setState] = useState<"loading"|"ready"|"error">("loading");
  const [selectedId, setSelectedId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshedUser, setRefreshedUser] = useState<ManagedUserDetails>();
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeDetails = () => {
    setSelectedId(undefined);
    requestAnimationFrame(() => returnFocus.current?.focus());
  };
  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page), pageSize: String(PAGE_SIZE), sort
    });
    if (status) params.set("status", status);
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
  const refreshAll = async () => {
    if (!client || refreshing) return;
    setRefreshing(true);
    setRefreshFailed(false);
    client.invalidate(selectedId);
    const controller = new AbortController();
    const [listResult, detailsResult] = await Promise.allSettled([
      client.list(query, controller.signal),
      selectedId
        ? client.get(selectedId, controller.signal)
        : Promise.resolve(undefined)
    ]);
    if (listResult.status === "fulfilled") {
      setItems(listResult.value.items);
      setTotal(listResult.value.total);
    }
    if (detailsResult.status === "fulfilled" && detailsResult.value) {
      setRefreshedUser(detailsResult.value);
    }
    const failed = listResult.status === "rejected" ||
      detailsResult.status === "rejected";
    setRefreshFailed(failed);
    setNotice(t(failed
      ? "developer.users.refreshPartial"
      : "developer.users.refreshSuccess"));
    setRefreshing(false);
  };

  return (
    <section className="user-admin" aria-labelledby="user-admin-title">
      <header className="badge-admin-header">
        <div>
          <h2 id="user-admin-title">{t("developer.users.title")}</h2>
          <p>{t("developer.users.description")}</p>
        </div>
        <div className="user-header-actions">
          <StatusBadge tone="neutral">{t("developer.users.statusOnly")}</StatusBadge>
          <button
            className="secondary-button user-refresh-all"
            type="button"
            title={t("developer.users.refreshAllHelp")}
            aria-label={t("developer.users.refreshAllHelp")}
            aria-busy={refreshing}
            disabled={refreshing}
            onClick={() => void refreshAll()}
          >
            <RefreshCw className={refreshing ? "is-refreshing" : ""} size={16}/>
            {t(refreshing
              ? "developer.users.refreshing"
              : "developer.users.refreshAll")}
          </button>
        </div>
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
            <option value="">{t("developer.users.allStatuses")}</option>
            <option value="active">{t("developer.users.active")}</option>
            <option value="suspended">{t("developer.users.suspended")}</option>
            <option value="disabled">{t("developer.users.disabled")}</option>
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
      {notice && <p className={refreshFailed ? "user-status-notice is-error" : "user-status-notice"} role="status">
        {notice}
        {refreshFailed && <button type="button" onClick={() => void refreshAll()}>{t("common.retry")}</button>}
      </p>}
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
                <td><UserStatusBadge status={user.status}/></td>
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
        refreshedUser={refreshedUser?.id === selectedId ? refreshedUser : undefined}
        canChangeStatus={canChangeStatus}
        onUserChanged={(updated) => {
          setItems((current) => current.map((item) =>
            item.id === updated.id ? { ...item, ...updated } : item
          ));
          setNotice(t("developer.users.statusChanged"));
        }}
        onClose={closeDetails}
        onOpenAssignments={onOpenAssignments
          ? () => { setSelectedId(undefined); onOpenAssignments(); }
          : undefined}
      />}
    </section>
  );
}

function UserDetailsDrawer({
  id, client, format, refreshedUser, canChangeStatus, onUserChanged, onClose, onOpenAssignments
}: {
  id: string; client?: UserAdminClient; format: (value: string) => string;
  refreshedUser?: ManagedUserDetails;
  canChangeStatus: boolean;
  onUserChanged: (user: ManagedUserDetails) => void;
  onClose: () => void; onOpenAssignments?: () => void;
}) {
  const { t } = useTranslation();
  const cached = client?.getCached(id);
  const [state, setState] = useState<"loading"|"ready"|"error">(
    cached ? "ready" : "loading"
  );
  const [user, setUser] = useState<ManagedUserDetails | undefined>(cached);
  const [revision, setRevision] = useState(0);
  const [changingStatus, setChangingStatus] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const changeStatusButton = useRef<HTMLButtonElement>(null);
  const closeStatusDialog = () => {
    setChangingStatus(false);
    requestAnimationFrame(() => changeStatusButton.current?.focus());
  };
  useEffect(() => {
    if (refreshedUser) {
      setUser(refreshedUser);
      setState("ready");
    }
  }, [refreshedUser]);
  useEffect(() => {
    const currentCached = client?.getCached(id);
    setUser(currentCached);
    setState(currentCached ? "ready" : "loading");
    const request = new AbortController();
    client?.get(id, request.signal).then(
      (value) => { setUser(value); setState("ready"); },
      () => { if (!request.signal.aborted) setState("error"); }
    );
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (document.querySelector(".user-status-dialog")) return;
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
      {state === "loading" ? <UserDetailsSkeleton label={t("developer.users.loadingDetails")}/>
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
              <div><dt>{t("developer.users.status")}</dt><dd><UserStatusBadge status={user.status}/></dd></div>
            </dl>
            <h5>{t("developer.users.roles")}</h5>
            <div className="user-chip-list">{user.roles.length ? user.roles.map((role) =>
              <StatusBadge key={role.slug}>{role.displayName}</StatusBadge>) : "—"}</div>
            <h5>{t("developer.users.assignedBadges")}</h5>
            <div className="user-chip-list">{user.badges.length ? user.badges.map((badge) =>
              <span key={badge.slug}><UserBadgeIcon src={badge.iconUrl}/><span dir="auto">{badge.displayName}</span></span>) : "—"}</div>
            {canChangeStatus && <button
              ref={changeStatusButton}
              className="secondary-button"
              type="button"
              onClick={() => setChangingStatus(true)}
            >{t("developer.users.changeStatus")}</button>}
            {onOpenAssignments && <button className="secondary-button" type="button" onClick={onOpenAssignments}>{t("developer.users.openAssignments")}</button>}
          </div>}
    </Surface>
    {changingStatus && user && client && <ChangeStatusDialog
      user={user}
      client={client}
      onClose={closeStatusDialog}
      onChanged={(updated) => {
        setUser(updated);
        closeStatusDialog();
        onUserChanged(updated);
      }}
    />}
  </div>;
}

function ChangeStatusDialog({ user, client, onClose, onChanged }: {
  user: ManagedUserDetails;
  client: UserAdminClient;
  onClose: () => void;
  onChanged: (user: ManagedUserDetails) => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UserAccountStatus>(
    user.status === "active" ? "suspended" : "active"
  );
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle"|"saving"|"error">("idle");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state !== "saving") onClose();
      const root = heading.current?.closest<HTMLElement>(".user-status-dialog");
      if (event.key === "Tab" && root) trapFocus(event, root);
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [onClose, state]);
  const submit = async () => {
    if (status === user.status || state === "saving") return;
    setState("saving");
    try {
      onChanged(await client.changeStatus(user.id, status, reason));
    } catch {
      setState("error");
    }
  };
  return <div className="dialog-backdrop user-status-backdrop" role="presentation">
    <Surface className="user-status-dialog" role="dialog" aria-modal="true" aria-labelledby="change-user-status-title">
      <h3 id="change-user-status-title" ref={heading} tabIndex={-1}>{t("developer.users.changeStatus")}</h3>
      <p>{t("developer.users.changeStatusDescription")}</p>
      <label><span>{t("developer.users.newStatus")}</span>
        <select value={status} disabled={state === "saving"} onChange={(event) =>
          setStatus(event.target.value as UserAccountStatus)}>
          <option value="active">{t("developer.users.active")}</option>
          <option value="suspended">{t("developer.users.suspended")}</option>
          <option value="disabled">{t("developer.users.disabled")}</option>
        </select>
      </label>
      <label><span>{t("developer.users.reason")}</span>
        <textarea value={reason} maxLength={500} disabled={state === "saving"}
          onChange={(event) => setReason(event.target.value)}/></label>
      {state === "error" && <p role="alert">{t("developer.users.statusChangeError")}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={state === "saving"} onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" disabled={state === "saving" || status === user.status}
          onClick={() => void submit()}>
          {state === "saving" ? t("developer.users.processing") : t("developer.users.confirmStatus")}
        </button>
      </div>
    </Surface>
  </div>;
}

function UserStatusBadge({ status }: { status: UserAccountStatus }) {
  const { t } = useTranslation();
  const tone = status === "active" ? "success"
    : status === "suspended" ? "warning" : "error";
  return <StatusBadge tone={tone}>{t(`developer.users.${status}`)}</StatusBadge>;
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
    ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)}/>
    : <Medal size={18} aria-hidden="true"/>;
}

function UserDetailsSkeleton({ label }: { label: string }) {
  return <div className="user-details-skeleton" aria-busy="true" aria-label={label}>
    <span className="skeleton user-details-skeleton__avatar"/>
    <span className="skeleton user-details-skeleton__title"/>
    <span className="skeleton user-details-skeleton__line"/>
    <span className="skeleton user-details-skeleton__line"/>
    <span className="skeleton user-details-skeleton__badges"/>
  </div>;
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
