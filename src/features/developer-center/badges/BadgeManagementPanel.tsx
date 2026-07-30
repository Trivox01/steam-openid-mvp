import {
  useCallback, useEffect, useId, useMemo, useRef, useState
} from "react";
import {
  Archive, CalendarDays, Edit3, ImagePlus, Medal, Plus,
  RefreshCw, Trash2, Upload, X
} from "lucide-react";
import { Surface } from "../../../components/ui/Surface";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { useTranslation } from "../../../i18n/TranslationContext";
import type { AuthorizationSnapshot } from "../authorizationTypes";
import {
  BadgeAdminClient
} from "./BadgeAdminClient";
import type {
  BadgeCategory, BadgeDraft, BadgeRarity, ManagedBadge
} from "./types";
import {
  validateBadgeDraft,
  validateBadgeIconFile
} from "./badgeEditorValidation";

const categories: BadgeCategory[] = [
  "staff", "community", "achievement", "event", "legacy", "special"
];
const rarities: BadgeRarity[] = [
  "common", "uncommon", "rare", "epic", "legendary", "exclusive"
];
const emptyDraft: BadgeDraft = {
  slug: "", displayName: "", description: "", category: "community",
  rarity: "common", priority: 0, isActive: true, isVisible: true,
  grantMode: "manual"
};

export function BadgeManagementPanel({ snapshot, client }: {
  snapshot: AuthorizationSnapshot; client?: BadgeAdminClient;
}) {
  const { t } = useTranslation();
  const can = (permission: string) => snapshot.permissions.includes(permission);
  const [items, setItems] = useState<ManagedBadge[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [rarity, setRarity] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("updated_desc");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = useState<ManagedBadge | "new">();
  const [error, setError] = useState("");
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const query = useMemo(() => {
    const value = new URLSearchParams({
      page: String(page), pageSize: "20", sort
    });
    if (search.trim()) value.set("search", search.trim());
    if (category) value.set("category", category);
    if (rarity) value.set("rarity", rarity);
    if (status) value.set("status", status);
    return value;
  }, [category, page, rarity, search, sort, status]);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!client) { setState("error"); return; }
    setState("loading");
    try {
      const result = await client.list(query, signal);
      setItems(result.items); setTotal(result.total); setState("ready");
    } catch (reason) {
      if (!signal?.aborted) {
        setError(reason instanceof Error ? reason.message : "REQUEST_FAILED");
        setState("error");
      }
    }
  }, [client, query]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const open = (badge?: ManagedBadge) => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setError("");
    setEditing(badge ?? "new");
  };
  const closeEditor = () => {
    setEditing(undefined);
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  };
  const archive = async (badge: ManagedBadge) => {
    if (
      !client ||
      !confirm(t("developer.badges.archiveConfirm", { name: badge.displayName }))
    ) return;
    try { await client.archive(badge.id); await load(); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : "REQUEST_FAILED");
    }
  };

  return (
    <div className="badge-admin">
      <header className="badge-admin-header">
        <div>
          <h2>{t("developer.badges.title")}</h2>
          <p>{t("developer.badges.description")}</p>
        </div>
        {can("badges.create") && (
          <button className="primary-button" type="button" onClick={() => open()}>
            <Plus size={17}/>{t("developer.badges.create")}
          </button>
        )}
      </header>
      <Surface className="badge-toolbar">
        <input aria-label={t("developer.badges.search")}
          placeholder={t("developer.badges.search")} value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1); }}/>
        <FilterSelect value={category} onChange={setCategory}
          label={t("developer.badges.category")} values={categories}/>
        <FilterSelect value={rarity} onChange={setRarity}
          label={t("developer.badges.rarity")} values={rarities}/>
        <FilterSelect value={status} onChange={setStatus}
          label={t("developer.badges.status")}
          values={["active", "inactive", "archived"]}/>
        <FilterSelect value={sort} onChange={setSort}
          label={t("developer.badges.sort")}
          values={["updated_desc", "updated_asc", "priority_desc", "name_asc"]}
          all={false}/>
      </Surface>
      {!editing && error && state === "ready"
        ? <p className="field-error" role="alert">{safeError(error, t)}</p>
        : null}
      {state === "loading"
        ? <Surface className="badge-state">{t("developer.badges.loading")}</Surface>
        : state === "error"
          ? <Surface className="badge-state"><p>{safeError(error, t)}</p>
            <button type="button" onClick={() => void load()}>
              <RefreshCw size={16}/>{t("developer.badges.retry")}
            </button></Surface>
          : items.length === 0
            ? <Surface className="badge-state"><Medal/>
              <p>{t("developer.badges.empty")}</p></Surface>
            : <Surface className="badge-table-wrap">
              <table className="badge-table"><thead><tr>
                <th>{t("developer.badges.name")}</th>
                <th>{t("developer.badges.category")}</th>
                <th>{t("developer.badges.rarity")}</th>
                <th>{t("developer.badges.priority")}</th>
                <th>{t("developer.badges.status")}</th>
                <th>{t("developer.badges.actions")}</th>
              </tr></thead><tbody>{items.map((badge) => <tr key={badge.id}>
                <td><span className="badge-icon">
                  <BadgeIcon assetId={badge.iconAssetId} client={client}/>
                </span><strong dir="auto">{badge.displayName}</strong>
                  <small>{badge.slug}</small></td>
                <td>{badge.category}</td>
                <td><StatusBadge tone="accent">{badge.rarity}</StatusBadge></td>
                <td>{badge.priority}</td>
                <td><StatusBadge tone={badge.archivedAt ? "neutral"
                  : badge.isActive ? "success" : "warning"}>
                  {badge.archivedAt ? "archived"
                    : badge.isActive ? "active" : "inactive"}
                </StatusBadge></td>
                <td><span title={t("developer.badges.updated")}>
                  {new Date(badge.updatedAt).toLocaleDateString()}
                </span> · {badge.isVisible
                  ? t("developer.badges.visible")
                  : t("developer.badges.hidden")}
                  <div className="badge-actions">
                    {can("badges.edit") && !badge.archivedAt &&
                      <button type="button"
                        aria-label={t("developer.badges.edit")}
                        onClick={() => open(badge)}><Edit3 size={16}/></button>}
                    {can("badges.delete") && !badge.archivedAt &&
                      <button type="button"
                        aria-label={t("developer.badges.archive")}
                        onClick={() => void archive(badge)}>
                        <Archive size={16}/>
                      </button>}
                  </div></td>
              </tr>)}</tbody></table>
            </Surface>}
      {total > 20 && <div className="badge-pagination">
        <button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
          {t("developer.badges.previous")}
        </button><span>{page}</span>
        <button disabled={page * 20 >= total}
          onClick={() => setPage((value) => value + 1)}>
          {t("developer.badges.next")}
        </button>
      </div>}
      {editing && <BadgeEditorDialog badge={editing} client={client}
        canUpload={can("assets.upload")} onClose={closeEditor}
        onSaved={async () => { closeEditor(); await load(); }}/>}
    </div>
  );
}

