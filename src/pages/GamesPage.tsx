import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyView, ErrorView } from "../components/ui/StateViews";
import { FilterToolbar, SearchField, SelectControl } from "../components/ui/FilterBar";
import { PageHeader } from "../components/ui/PageHeader";
import type { Game, GameId } from "../types";
import type { GameCardData } from "../types/gameCard";
import type { LibraryFilter, LibraryPage, LibrarySort } from "../types/library";
import { services, smartSync } from "../services/compositionRoot";
import { GameCard, GameCardSkeleton } from "../components/games/GameCard";
import { useTranslation } from "../i18n/TranslationContext";
import { useLibraryRevision } from "../hooks/useLibraryRevision";
import { compareSmartGames } from "../services/smartLibraryRanking";
import { achievementCompletion, deriveGameCardSyncState } from "../services/gameCardPresentation";

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
  const [, setSyncRevision] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [trackingIds, setTrackingIds] = useState<Set<GameId>>(() => new Set());
  const request = useRef(0);
  const trackingLock = useRef(new Set<GameId>());
  const revision = useLibraryRevision();

  useEffect(() => { const timer=setTimeout(()=>{setSearch(input);setOffset(0)},180); return()=>clearTimeout(timer); }, [input]);
  useEffect(() => { void smartSync.syncLibrary("page-open").catch(()=>undefined); }, []);
  useEffect(() => smartSync.subscribe(() => setSyncRevision((value)=>value+1)), []);
  useEffect(() => { const update=()=>setOnline(navigator.onLine); window.addEventListener("online",update);window.addEventListener("offline",update);return()=>{window.removeEventListener("online",update);window.removeEventListener("offline",update)} }, []);
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
  const track=async(id:GameId,value:boolean)=>{
    if(trackingLock.current.has(id))return;
    trackingLock.current.add(id);
    setTrackingIds((current)=>new Set(current).add(id));
    try{await services.games.track(id,value);setSmart((items)=>items.map((g)=>g.id===id?{...g,tracked:value}:g));setPage((p)=>({...p,games:p.games.map((g)=>g.id===id?{...g,tracked:value}:g)}));requestAnimationFrame(()=>Array.from(document.querySelectorAll<HTMLButtonElement>("[data-track-game-id]")).find((button)=>button.dataset.trackGameId===id)?.focus())}
    catch{return}
    finally{trackingLock.current.delete(id);setTrackingIds((current)=>{const next=new Set(current);next.delete(id);return next})}
  };
  if(status==="loading" && !page.games.length) return <LibrarySkeleton />;
  if(status==="error") return <ErrorView message={t("games.loadError")} onRetry={()=>setRetryRevision((value)=>value+1)} />;
  return <section className="content-page smart-library">
    <PageHeader eyebrow={t("games.eyebrow")} title={t("games.title")} description={t("games.description",{count:page.total})}/>
    {!search && filter==="all" && sections.map((section)=><LibrarySection key={section.title} title={t(section.title)} games={section.games} open={open} track={track} online={online} trackingIds={trackingIds}/>) }
    <section aria-labelledby="all-games-heading"><h2 id="all-games-heading">{t("games.sections.all")}</h2>
      <FilterToolbar><SearchField value={input} onChange={setInput} placeholder={t("games.search")}/>
        <SelectControl value={filter} onChange={(value)=>{setFilter(value as LibraryFilter);setOffset(0)}} label={t("games.filter.label")} options={filterOptions(t)}/>
        <SelectControl value={sort} onChange={(value)=>{setSort(value as LibrarySort);setOffset(0)}} label={t("games.sort.label")} options={sortOptions(t)}/>
      </FilterToolbar>
      {page.games.length?<><div className="library-grid library-density-comfortable" role="list" aria-busy={status==="loading"}>{page.games.map((game)=><GameCard key={game.id} game={toCard(game,online,trackingIds.has(game.id))} onOpen={open} onViewDetails={open} onViewAchievements={open} onTrackedChange={track}/>)}</div>
        <nav className="library-pagination" aria-label={t("games.pagination")}><button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-PAGE_SIZE))}><ChevronLeft size={16}/>{t("games.previous")}</button><span>{offset+1}–{Math.min(offset+PAGE_SIZE,page.total)} / {page.total}</span><button disabled={offset+PAGE_SIZE>=page.total} onClick={()=>setOffset(offset+PAGE_SIZE)}>{t("games.next")}<ChevronRight size={16}/></button></nav></>
        : <EmptyView compact title={t("games.empty.title")} description={t("games.empty.description")}/>
      }
    </section>
  </section>;
}

