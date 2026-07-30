import { Medal } from "lucide-react";
import { useState } from "react";
import type { PublicBadge } from "../../../features/profile/publicBadges/types";

export function PublicBadgeIcon({ badge }: { badge: PublicBadge }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Medal aria-hidden={true} className="public-badge__fallback" />;
  return (
    <img
      src={badge.iconUrl}
      alt=""
      width={22}
      height={22}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
