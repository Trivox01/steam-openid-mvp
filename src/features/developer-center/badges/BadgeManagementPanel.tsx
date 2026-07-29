import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Edit3, Medal, Plus, RefreshCw, Upload } from "lucide-react";
import { Surface } from "../../../components/ui/Surface";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { useTranslation } from "../../../i18n/TranslationContext";
import type { AuthorizationSnapshot } from "../authorizationTypes";
import type { BadgeAdminClient } from "./BadgeAdminClient";
import type { BadgeCategory, BadgeDraft, BadgeRarity, ManagedBadge } from "./types";

const categories: BadgeCategory[] = ["staff", "community", "achievement", "event", "legacy", "special"];
const rarities: BadgeRarity[] = ["common", "uncommon", "rare", "epic", "legendary", "exclusive"];
const emptyDraft: BadgeDraft = {
  slug: "", displayName: "", description: "", category: "community",
  rarity: "common", priority: 0, isActive: true, isVisible: true, grantMode: "manual"
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
  const [draft, setDraft] = useState<BadgeDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string>();

  const query = useMemo(() => {
    const value = new URLSearchParams({ page: String(page), pageSize: "20", sort });
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
      if (!signal?.aborted) { setError(reason instanceof Error ? reason.message : "REQUEST_FAILED"); setState("error"); }
    }
  }, [client, query]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const open = (badge?: ManagedBadge) => {
    setError("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(undefined);
    setEditing(badge ?? "new");
    setDraft(badge ? {
      slug: badge.slug, displayName: badge.displayName, description: badge.description,
      category: badge.category, rarity: badge.rarity, priority: badge.priority,
      isActive: badge.isActive, isVisible: badge.isVisible, grantMode: badge.grantMode,
      ...(badge.iconAssetId ? { iconAssetId: badge.iconAssetId } : {}),
      ...(badge.startsAt ? { startsAt: badge.startsAt.slice(0, 16) } : {}),
      ...(badge.endsAt ? { endsAt: badge.endsAt.slice(0, 16) } : {})
    } : emptyDraft);
  };
  const save = async () => {
    if (!client || saving) return;
    if (
      editing !== "new" && editing &&
      editing.slug !== draft.slug &&
      !confirm(t("developer.badges.slugConfirm"))
    ) return;
    setSaving(true); setError("");
    try {
      if (editing === "new") await client.create(draft);
      else if (editing) await client.update(editing.id, draft);
      setEditing(undefined); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "REQUEST_FAILED"); }
    finally { setSaving(false); }
  };
  const upload = async (file?: File) => {
    if (!client || !file) return;
    setSaving(true); setError("");
    try {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(file));
      const asset = await client.upload(file);
      setDraft((current) => ({ ...current, iconAssetId: asset.id }));
      if (!asset.isSquare) setError(t("developer.badges.squareWarning"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "REQUEST_FAILED"); }
    finally { setSaving(false); }
  };
  const archive = async (badge: ManagedBadge) => {
    if (!client || !confirm(t("developer.badges.archiveConfirm", { name: badge.displayName }))) return;
    try { await client.archive(badge.id); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "REQUEST_FAILED"); }
  };

  return (
    <div className="badge-admin">
      <header className="badge-admin-header">
        <div><h2>{t("developer.badges.title")}</h2><p>{t("developer.badges.description")}</p></div>
        {can("badges.create") && <button className="primary-button" type="button" onClick={() => open()}><Plus size={17}/>{t("developer.badges.create")}</button>}
      </header>
      <Surface className="badge-toolbar">
        <input aria-label={t("developer.badges.search")} placeholder={t("developer.badges.search")} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}/>
        <Select value={category} onChange={setCategory} label={t("developer.badges.category")} values={categories}/>
        <Select value={rarity} onChange={setRarity} label={t("developer.badges.rarity")} values={rarities}/>
        <Select value={status} onChange={setStatus} label={t("developer.badges.status")} values={["active","inactive","archived"]}/>
        <Select value={sort} onChange={setSort} label={t("developer.badges.sort")} values={["updated_desc","updated_asc","priority_desc","name_asc"]} all={false}/>
      </Surface>
      {!editing && error && state === "ready" ? (
        <p className="field-error" role="alert">{error}</p>
      ) : null}
      {state === "loading" ? <Surface className="badge-state">{t("developer.badges.loading")}</Surface>
        : state === "error" ? <Surface className="badge-state"><p>{error || t("developer.badges.error")}</p><button type="button" onClick={() => void load()}><RefreshCw size={16}/>{t("developer.badges.retry")}</button></Surface>
        : items.length === 0 ? <Surface className="badge-state"><Medal/><p>{t("developer.badges.empty")}</p></Surface>
        : <Surface className="badge-table-wrap"><table className="badge-table"><thead><tr>
          <th>{t("developer.badges.name")}</th><th>{t("developer.badges.category")}</th><th>{t("developer.badges.rarity")}</th><th>{t("developer.badges.priority")}</th><th>{t("developer.badges.status")}</th><th>{t("developer.badges.actions")}</th>
        </tr></thead><tbody>{items.map((badge) => <tr key={badge.id}>
          <td><span className="badge-icon"><BadgeIcon assetId={badge.iconAssetId} client={client}/></span><strong dir="auto">{badge.displayName}</strong><small>{badge.slug}</small></td>
          <td>{badge.category}</td><td><StatusBadge tone="accent">{badge.rarity}</StatusBadge></td><td>{badge.priority}</td>
          <td><StatusBadge tone={badge.archivedAt ? "neutral" : badge.isActive ? "success" : "warning"}>{badge.archivedAt ? "archived" : badge.isActive ? "active" : "inactive"}</StatusBadge></td>
          <td><span title={t("developer.badges.updated")}>{new Date(badge.updatedAt).toLocaleDateString()}</span> · {badge.isVisible ? t("developer.badges.visible") : t("developer.badges.hidden")}<div className="badge-actions">
            {can("badges.edit") && !badge.archivedAt && <button type="button" aria-label={t("developer.badges.edit")} onClick={() => open(badge)}><Edit3 size={16}/></button>}
            {can("badges.delete") && !badge.archivedAt && <button type="button" aria-label={t("developer.badges.archive")} onClick={() => void archive(badge)}><Archive size={16}/></button>}
          </div></td>
        </tr>)}</tbody></table></Surface>}
      {total > 20 && <div className="badge-pagination"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}>{t("developer.badges.previous")}</button><span>{page}</span><button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>{t("developer.badges.next")}</button></div>}
      {editing && <div className="dialog-backdrop" role="presentation"><Surface className="badge-editor" role="dialog" aria-modal="true" aria-labelledby="badge-editor-title">
        <header><h3 id="badge-editor-title">{editing === "new" ? t("developer.badges.create") : t("developer.badges.edit")}</h3><button type="button" onClick={() => setEditing(undefined)}>×</button></header>
        <div className="badge-preview"><div className="badge-preview-large">{previewUrl ? <img src={previewUrl} alt=""/> : <Medal/>}</div><span>{previewUrl ? <img className="badge-preview-inline" src={previewUrl} alt=""/> : <Medal size={20}/>}<strong dir="auto">{draft.displayName || t("developer.badges.previewName")}</strong></span><p title={draft.description}>{draft.description || t("developer.badges.previewDescription")}</p></div>
        <div className="badge-form">
          <Field label={t("developer.badges.name")} value={draft.displayName} onChange={(v) => setDraft({...draft, displayName:v})}/>
          <Field label={t("developer.badges.slug")} value={draft.slug} onChange={(v) => setDraft({...draft, slug:v})}/>
          <label>{t("developer.badges.descriptionLabel")}<textarea value={draft.description} maxLength={500} onChange={(e) => setDraft({...draft, description:e.target.value})}/></label>
          <Select value={draft.category} onChange={(v) => setDraft({...draft, category:v as BadgeCategory})} label={t("developer.badges.category")} values={categories} all={false}/>
          <Select value={draft.rarity} onChange={(v) => setDraft({...draft, rarity:v as BadgeRarity})} label={t("developer.badges.rarity")} values={rarities} all={false}/>
          <Field label={t("developer.badges.priority")} type="number" value={String(draft.priority)} onChange={(v) => setDraft({...draft, priority:Number(v)})}/>
          <Select value={draft.grantMode} onChange={(v) => setDraft({...draft, grantMode:v as "manual"|"automatic"})} label={t("developer.badges.grantMode")} values={["manual","automatic"]} all={false}/>
          <Field label={t("developer.badges.startsAt")} type="datetime-local" value={draft.startsAt ?? ""} onChange={(v) => setDraft({...draft, startsAt:v || undefined})}/>
          <Field label={t("developer.badges.endsAt")} type="datetime-local" value={draft.endsAt ?? ""} onChange={(v) => setDraft({...draft, endsAt:v || undefined})}/>
          <label><input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({...draft,isActive:e.target.checked})}/>{t("developer.badges.active")}</label>
          <label><input type="checkbox" checked={draft.isVisible} onChange={(e) => setDraft({...draft,isVisible:e.target.checked})}/>{t("developer.badges.visible")}</label>
          {can("assets.upload") && <label className="badge-upload"><Upload size={16}/>{t("developer.badges.upload")}<input type="file" accept="image/png,image/webp" onChange={(e) => void upload(e.target.files?.[0])}/></label>}
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <footer><button type="button" onClick={() => setEditing(undefined)}>{t("common.cancel")}</button><button className="primary-button" type="button" disabled={saving || !draft.displayName || !draft.slug} onClick={() => void save()}>{saving ? t("developer.badges.saving") : t("common.save")}</button></footer>
      </Surface></div>}
    </div>
  );
}

function Select({ value, onChange, label, values, all = true }: {value:string;onChange:(v:string)=>void;label:string;values:readonly string[];all?:boolean}) {
  return <label><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(e)=>onChange(e.target.value)}>{all&&<option value="">{label}</option>}{values.map(v=><option key={v} value={v}>{v}</option>)}</select></label>;
}
function Field({label,value,onChange,type="text"}:{label:string;value:string;onChange:(v:string)=>void;type?:string}) {
  return <label>{label}<input type={type} value={value} onChange={(e)=>onChange(e.target.value)}/></label>;
}
function BadgeIcon({ assetId, client }: { assetId?: string; client?: BadgeAdminClient }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!assetId || !client) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void client.loadAsset(assetId, controller.signal).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, client]);
  return url ? <img src={url} alt="" loading="lazy"/> : <Medal size={18}/>;
}