function LibrarySection({title,games,open,track,online,trackingIds}:{title:string;games:Game[];open:(id:GameId)=>void;track:(id:GameId,v:boolean)=>void|Promise<void>;online:boolean;trackingIds:Set<GameId>}){if(!games.length)return null;return <section className="smart-library-section"><h2>{title}</h2><div className="smart-library-strip" role="list">{games.map((g)=><GameCard key={g.id} game={toCard(g,online,trackingIds.has(g.id))} onOpen={open} onViewDetails={open} onTrackedChange={track}/>)}</div></section>}
function buildSections(games:Game[]){const ranked=games.slice().sort(compareSmartGames).slice(0,20);const used=new Set<string>();const take=(predicate:(g:Game)=>boolean)=>ranked.filter((g)=>!used.has(g.id)&&predicate(g)).slice(0,6).map((g)=>(used.add(g.id),g));return [
  {title:"games.sections.continue",games:take((g)=>!g.tracked&&(Boolean(g.lastOpenedAt)||Boolean(g.lastPlayedAt)))},
  {title:"games.sections.tracked",games:take((g)=>Boolean(g.tracked))},
  {title:"games.sections.recent",games:take((g)=>Boolean(g.lastPlayedAt))},
  {title:"games.sections.progress",games:take((g)=>g.totalAchievements>0&&g.completionPercentage>0&&g.completionPercentage<100)}
]}
function toCard(g:Game,online:boolean,tracking=false):GameCardData{return{id:g.id,platformGameId:g.appId,title:g.name,coverUrl:g.coverUrl,backgroundUrl:g.backgroundUrl,iconUrl:g.iconUrl,platform:g.platform,playtimeMinutes:Math.round(g.playtimeHours*60),unlockedAchievements:g.unlockedAchievements,totalAchievements:g.totalAchievements,completionPercent:g.completionPercentage,achievementCompletion:achievementCompletion(g.unlockedAchievements,g.totalAchievements),syncState:deriveGameCardSyncState(g,smartSync.getStatus(`achievements:${g.id}`),online),lastPlayedAt:g.lastPlayedAt,favorite:Boolean(g.favorite),tracked:Boolean(g.tracked),tracking,hidden:Boolean(g.hidden),status:g.status??(g.completionPercentage===100?"completed":g.playtimeHours>0?"playing":"notStarted")}}
function LibrarySkeleton(){const{t}=useTranslation();return <section className="content-page smart-library" aria-busy="true"><PageHeader eyebrow={t("games.eyebrow")} title={t("games.title")} description={t("state.loading")}/><div className="library-grid library-density-comfortable">{Array.from({length:6},(_,index)=><GameCardSkeleton key={index}/>)}</div></section>}
const filterOptions=(t:(k:string)=>string)=>[{value:"all",label:t("games.filters.all")},{value:"tracked",label:t("games.filters.tracked")},{value:"recent",label:t("games.filters.recent")},{value:"hasAchievements",label:t("games.filters.hasAchievements")},{value:"noAchievementData",label:t("games.filters.noAchievementData")},{value:"completed",label:t("games.filters.completed")},{value:"incomplete",label:t("games.filters.incomplete")},{value:"hidden",label:t("games.filters.hidden")}];
const sortOptions=(t:(k:string)=>string)=>[{value:"smart",label:t("games.sort.smart")},{value:"recent",label:t("games.sort.recent")},{value:"playtime",label:t("games.sort.playtime")},{value:"completion",label:t("games.sort.completion")},{value:"nameAsc",label:t("games.sort.nameAsc")},{value:"nameDesc",label:t("games.sort.nameDesc")},{value:"synced",label:t("games.sort.synced")},{value:"tracked",label:t("games.sort.tracked")}];
