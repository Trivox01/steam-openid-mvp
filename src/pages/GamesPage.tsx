import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyView, ErrorView, LoadingView } from "../components/ui/StateViews";
import { FilterToolbar, SearchField, SelectControl } from "../components/ui/FilterBar";
import { PageHeader } from "../components/ui/PageHeader";
import type { Game, GameId } from "../types";
import type { GameCardData } from "../types/gameCard";
import type { LibraryFilter, LibraryPage, LibrarySort } from "../types/library";
import { services, smartSync } from "../services/compositionRoot";
import { GameCard } from "../components/games/GameCard";
import { useTranslation } from "../i18n/TranslationContext";
import { useLibraryRevision } from "../hooks/useLibraryRevision";
import { compareSmartGames } from "../services/smartLibraryRanking";

const PAGE_SIZE = 30;
const EMPTY_PAGE: LibraryPage = { games: [], total: 0, offset: 0, limit: PAGE_SIZE };

export function GamesPage({ onOpenGame }: { onOpenGame: (id: GameId) => void }) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("smart");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(EMPTY_PAGE);
  const [smart, setSmart] = useState<Game[]>([]);
  const [status, setStatus] = useState<"loading"|"success"|"error">("loading");
  const [retryRevision, setRetryRevision] = useState(0);
  const request = useRef(0);
  const revision = useLibraryRevision();

  useEffect(() => { const timer=setTimeout(()=>{setSearch(input);setOffset(0)},180); return()=>clearTimeout(timer); }, [input]);
  useEffect(() => { void smartSync.syncLibrary("page-open").catch(()=>undefined); }, []);
  useEffect(() => {
    const id=++request.current; setStatus("loading");
    Promise.all([
      services.games.query({search,filter,sort,offset,limit:PAGE_SIZE}),
      services.games.query({search:"",filter:"all",sort:"smart",offset:0,limit:100})
    ]).then(([next,snapshot])=>{if(id!==request.current)return;setPage(next);setSmart(snapshot.games);setStatus("success")})
      .catch(()=>{if(id===request.current)setStatus("error")});
  }, [search, filter, sort, offset, revision, retryRevision]);

  const sections=useMemo(()=>buildSections(smart),[smart]);
  const open=(id:GameId)=>{void services.games.opened(id);onOpenGame(id)};
  const track=async(id:GameId,value:boolean)=>{await services.games.track(id,value);setSmart((items)=>items.map((g)=>g.id===id?{...g,tracked:value}:g));setPage((p)=>({...p,games:p.games.map((g)=>g.id===id?{...g,tracked:value}:g)}))};
  if(status==="loading" && !page.games.length) return <LoadingView />;
  if(status==="error") return <ErrorView message={t("games.loadError")} onRetry={()=>setRetryRevision((value)=>value+1)} />;
  return <section className="content-page smart-library">
    <PageHeader eyebrow={t("games.eyebrow")} title={t("games.title")} description={t("games.description",{count:page.total})}/>
    {!search && filter==="all" && sections.map((section)=><LibrarySection key={section.title} title={t(section.title)} games={section.games} open={open} track={track}/>) }
    <section aria-labelledby="all-games-heading"><h2 id="all-games-heading">{t("games.sections.all")}</h2>
      <FilterToolbar><SearchField value={input} onChange={setInput} placeholder={t("games.search")}/>
        <SelectControl value={filter} onChange={(value)=>{setFilter(value as LibraryFilter);setOffset(0)}} label={t("games.filter.label")} options={filterOptions(t)}/>
        <SelectControl value={sort} onChange={(value)=>{setSort(value as LibrarySort);setOffset(0)}} label={t("games.sort.label")} options={sortOptions(t)}/>
      </FilterToolbar>
      {page.games.length?<><div className="library-grid library-density-comfortable" role="list" aria-busy={status==="loading"}>{page.games.map((game)=><GameCard key={game.id} game={toCard(game)} onOpen={open} onViewDetails={open} onViewAchievements={open} onTrackedChange={track}/>)}</div>
        <nav className="library-pagination" aria-label={t("games.pagination")}><button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-PAGE_SIZE))}><ChevronLeft size={16}/>{t("games.previous")}</button><span>{offset+1}–{Math.min(offset+PAGE_SIZE,page.total)} / {page.total}</span><button disabled={offset+PAGE_SIZE>=page.total} onClick={()=>setOffset(offset+PAGE_SIZE)}>{t("games.next")}<ChevronRight size={16}/></button></nav></>
        : <EmptyView compact title={t("games.empty.title")} description={t("games.empty.description")}/>
      }
    </section>
  </section>;
}

function LibrarySection({title,games,open,track}:{title:string;games:Game[];open:(id:GameId)=>void;track:(id:GameId,v:boolean)=>void}){if(!games.length)return null;return <section className="smart-library-section"><h2>{title}</h2><div className="smart-library-strip" role="list">{games.map((g)=><GameCard key={g.id} game={toCard(g)} onOpen={open} onViewDetails={open} onTrackedChange={track}/>)}</div></section>}
function buildSections(games:Game[]){const ranked=games.slice().sort(compareSmartGames).slice(0,20);const used=new Set<string>();const take=(predicate:(g:Game)=>boolean)=>ranked.filter((g)=>!used.has(g.id)&&predicate(g)).slice(0,6).map((g)=>(used.add(g.id),g));return [
  {title:"games.sections.continue",games:take((g)=>!g.tracked&&(Boolean(g.lastOpenedAt)||Boolean(g.lastPlayedAt)))},
  {title:"games.sections.tracked",games:take((g)=>Boolean(g.tracked))},
  {title:"games.sections.recent",games:take((g)=>Boolean(g.lastPlayedAt))},
  {title:"games.sections.progress",games:take((g)=>g.totalAchievements>0&&g.completionPercentage>0&&g.completionPercentage<100)}
]}
function toCard(g:Game):GameCardData{return{id:g.id,platformGameId:g.appId,title:g.name,coverUrl:g.coverUrl,backgroundUrl:g.backgroundUrl,iconUrl:g.iconUrl,platform:g.platform,playtimeMinutes:Math.round(g.playtimeHours*60),unlockedAchievements:g.unlockedAchievements,totalAchievements:g.totalAchievements,completionPercent:g.completionPercentage,lastPlayedAt:g.lastPlayedAt,favorite:Boolean(g.favorite),tracked:Boolean(g.tracked),hidden:Boolean(g.hidden),status:g.status??(g.completionPercentage===100?"completed":g.playtimeHours>0?"playing":"notStarted")}}
const filterOptions=(t:(k:string)=>string)=>[{value:"all",label:t("games.filters.all")},{value:"tracked",label:t("games.filters.tracked")},{value:"recent",label:t("games.filters.recent")},{value:"hasAchievements",label:t("games.filters.hasAchievements")},{value:"noAchievementData",label:t("games.filters.noAchievementData")},{value:"completed",label:t("games.filters.completed")},{value:"incomplete",label:t("games.filters.incomplete")},{value:"hidden",label:t("games.filters.hidden")}];
const sortOptions=(t:(k:string)=>string)=>[{value:"smart",label:t("games.sort.smart")},{value:"recent",label:t("games.sort.recent")},{value:"playtime",label:t("games.sort.playtime")},{value:"completion",label:t("games.sort.completion")},{value:"nameAsc",label:t("games.sort.nameAsc")},{value:"nameDesc",label:t("games.sort.nameDesc")},{value:"synced",label:t("games.sort.synced")},{value:"tracked",label:t("games.sort.tracked")}];
