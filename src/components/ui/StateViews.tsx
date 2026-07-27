import { AlertTriangle, Inbox, RotateCcw } from "lucide-react";

export function LoadingView() {
  return (
    <div className="dashboard-grid animate-pulse" aria-label="Loading dashboard">
      <div className="skeleton hero-skeleton" />
      <div className="skeleton metric-skeleton" />
      <div className="skeleton metric-skeleton" />
      <div className="skeleton panel-skeleton" />
      <div className="skeleton panel-skeleton" />
    </div>
  );
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
