import { useEffect, useState } from "react";
import { Package } from "lucide-react";

export function ToolImage({ src, className, eager = false }: { src?: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <Package className={className} aria-hidden="true" />;
  return <img className={className} src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} onError={() => setFailed(true)} />;
}
