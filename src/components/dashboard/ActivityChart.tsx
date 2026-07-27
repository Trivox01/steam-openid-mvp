import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { ActivityPoint } from "../../types";

export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  return (
    <div className="chart-wrap" aria-label="Weekly play activity chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.46} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "currentColor", fontSize: 11 }} dy={8} />
          <Tooltip contentStyle={{ border: "1px solid var(--border)", background: "var(--panel-solid)", borderRadius: 12, fontSize: 12 }} formatter={(value) => [`${value}h`, "Played"]} />
          <Area type="monotone" dataKey="hours" stroke="#8b5cf6" strokeWidth={3} fill="url(#activityFill)" activeDot={{ r: 5, fill: "#a78bfa", strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
