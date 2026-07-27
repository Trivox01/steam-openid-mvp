import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  accent?: "violet" | "cyan" | "amber" | "rose";
}

export function StatCard({ label, value, hint, icon: Icon, accent = "violet" }: StatCardProps) {
  return (
    <motion.article className="stat-card" whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
      <div className={`stat-icon ${accent}`}><Icon size={19} /></div>
      <div>
        <p>{label}</p>
        <div className="stat-value">{value}</div>
        <span>{hint}</span>
      </div>
    </motion.article>
  );
}
