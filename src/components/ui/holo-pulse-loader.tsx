import { useEffect, useState } from "react";
import { PlusIcon } from "lucide-react";

export type HoloPulseLoaderProps = {
  label?: string;
  fullScreen?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  showDots?: boolean;
  delay?: number;
};

const mergeClassNames = (...values: Array<string | false | undefined>) =>
  values.filter(Boolean).join(" ");

export function HoloPulseLoader({
  label = "Loading",
  fullScreen = false,
  size = "md",
  className,
  showDots = true,
  delay = 0
}: HoloPulseLoaderProps) {
  const [visible, setVisible] = useState(delay <= 0);
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    if (delay <= 0) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const timeout = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timeout);
  }, [delay]);

  useEffect(() => {
    if (!showDots || !visible) return;
    const interval = window.setInterval(() => {
      setDotCount((current) => current % 3 + 1);
    }, 400);
    return () => window.clearInterval(interval);
  }, [showDots, visible]);

  if (!visible) return null;

  return (
    <div
      className={mergeClassNames(
        "holo-loader",
        `holo-loader--${size}`,
        fullScreen && "holo-loader--fullscreen",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="holo-loader__orb" aria-hidden="true">
        <span className="holo-loader__glow animate-pulse motion-reduce:animate-none" />
        <span className="holo-loader__ring holo-loader__ring--outer" />
        <span className="holo-loader__ring holo-loader__ring--inner" />
        <span className="holo-loader__axis-dots">
          <i /><i /><i /><i />
        </span>
        <span className="holo-loader__core"><PlusIcon /></span>
      </div>
      <span className="holo-loader__label">
        {label}
        {showDots && <span className="holo-loader__dots" aria-hidden="true">{".".repeat(dotCount)}</span>}
      </span>
    </div>
  );
}
