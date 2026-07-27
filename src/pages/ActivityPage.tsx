import { useMemo, useState, type ComponentType } from "react";
import { CheckCircle2, Flag, Gamepad2, Medal, TrendingUp } from "lucide-react";
import { mockActivities, mockGames } from "../data/mockData";
import { EmptyView } from "../components/ui/StateViews";
import { FilterToolbar, SegmentedFilter } from "../components/ui/FilterBar";
import { PageHeader } from "../components/ui/PageHeader";
import type { ActivityType, PlayerActivity } from "../types";

type ActivityFilter = "all" | ActivityType;
const activityMeta: Record<ActivityType, { label: string; icon: ComponentType<{ size?: number }>; tone: string }> = {
  achievement: { label: "Achievement", icon: Medal, tone: "violet" },
  new_game: { label: "New game", icon: Gamepad2, tone: "cyan" },
  completed_game: { label: "Completed", icon: CheckCircle2, tone: "green" },
  progress: { label: "Progress", icon: TrendingUp, tone: "amber" },
  weekly_goal: { label: "Weekly goal", icon: Flag, tone: "rose" }
};

export function ActivityPage() {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const activities = useMemo(() => mockActivities.filter((item) => filter === "all" || item.type === filter), [filter]);
  const groups = groupActivities(activities);
  return (
    <section className="content-page">
      <PageHeader eyebrow="PLAYER HISTORY" title="Activity" description="A timeline of milestones and progress across your library." />
      <FilterToolbar><SegmentedFilter value={filter} onChange={setFilter} options={[
        { value: "all", label: "All activity" }, ...Object.entries(activityMeta).map(([value, meta]) => ({ value: value as ActivityType, label: meta.label }))
      ]} /></FilterToolbar>
      {groups.length ? <div className="timeline">{groups.map(([day, items]) => <section className="timeline-day" key={day}><h2>{day}</h2><div>{items.map((item) => <TimelineItem key={item.id} item={item} />)}</div></section>)}</div> :
        <EmptyView compact title="No activity here" description="Choose another activity type to see your recent milestones." />}
    </section>
  );
}

function TimelineItem({ item }: { item: PlayerActivity }) {
  const meta = activityMeta[item.type]; const Icon = meta.icon; const game = mockGames.find((entry) => entry.id === item.gameId);
  return <article className="timeline-item"><div className={`timeline-icon ${meta.tone}`}><Icon size={17} /></div><div className="timeline-copy"><span>{meta.label}{game ? ` · ${game.name}` : ""}</span><h3>{item.title}</h3><p>{item.description}</p></div><div className="timeline-side"><time>{new Date(item.occurredAt).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}</time>{item.metadata && <strong>{item.metadata}</strong>}</div></article>;
}

function groupActivities(items: PlayerActivity[]): [string, PlayerActivity[]][] {
  const groups = new Map<string, PlayerActivity[]>();
  items.forEach((item) => {
    const date = new Date(item.occurredAt);
    const key = date.toDateString() === new Date("2026-07-27").toDateString() ? "Today" : date.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" });
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return [...groups.entries()];
}
