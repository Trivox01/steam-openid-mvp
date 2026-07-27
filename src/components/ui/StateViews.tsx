import { AlertTriangle, Inbox, RotateCcw } from "lucide-react";
import { HoloPulseLoader, type HoloPulseLoaderProps } from "./holo-pulse-loader";

type LoadingViewProps = Pick<HoloPulseLoaderProps, "fullScreen" | "size" | "className" | "showDots" | "delay"> & {
  label?: string;
  message?: string;
};

export function LoadingView({ label, message, ...props }: LoadingViewProps) {
  return <HoloPulseLoader label={label ?? message ?? "Loading"} {...props} />;
}

export function EmptyView({ title = "Your library is ready", description = "Connect a platform when integrations become available.", compact = false }: { title?: string; description?: string; compact?: boolean }) {
  return <div className={`state-view ${compact ? "compact" : ""}`}><Inbox /><h2>{title}</h2><p>{description}</p></div>;
}

export function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state-view error-state">
      <AlertTriangle />
      <h2>Something went wrong</h2>
      <p>{message}</p>
      <button className="primary-button" onClick={onRetry}><RotateCcw size={16} /> Try again</button>
    </div>
  );
}
