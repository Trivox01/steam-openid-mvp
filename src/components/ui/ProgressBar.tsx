type ProgressBarProps = {
  value: number;
  label: string;
  showValue?: boolean;
  className?: string;
};

export function ProgressBar({ value, label, showValue = false, className }: ProgressBarProps) {
  const normalized = Math.min(100, Math.max(0, value));
  return (
    <div className={["ds-progress", className].filter(Boolean).join(" ")}>
      <div className="ds-progress__meta">
        <span>{label}</span>
        {showValue && <span>{Math.round(normalized)}%</span>}
      </div>
      <div
        className="ds-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(normalized)}
      >
        <span className="ds-progress__fill" style={{ inlineSize: `${normalized}%` }} />
      </div>
    </div>
  );
}
