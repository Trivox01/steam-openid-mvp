import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { UserProfileSummary } from "../../features/profile/types";
import { useTranslation } from "../../i18n/TranslationContext";
import { ProfileCard } from "./ProfileCard";
import { ProfileCardSkeleton } from "./ProfileCardSkeleton";

export function ProfileCardTrigger({
  children,
  loadSummary,
  onAction
}: {
  children: ReactNode;
  loadSummary: () => Promise<UserProfileSummary | undefined>;
  onAction?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<UserProfileSummary>();
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);

  const closeCard = () => {
    requestGeneration.current += 1;
    setOpen(false);
    setStatus("idle");
    triggerRef.current?.focus();
  };

  const requestOpen = async () => {
    if (status === "loading") return;
    const generation = ++requestGeneration.current;
    setOpen(true);
    setStatus("loading");
    try {
      const loaded = await loadSummary();
      if (generation !== requestGeneration.current) return;
      if (!loaded) {
        closeCard();
        return;
      }
      setSummary(loaded);
      setStatus("ready");
    } catch {
      if (generation === requestGeneration.current) setStatus("error");
    }
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !cardRef.current?.contains(target)) {
        closeCard();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCard();
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
        aria-busy={status === "loading"}
        aria-label={t("profile.openCard")}
        onClick={() => {
          if (status === "loading") return;
          if (open) closeCard();
          else void requestOpen();
        }}
      >
        {children}
      </button>
      {open && createPortal(
        <div ref={cardRef} className="profile-card-popover" role="dialog" aria-modal="false" aria-label={t("profile.cardLabel")} tabIndex={-1}>
          {status === "loading" && <ProfileCardSkeleton />}
          {status === "error" && (
            <div className="profile-card__error" role="alert">
              <p>{t("profile.loadError")}</p>
              <button type="button" onClick={() => void requestOpen()}>{t("state.retry")}</button>
            </div>
          )}
          {status === "ready" && summary && <ProfileCard summary={summary} onAction={onAction ? () => { setOpen(false); onAction(); } : undefined} />}
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
