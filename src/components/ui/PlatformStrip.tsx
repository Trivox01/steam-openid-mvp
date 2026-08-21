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
 * it is one entry in the two maps below and nothing else has to change.
 *
 * The glyphs are our own geometry painted with currentColor, so no third-party
 * brand file is bundled and the icons stay light on dark and dark on light
 * instead of hard-coding white.
 *
 * Both marks are filled silhouettes on the same 16 unit grid, and that is a
 * readability decision taken at runtime size rather than a style preference: a
 * 1.4px outline at 16px collapses into a grey smudge, while a filled shape keeps
 * its identity through Windows display scaling.
 *
 * Steam is the round mark with the valve carved out of it, where the negative
 * space carries the identity and no detail is thinner than a pixel. That
 * geometry has been reviewed in the real app and is deliberately frozen.
 *
 * PC is a desktop monitor - screen, neck, base - because this glyph has to say
 * computer rather than name an operating system. It is three solid subpaths and
 * not a thin bezel: at 16px a 1.5px bezel fails exactly the way an outline does,
 * and it is the filled slab standing on its base that makes the silhouette read
 * as a monitor at that size. Ink is about 116 square units against Steam's 123
 * of the 256 unit box; the monitor is the lighter of the two on purpose, because
 * a rectangle reads heavier than a disc of equal area.
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
      d="M1.8 2.4h12.4v8.2h-12.4ZM6.8 10.6h2.4v1.6h-2.4ZM4.4 12.2h7.2v1.5h-7.2Z"
    />
  ),
  steam: (
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M8 1a7 7 0 1 0 0 14a7 7 0 1 0 0 -14ZM10.2 3.4a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 1 0 0 -4.8ZM10.2 4.85a0.95 0.95 0 1 0 0 1.9a0.95 0.95 0 1 0 0 -1.9ZM8.66 8.15L6.83 11.76A1.91 1.91 0 0 1 4.17 9.04L7.82 7.29Z"
    />
  )
};

export function PlatformStrip({ platforms, size = 16 }: { platforms: PlatformKey[]; size?: number }) {
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
