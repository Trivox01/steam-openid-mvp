import type { ReactNode } from "react";

/**
 * Platform identity as icons instead of a repeated text label.
 *
 * One rule, and it is a data rule rather than a design rule: a glyph may only
 * appear when the app can actually prove that platform for this game. The
 * library is read from Steam and the client runs on the Windows desktop, so PC
 * and Steam are provable. Console platforms are deliberately absent, because
 * nothing in this app's data model can prove them and a platform icon with no
 * data behind it is invented metadata, not decoration. The day such data exists,
 * it is one entry in the two maps below.
 *
 * The glyphs are our own geometry painted with currentColor, so no third-party
 * brand file is bundled and the icons stay white on dark and dark on light
 * instead of hard-coding white.
 *
 * The strip is information, not a control: it is not focusable and carries no
 * action, but each glyph is an image with a real accessible name, so an
 * icon-only row is still readable by assistive technology.
 */
export type PlatformKey = "pc" | "steam";

const LABELS: Record<PlatformKey, string> = { pc: "PC", steam: "Steam" };

const GLYPHS: Record<PlatformKey, ReactNode> = {
  pc: (
    <path
      fill="currentColor"
      d="M2 3.4 7.3 2.6v5.1H2V3.4Zm6.7-.9L14 1.6v6.1H8.7V2.5ZM2 8.9h5.3V14l-5.3-.8V8.9Zm6.7 0H14v6.5l-5.3-.8V8.9Z"
    />
  ),
  steam: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="8" cy="8" r="6.2" />
      <circle cx="10.2" cy="6" r="2" />
      <path d="M6.7 9.3 8.7 7.4" />
      <circle cx="5.5" cy="10.5" r="1.5" fill="currentColor" stroke="none" />
    </g>
  )
};

export function PlatformStrip({ platforms, size = 13 }: { platforms: PlatformKey[]; size?: number }) {
  if (platforms.length === 0) return null;
  return (
    <span className="gd-platforms">
      {platforms.map((platform) => (
        <span
          key={platform}
          className="gd-platform"
          role="img"
          aria-label={LABELS[platform]}
          title={LABELS[platform]}
        >
          <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
            {GLYPHS[platform]}
          </svg>
        </span>
      ))}
    </span>
  );
}
