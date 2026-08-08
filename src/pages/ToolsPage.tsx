import { useCallback, useEffect, useMemo, useState } from "react";
import { Heart, Search } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyView, ErrorView } from "../components/ui/StateViews";
import { Skeleton } from "../components/ui/Skeleton";
import { ToolCard } from "../features/tools/ToolCard";
import { ToolImage } from "../features/tools/ToolImage";
import type { NexusTool, ToolCategory, ToolFavoriteEntry } from "../features/tools/types";
import { useTranslation } from "../i18n/TranslationContext";
import { services } from "../services/compositionRoot";

type ToolTab = "all" | "featured" | "new" | "topRated" | "recommended";
const TABS: ToolTab[] = ["all", "featured", "new", "topRated", "recommended"];
const TAB_SORT: Record<Exclude<ToolTab, "all">, string> = { featured: "feature", new: "newest", topRated: "top_rated", recommended: "recommended" };

export function ToolsPage({ onOpen }: { onOpen: (slug: string) => void }) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<NexusTool[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [tab, setTab] = useState<ToolTab>("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [featured, setFeatured] = useState<NexusTool | null>(null);
  const [categories, setCategories] = useState<ToolCategory[]>([]);
  const [favoriteEntries, setFavoriteEntries] = useState<ToolFavoriteEntry[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favBusyIds, setFavBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);

  const favIds = useMemo(() => new Set(favoriteEntries.map((entry) => entry.toolId)), [favoriteEntries]);

  useEffect(() => {
    const id = window.setTimeout(() => setAppliedSearch(search), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    if (!services.tools) return;
    const controller = new AbortController();
    services.tools.catalogCategories(controller.signal).then((result) => setCategories(result.items as ToolCategory[])).catch(() => {});
    services.tools.list(new URLSearchParams({ sort: "feature", pageSize: "1" }), controller.signal).then((result) => setFeatured(result.items[0] ?? null)).catch(() => {});
    services.tools.listFavorites(1, 100, controller.signal).then((result) => setFavoriteEntries(result.items)).catch(() => {});
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const controller = new AbortController();
    if (!services.tools) { setState("error"); return; }
    const params = new URLSearchParams({ page: "1", pageSize: "100", sort: tab === "all" ? "newest" : TAB_SORT[tab] });
    if (appliedSearch) params.set("search", appliedSearch);
    if (category) params.set("category", category);
    setState((current) => (current === "ready" && tools.length ? "ready" : "loading"));
    services.tools.list(params, controller.signal).then((result) => { setTools(result.items); setState("ready"); }).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [appliedSearch, category, tab, revision]);

  const favoritesTools = useMemo(() => {
    const query = appliedSearch.trim().toLocaleLowerCase();
    return favoriteEntries
      .map((entry) => entry.tool)
      .filter((tool) => (!appliedSearch || `${tool.name} ${tool.shortDescription} ${tool.developerName}`.toLocaleLowerCase().includes(query)) && (!category || tool.category?.slug === category));
  }, [favoriteEntries, appliedSearch, category]);

  const favoriteToolsFor = useCallback(async (tool: NexusTool) => {
    const toolId = tool.id;
    const target = !favIds.has(toolId);
    setFavBusyIds((previous) => new Set(previous).add(toolId));
    setNotice("");
    try {
      if (!services.tools) throw new Error("tools unavailable");
      await services.tools.favorite(toolId, target);
      setFavoriteEntries((previous) => target ? [{ toolId, createdAtMs: Date.now(), stats: { views: 0, downloadClicks: 0, favorites: 1 }, tool }, ...previous] : previous.filter((entry) => entry.toolId !== toolId));
    } catch {
      setNotice(t("toolsPage.favoriteError"));
    } finally {
      setFavBusyIds((previous) => { const next = new Set(previous); next.delete(toolId); return next; });
    }
  }, [favIds, t]);

  const shownTools = favoritesOnly ? favoritesTools : tools;

  return <section className="tools-page">
    <PageHeader eyebrow={t("tools.eyebrow")} title={t("tools.title")} description={t("tools.description")} />
    {featured && !favoritesOnly && <article className="tools-hero" role="link" tabIndex={0} aria-label={`${t("tools.viewDetails")}: ${featured.name}`} onClick={() => onOpen(featured.slug)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(featured.slug); } }}>
      <ToolImage className="tools-hero__cover" src={featured.coverUrl} eager />
      <div className="tools-hero__content"><span className="tools-hero__eyebrow">{t("toolsPage.heroFeatured")}</span><h2 dir="auto">{featured.name}</h2><p>{featured.shortDescription}</p></div>
    </article>}
    <div className="tools-toolbar">
      <label className="tools-toolbar__search"><Search aria-hidden="true" /><span className="sr-only">{t("tools.search")}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("toolsPage.searchPlaceholder")} type="search" /></label>
      {categories.length > 0 && <label className="tools-toolbar__category"><span className="sr-only">{t("toolsPage.filterByCategory")}</span><select aria-label={t("toolsPage.filterByCategory")} value={category} onChange={(event) => setCategory(event.target.value)}><option value="">{t("toolsPage.categoryAll")}</option>{categories.map((value) => <option value={value.slug} key={value.id}>{value.name}</option>)}</select></label>}
      <button type="button" className={`tools-toolbar__favorites ${favoritesOnly ? "is-active" : ""}`} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)}><Heart aria-hidden="true" /><span>{t("toolsPage.favoritesOnly")}</span>{favIds.size > 0 && <small>{favIds.size}</small>}</button>
    </div>
    <div role="tablist" aria-label={t("toolsPage.filterBySort")} className="tools-tabs">{TABS.map((value) => <button type="button" role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)}>{t(`toolsPage.section${value[0].toUpperCase()}${value.slice(1)}`)}</button>)}</div>
    {notice && <p className="tools-notice" role="status">{notice}</p>}
    {state === "error" ? <ErrorView message={t("tools.loadError")} onRetry={() => setRevision((value) => value + 1)} />
      : state === "loading" && shownTools.length === 0 ? <ToolCardsSkeleton />
      : shownTools.length === 0 ? <EmptyView compact={Boolean(appliedSearch || category)} title={appliedSearch ? t("toolsPage.searchEmptyTitle") : favoritesOnly ? t("toolsPage.favoritesEmptyTitle") : t("tools.empty")} description={favoritesOnly ? t("toolsPage.favoritesEmptyDescription") : appliedSearch ? t("toolsPage.searchEmptyDescription") : t("tools.emptyDescription")} />
      : <section aria-label={t(`toolsPage.section${tab[0].toUpperCase()}${tab.slice(1)}`)} className="tools-results"><section className="tools-results__header"><h2 className="nexus-display-title">{favoritesOnly ? t("toolsPage.favoritesTitle") : appliedSearch ? t("toolsPage.searchResults", { count: shownTools.length }) : t(`toolsPage.section${tab[0].toUpperCase()}${tab.slice(1)}`)}</h2></section><div className="tools-grid">{shownTools.map((tool) => <ToolCard key={tool.id} tool={tool} onOpen={onOpen} favoriteActive={favIds.has(tool.id)} favoriteBusy={favBusyIds.has(tool.id)} onFavoriteToggle={() => favoriteToolsFor(tool)} />)}</div></section>}
  </section>;
}

function ToolCardsSkeleton() {
  return <div className="tools-grid" role="status" aria-label="Loading tools"><Skeleton className="tools-card-skeleton" /><Skeleton className="tools-card-skeleton" /><Skeleton className="tools-card-skeleton" /><Skeleton className="tools-card-skeleton" /><Skeleton className="tools-card-skeleton" /><Skeleton className="tools-card-skeleton" /></div>;
}