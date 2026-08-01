import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

export function PlaceholderPage({ title, description, icon: Icon }: { title: string; description: string; icon: LucideIcon }) {
  return (
    <motion.section className="placeholder-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="placeholder-icon"><Icon size={26} /></div>
      <h1 className="nexus-display-title">{title}</h1>
      <p>{description}</p>
      <div className="placeholder-panel">
        <span>More is on the way</span>
        <strong>This area is coming soon.</strong>
      </div>
    </motion.section>
  );
}
