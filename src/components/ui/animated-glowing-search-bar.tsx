import { useId } from "react";

export type AnimatedGlowingSearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onFilterClick?: () => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
};

const mergeClassNames = (...values: Array<string | undefined | false>) =>
  values.filter(Boolean).join(" ");

export function AnimatedGlowingSearchBar({
  value,
  onChange,
  placeholder = "Search...",
  onFilterClick,
  ariaLabel = "Search",
  className,
  disabled = false
}: AnimatedGlowingSearchBarProps) {
  const instanceId = useId().replace(/:/g, "");
  const searchGradientId = `search-gradient-${instanceId}`;
  const filterGradientId = `filter-gradient-${instanceId}`;

  return (
    <div className={mergeClassNames("glowing-search", disabled && "is-disabled", className)}>
      <span className="glowing-search__aura" aria-hidden="true" />
      <div className="glowing-search__surface">
        <svg className="glowing-search__search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id={searchGradientId} x1="3" y1="3" x2="21" y2="21">
              <stop stopColor="#c4b5fd" />
              <stop offset="1" stopColor="#7c3aed" />
            </linearGradient>
          </defs>
          <circle cx="10.7" cy="10.7" r="6.4" fill="none" stroke={`url(#${searchGradientId})`} strokeWidth="1.8" />
          <path d="m15.5 15.5 4.2 4.2" fill="none" stroke={`url(#${searchGradientId})`} strokeLinecap="round" strokeWidth="1.8" />
        </svg>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
        {onFilterClick && (
          <button type="button" className="glowing-search__filter" onClick={onFilterClick} aria-label="Open search filters" disabled={disabled}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <defs>
                <linearGradient id={filterGradientId} x1="4" y1="4" x2="20" y2="20">
                  <stop stopColor="#ddd6fe" />
                  <stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
              <path d="M5 7h14M8 12h8m-5 5h2" fill="none" stroke={`url(#${filterGradientId})`} strokeLinecap="round" strokeWidth="1.8" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
