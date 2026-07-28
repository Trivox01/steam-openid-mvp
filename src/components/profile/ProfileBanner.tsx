import { useEffect, useState } from "react";

export function ProfileBanner({ src }: { src?: string }) {
  const [failed, setFailed] = useState(!src);

  useEffect(() => {
    setFailed(!src);
  }, [src]);

  return (
    <div className={`profile-card__banner ${failed ? "profile-card__banner--fallback" : ""}`}>
      {!failed && src && (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      )}
    </div>
  );
}
