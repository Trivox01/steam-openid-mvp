import { useEffect, useState } from "react";

export function ProfileAvatar({
  src,
  name,
  className
}: {
  src?: string;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(!src);

  useEffect(() => {
    setFailed(!src);
  }, [src]);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

  return (
    <span className={`profile-avatar ${className ?? ""}`} aria-label={`${name} avatar`}>
      {!failed && src ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}