function BadgeEditorDialog({ badge, client, canUpload, onClose, onSaved }: {
  badge: ManagedBadge | "new"; client?: BadgeAdminClient; canUpload: boolean;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const initial = useMemo<BadgeDraft>(() => badge === "new" ? emptyDraft : {
    slug: badge.slug, displayName: badge.displayName,
    description: badge.description, category: badge.category,
    rarity: badge.rarity, priority: badge.priority,
    isActive: badge.isActive, isVisible: badge.isVisible,
    grantMode: badge.grantMode,
    ...(badge.iconAssetId ? { iconAssetId: badge.iconAssetId } : {}),
    ...(badge.startsAt ? { startsAt: badge.startsAt.slice(0, 16) } : {}),
    ...(badge.endsAt ? { endsAt: badge.endsAt.slice(0, 16) } : {})
  }, [badge]);
  const [draft, setDraft] = useState(initial);
  const [file, setFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || Boolean(file);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault(); requestClose();
      }
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex='-1'])"
      )];
      if (!controls.length) return;
      const first = controls[0]; const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    dialog.addEventListener("keydown", keyboard);
    return () => dialog.removeEventListener("keydown", keyboard);
  });

  const requestClose = () => {
    if (dirty && !confirm(t("developer.badges.discardConfirm"))) return;
    onClose();
  };
  const change = <K extends keyof BadgeDraft>(key: K, value: BadgeDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current }; delete next[key]; return next;
    });
  };
  const chooseFile = (selected?: File) => {
    if (!selected) return;
    const error = validateBadgeIconFile(selected);
    if (error) { setErrors((current) => ({ ...current, icon: error })); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selected); setPreviewUrl(URL.createObjectURL(selected));
    setErrors((current) => { const next = { ...current }; delete next.icon; return next; });
  };
  const removeFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(undefined); setPreviewUrl(undefined);
    setErrors((current) => { const next = { ...current }; delete next.icon; return next; });
  };
  const save = async () => {
    if (!client || saving) return;
    const validation = validateBadgeDraft(draft);
    if (Object.keys(validation).length) {
      setErrors(validation);
      requestAnimationFrame(() => {
        dialogRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      });
      return;
    }
    if (
      badge !== "new" && badge.slug !== draft.slug &&
      !confirm(t("developer.badges.slugConfirm"))
    ) return;
    setSaving(true); setServerError("");
    try {
      let mutation = draft;
      if (file) {
        const asset = await client.upload(file);
        mutation = { ...draft, iconAssetId: asset.id };
        if (!asset.isSquare) setServerError(t("developer.badges.squareWarning"));
      }
      if (badge === "new") await client.create(mutation);
      else await client.update(badge.id, mutation);
      await onSaved();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "REQUEST_FAILED";
      if (code === "BADGE_SLUG_CONFLICT") {
        setErrors((current) => ({ ...current, slug: code }));
        requestAnimationFrame(() =>
          dialogRef.current?.querySelector<HTMLElement>("[data-field='slug']")?.focus()
        );
      } else if (code === "INVALID_BADGE_DATES") {
        setErrors((current) => ({ ...current, endsAt: code }));
      } else {
        setServerError(code);
      }
    } finally { setSaving(false); }
  };
  const validation = validateBadgeDraft(draft);
  const saveDisabled = saving || Boolean(
    validation.displayName || validation.slug || validation.priority ||
    validation.startsAt || validation.endsAt
  );
  const icon = previewUrl
    ? <img src={previewUrl} alt=""/>
    : badge !== "new" && badge.iconAssetId
      ? <BadgeIcon assetId={badge.iconAssetId} client={client}/>
      : <Medal/>;

  return <div className="dialog-backdrop" role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
    <section ref={dialogRef}
      className="ds-surface ds-surface--elevated badge-editor"
      role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="badge-editor-header">
        <div><h3 id={titleId}>{badge === "new"
          ? t("developer.badges.create") : t("developer.badges.edit")}</h3>
          <p>{t("developer.badges.editorDescription")}</p></div>
        <button type="button" aria-label={t("common.cancel")} disabled={saving}
          onClick={requestClose}><X size={18}/></button>
      </header>

      <div className="badge-editor-body">
        <div className="badge-form">
          <FormField id="badge-name" label={t("developer.badges.name")}
            help={t("developer.badges.helpName")} required error={errors.displayName}>
            <input ref={firstFieldRef} id="badge-name" data-field="displayName"
              placeholder={t("developer.badges.placeholderName")}
              value={draft.displayName} maxLength={80}
              aria-invalid={Boolean(errors.displayName)}
              aria-describedby="badge-name-help badge-name-error"
              onChange={(event) => change("displayName", event.target.value)}/>
          </FormField>
          <FormField id="badge-slug" label={t("developer.badges.slug")}
            help={t("developer.badges.helpSlug")} required error={errors.slug}>
            <input id="badge-slug" data-field="slug" dir="ltr"
              placeholder={t("developer.badges.placeholderSlug")}
              value={draft.slug} maxLength={64}
              aria-invalid={Boolean(errors.slug)}
              aria-describedby="badge-slug-help badge-slug-error"
              onChange={(event) => change("slug", event.target.value.toLowerCase())}/>
          </FormField>
          <FormField id="badge-description"
            className="badge-field--wide"
            label={t("developer.badges.descriptionLabel")}
            help={t("developer.badges.helpDescription")}
            error={errors.description}
            suffix={`${draft.description.length}/500`}>
            <textarea id="badge-description"
              placeholder={t("developer.badges.placeholderDescription")}
              value={draft.description} maxLength={500}
              aria-invalid={Boolean(errors.description)}
              aria-describedby="badge-description-help badge-description-error"
              onChange={(event) => change("description", event.target.value)}/>
          </FormField>
          <FormField id="badge-category" label={t("developer.badges.category")}
            required>
            <select id="badge-category" value={draft.category}
              onChange={(event) => change("category", event.target.value as BadgeCategory)}>
              {categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </FormField>
          <FormField id="badge-rarity" label={t("developer.badges.rarity")} required>
            <select id="badge-rarity" value={draft.rarity}
              onChange={(event) => change("rarity", event.target.value as BadgeRarity)}>
              {rarities.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </FormField>
          <FormField id="badge-priority" label={t("developer.badges.priority")}
            help={t("developer.badges.helpPriority")} required error={errors.priority}>
            <input id="badge-priority" data-field="priority" type="number"
              min={0} max={10000} step={1}
              placeholder={t("developer.badges.placeholderPriority")}
              value={draft.priority}
              aria-invalid={Boolean(errors.priority)}
              aria-describedby="badge-priority-help badge-priority-error"
              onChange={(event) => change("priority", Number(event.target.value))}/>
          </FormField>
          <FormField id="badge-grant-mode"
            label={t("developer.badges.grantMode")} required>
            <select id="badge-grant-mode" value={draft.grantMode}
              onChange={(event) => change(
                "grantMode", event.target.value as "manual" | "automatic"
              )}>
              <option value="manual">manual</option>
              <option value="automatic">automatic</option>
            </select>
          </FormField>
          <FormField id="badge-starts" label={t("developer.badges.startsAt")}
            help={t("developer.badges.helpStartsAt")} error={errors.startsAt}
            icon={<CalendarDays size={16}/>}>
            <input id="badge-starts" type="datetime-local"
              value={draft.startsAt ?? ""}
              aria-invalid={Boolean(errors.startsAt)}
              aria-describedby="badge-starts-help badge-starts-error"
              onChange={(event) => change("startsAt", event.target.value || undefined)}/>
          </FormField>
          <FormField id="badge-ends" label={t("developer.badges.endsAt")}
            help={t("developer.badges.helpEndsAt")} error={errors.endsAt}
            icon={<CalendarDays size={16}/>}>
            <input id="badge-ends" data-field="endsAt" type="datetime-local"
              value={draft.endsAt ?? ""}
              aria-invalid={Boolean(errors.endsAt)}
              aria-describedby="badge-ends-help badge-ends-error"
              onChange={(event) => change("endsAt", event.target.value || undefined)}/>
          </FormField>
          <ToggleField id="badge-active" checked={draft.isActive}
            label={t("developer.badges.active")}
            help={t("developer.badges.helpActive")}
            onChange={(value) => change("isActive", value)}/>
          <ToggleField id="badge-visible" checked={draft.isVisible}
            label={t("developer.badges.visible")}
            help={t("developer.badges.helpVisible")}
            onChange={(value) => change("isVisible", value)}/>

          {canUpload && <div className="badge-field badge-field--wide">
            <div className="badge-field-heading">
              <label id="badge-upload-label">{t("developer.badges.uploadTitle")}</label>
            </div>
            <label className={`badge-dropzone${errors.icon ? " has-error" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault(); chooseFile(event.dataTransfer.files[0]);
              }}>
              <ImagePlus size={26} aria-hidden="true"/>
              <strong>{t("developer.badges.uploadTitle")}</strong>
              <span>{t("developer.badges.uploadRequirements")}</span>
              <span>{t("developer.badges.uploadRecommended")}</span>
              <span className="badge-browse"><Upload size={15}/>
                {file ? t("developer.badges.replace") : t("developer.badges.browse")}
              </span>
              <input type="file" accept="image/png,image/webp"
                aria-labelledby="badge-upload-label"
                onChange={(event) => chooseFile(event.target.files?.[0])}/>
            </label>
            {file && <div className="badge-file">
              <div>{previewUrl && <img src={previewUrl} alt=""/>}
                <span><strong>{file.name}</strong>
                  <small>{formatBytes(file.size)}</small></span></div>
              <button type="button" onClick={removeFile}>
                <Trash2 size={15}/>{t("developer.badges.removeSelection")}
              </button>
            </div>}
            {errors.icon && <p className="badge-field-error" role="alert">
              <span aria-hidden="true">!</span>{fieldError(errors.icon, t)}
            </p>}
          </div>}
        </div>

        <aside className="badge-preview" aria-live="polite">
          <span className="badge-preview-eyebrow">{t("developer.badges.preview")}</span>
          <div className="badge-preview-large">{icon}</div>
          <div className="badge-preview-title">
            <div>{previewUrl && <img src={previewUrl} alt=""/>}
              <strong dir="auto">{draft.displayName ||
                t("developer.badges.previewName")}</strong></div>
            <StatusBadge tone="accent">{draft.rarity}</StatusBadge>
          </div>
          <p dir="auto">{draft.description ||
            t("developer.badges.previewDescription")}</p>
          <small>{draft.category} · {draft.grantMode}</small>
        </aside>
      </div>

      {serverError && <p className="badge-server-error" role="alert">
        <span aria-hidden="true">!</span>{safeError(serverError, t)}
      </p>}
      <footer className="badge-editor-footer">
        <button type="button" disabled={saving} onClick={requestClose}>
          {t("common.cancel")}
        </button>
        <button className="primary-button" type="button" disabled={saveDisabled}
          title={saveDisabled && !saving
            ? t("developer.badges.completeRequired") : undefined}
          onClick={() => void save()}>
          {saving ? <><RefreshCw className="badge-save-spinner" size={16}/>
            {t("developer.badges.saving")}</> : t("common.save")}
        </button>
      </footer>
    </section>
  </div>;
}

function FormField({ id, label, help, error, required, suffix, icon, className = "", children }: {
  id: string; label: string; help?: string; error?: string; required?: boolean;
  suffix?: string; icon?: React.ReactNode; className?: string; children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return <div className={`badge-field ${className}${error ? " has-error" : ""}`}>
    <div className="badge-field-heading"><label htmlFor={id}>{label}
      {required && <span aria-hidden="true"> *</span>}
      {required && <span className="sr-only">{t("developer.badges.required")}</span>}
    </label>{suffix && <small>{suffix}</small>}</div>
    <div className="badge-control">{icon && <span className="badge-control-icon">
      {icon}</span>}{children}</div>
    {help && <p id={`${id}-help`} className="badge-help">{help}</p>}
    {error && <p id={`${id}-error`} className="badge-field-error" role="alert">
      <span aria-hidden="true">!</span>{fieldError(error, t)}
    </p>}
  </div>;
}

function ToggleField({ id, label, help, checked, onChange }: {
  id: string; label: string; help: string; checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return <label className="badge-toggle" htmlFor={id}>
    <input id={id} type="checkbox" checked={checked}
      aria-describedby={`${id}-help`}
      onChange={(event) => onChange(event.target.checked)}/>
    <span className="badge-toggle-control" aria-hidden="true"/>
    <span><strong>{label}</strong><small id={`${id}-help`}>{help}</small></span>
  </label>;
}

function FilterSelect({ value, onChange, label, values, all = true }: {
  value: string; onChange: (value: string) => void; label: string;
  values: readonly string[]; all?: boolean;
}) {
  return <label><span className="sr-only">{label}</span>
    <select aria-label={label} value={value}
      onChange={(event) => onChange(event.target.value)}>
      {all && <option value="">{label}</option>}
      {values.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
    </select></label>;
}

function BadgeIcon({ assetId, client }: {
  assetId?: string; client?: BadgeAdminClient;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!assetId || !client) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void client.loadAsset(assetId, controller.signal).then((blob) => {
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, client]);
  return url ? <img src={url} alt="" loading="lazy"/> : <Medal size={18}/>;
}

function fieldError(code: string, t: (key: string) => string) {
  const known = new Set([
    "REQUIRED_NAME", "REQUIRED_SLUG", "INVALID_BADGE_SLUG",
    "BADGE_SLUG_CONFLICT", "DESCRIPTION_TOO_LONG", "INVALID_PRIORITY",
    "INVALID_BADGE_DATES", "INVALID_ASSET_FORMAT", "INVALID_ASSET_SIZE"
  ]);
  return t(`developer.badges.error.${known.has(code) ? code : "INVALID_BADGE"}`);
}
function safeError(code: string, t: (key: string) => string) {
  const known = new Set([
    "BADGE_SLUG_CONFLICT", "INVALID_BADGE", "INVALID_BADGE_SLUG",
    "INVALID_BADGE_DATES", "INVALID_ASSET_FORMAT", "INVALID_ASSET_SIZE",
    "AUTHENTICATION_REQUIRED", "PERMISSION_DENIED", "NETWORK_ERROR",
    "MALFORMED_RESPONSE", "REQUEST_FAILED", "BADGE_OPERATION_FAILED"
  ]);
  const normalized = code;
  return t(`developer.badges.error.${known.has(normalized)
    ? normalized : "REQUEST_FAILED"}`);
}
function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B`
    : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
