import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { UserProfileSummary } from "../../features/profile/types";
import { useTranslation } from "../../i18n/TranslationContext";
import { ProfileCard } from "./ProfileCard";
import { ProfileCardSkeleton } from "./ProfileCardSkeleton";
import type { PublicBadgeClient } from "../../features/profile/publicBadges/PublicBadgeClient";

export function ProfileCardTrigger({
  children,
  loadSummary,
  onAction,
  publicBadgeClient
}: {
  children: ReactNode;
  loadSummary: () => Promise<UserProfileSummary | undefined>;
  onAction?: () => void;
  publicBadgeClient?: PublicBadgeClient;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<UserProfileSummary>();
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const requestOpen = async () => {
    setOpen(true);
    setStatus("loading");
    try {
      const loaded = await loadSummary();
      if (!loaded) {
        setOpen(false);
        setStatus("idle");
        triggerRef.current?.focus();
        return;
      }
      setSummary(loaded);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !cardRef.current?.contains(target)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
      if (event.key === "Tab" && cardRef.current) trapFocus(event, cardRef.current);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && status !== "loading") {
      cardRef.current?.focus();
    }
  }, [open, status]);

  return (
    <div className="profile-card-trigger" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="profile-card-trigger__button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("profile.openCard")}
        onClick={() => open ? setOpen(false) : void requestOpen()}
      >
        {children}
      </button>
      {open && createPortal(
        <div ref={cardRef} className="profile-card-popover" role="dialog" aria-modal="false" aria-label={t("profile.cardLabel")} tabIndex={-1}>
          {status === "loading" && <ProfileCardSkeleton />}
          {status === "error" && (
            <div className="profile-card__error" role="alert">
              <p>{t("profile.loadError")}</p>
              <button type="button" onClick={() => void requestOpen()}>{t("common.retry")}</button>
            </div>
          )}
          {status === "ready" && summary && <ProfileCard summary={summary} publicBadgeClient={publicBadgeClient} onAction={onAction ? () => { setOpen(false); onAction(); } : undefined} />}
        </div>
      , document.body)}
    </div>
  );
}

function trapFocus(event: KeyboardEvent, root: HTMLElement) {
  const elements = [...root.querySelectorAll<HTMLElement>("button,[href],[tabindex='0']")].filter((element) => !element.hasAttribute("disabled"));
  if (!elements.length) return;
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
