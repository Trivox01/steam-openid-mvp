import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Position = { left: number; top: number; ready: boolean };

export function BadgeTooltip({
  label,
  content,
  children
}: {
  label: string;
  content: ReactNode;
  children: ReactNode;
}) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ left: 0, top: 0, ready: false });

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;
      setPosition(placeTooltip(trigger, tooltip));
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        className="profile-badge"
        tabIndex={0}
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {children}
      </span>
      {open && createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          className="profile-badge-tooltip-portal"
          role="tooltip"
          style={{ left: position.left, top: position.top, visibility: position.ready ? "visible" : "hidden" }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}

function placeTooltip(trigger: HTMLElement, tooltip: HTMLElement): Position {
  const padding = 12;
  const offset = 8;
  const anchor = trigger.getBoundingClientRect();
  const card = trigger.closest(".profile-card-popover")?.getBoundingClientRect() ?? anchor;
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  const centeredLeft = clamp(anchor.left + anchor.width / 2 - width / 2, padding, window.innerWidth - width - padding);
  const topOutside = card.top - height - offset;
  if (topOutside >= padding) return { left: centeredLeft, top: topOutside, ready: true };

  const rightOutside = card.right + offset;
  if (rightOutside + width <= window.innerWidth - padding) {
    return { left: rightOutside, top: clamp(anchor.top + anchor.height / 2 - height / 2, padding, window.innerHeight - height - padding), ready: true };
  }

  const leftOutside = card.left - width - offset;
  if (leftOutside >= padding) {
    return { left: leftOutside, top: clamp(anchor.top + anchor.height / 2 - height / 2, padding, window.innerHeight - height - padding), ready: true };
  }

  const bottomOutside = card.bottom + offset;
  if (bottomOutside + height <= window.innerHeight - padding) {
    return { left: centeredLeft, top: bottomOutside, ready: true };
  }

  return {
    left: centeredLeft,
    top: clamp(anchor.bottom + offset, padding, window.innerHeight - height - padding),
    ready: true
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
