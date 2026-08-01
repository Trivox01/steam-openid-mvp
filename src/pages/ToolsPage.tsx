import { useEffect, useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/ui/StateViews";
import { ToolCard } from "../features/tools/ToolCard";
import { ToolImage } from "../features/tools/ToolImage";
import type { NexusTool } from "../features/tools/types";
import { useTranslation } from "../i18n/TranslationContext";
import { services } from "../services/compositionRoot";

export function ToolsPage({ onOpen }: { onOpen: (slug: string) => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<NexusTool[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [badge, setBadge] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (!services.tools) { setState("error"); return; }
    const params = new URLSearchParams({ page: "1", pageSize: "30", sort: "newest" });
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    if (badge) params.set("badge", badge);
    setState(items.length ? "ready" : "loading");
    services.tools.list(params, controller.signal).then((result) => { setItems(result.items); setState("ready"); }).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [search, category, badge, revision]);
  const categories = useMemo(() => [...new Map(items.flatMap((item) => item.category ? [item.category] : []).map((value) => [value.slug, value])).values()], [items]);
  const badges = useMemo(() => [...new Map(items.flatMap(item => item.badges).map(value => [value.slug, value])).values()], [items]);
  if (state === "loading") return <LoadingView label={t("state.loading")} />;
  if (state === "error") return <ErrorView message={t("tools.loadError")} onRetry={() => setRevision((value) => value + 1)} />;
  const featured = items.find((item) => item.isFeatured);
  const recommended = items.filter((item) => item.badges.some((badge) => badge.slug === "recommended")).slice(0, 4);
  const newest = items.filter((item) => item.id !== featured?.id).slice(0, 4);
  return <section className="tools-page">
    <PageHeader eyebrow={t("tools.eyebrow")} title={t("tools.title")} description={t("tools.description")} />
    {featured && <button className="tools-featured" type="button" onClick={() => onOpen(featured.slug)}><ToolImage className="tools-featured__image" src={featured.coverUrl} eager /><span><Sparkles /><small>{t("tools.featured")}</small><strong dir="auto">{featured.name}</strong><p>{featured.shortDescription}</p></span></button>}
    <div className="tools-filters"><label><Search aria-hidden="true" /><span className="sr-only">{t("tools.search")}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("tools.search")} /></label>{categories.length > 0 && <select aria-label={t("developer.tools.categories")} value={category} onChange={(event) => setCategory(event.target.value)}><option value="">{t("tools.all")}</option>{categories.map((value) => <option value={value.slug} key={value.id}>{value.name}</option>)}</select>}{badges.length > 0 && <select aria-label={t("developer.tools.badges")} value={badge} onChange={event => setBadge(event.target.value)}><option value="">{t("developer.tools.badges")}</option>{badges.map(value => <option value={value.slug} key={value.id}>{value.name}</option>)}</select>}</div>
    {!search && recommended.length > 0 && <ToolSection title={t("tools.recommended")} items={recommended} onOpen={onOpen} />}
    {!search && newest.length > 0 && <ToolSection title={t("tools.new")} items={newest} onOpen={onOpen} />}
    {items.length ? <ToolSection title={t("tools.all")} items={items} onOpen={onOpen} /> : <EmptyView compact title={t("tools.empty")} description={t("tools.emptyDescription")} />}
  </section>;
}

function ToolSection({ title, items, onOpen }: { title: string; items: NexusTool[]; onOpen: (slug: string) => void }) {
  return <section className="tools-section"><h2 className="nexus-display-title">{title}</h2><div className="tools-grid">{items.map((tool) => <ToolCard key={tool.id} tool={tool} onOpen={onOpen} />)}</div></section>;
}
