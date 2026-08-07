import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, X } from "lucide-react";
import { Surface } from "../../../components/ui/Surface";
import { useTranslation } from "../../../i18n/TranslationContext";
import type { ToolClient } from "../../tools/ToolClient";
import type { ToolReviewReportView } from "../../tools/types";
type Filter = "open" | "resolved" | "dismissed";

export function ReviewReportsPanel({ client, onBack }: { client?: ToolClient; onBack: () => void }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("open");
  const [items, setItems] = useState<ToolReviewReportView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState(false);
  const pageSize = 25;
  const load = useCallback(async () => {
    if (!client) return;
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status: filter });
      const result = await client.adminReports(params);
      setItems(result.items);
      setTotal(result.total);
      setError(false);
    } catch { setError(true); }
  }, [client, filter, page]);
  useEffect(() => { void load(); }, [load]);
  if (!client) return <Surface className="badge-state">{t("developer.toolReviews.error")}</Surface>;
  const act = async (id: string, action: "resolve" | "dismiss") => {
    if (!client) return;
    setBusyId(id);
    setError(false);
    try {
      if (action === "resolve") await client.resolveReport(id);
      else await client.dismissReport(id);
      await load();
    } catch { setError(true); }
    finally { setBusyId(""); }
  };
  return (
    <section className="tool-admin report-admin">
      <header className="report-admin__head">
        <button className="back-button" type="button" onClick={onBack}><ArrowLeft />{t("developer.toolReports.back")}</button>
        <h2 className="nexus-display-title">{t("developer.section.toolReviewReports")}</h2>
      </header>
      <div className="segmented" role="group" aria-label={t("developer.toolReports.filterLabel")}>
        {(["open", "resolved", "dismissed"] as Filter[]).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); }}>{t(`developer.toolReports.filter.${value}`)}</button>
        ))}
      </div>
      {error && <p role="alert">{t("developer.toolReviews.error")}</p>}
      {!items.length ? <p className="review-empty">{t("developer.toolReports.empty")}</p> : (
        <ul className="report-list">
          {items.map((item) => (
            <li className="report-card" key={item.id}>
              <div className="report-card__meta">
                <span><strong>{t("developer.toolReports.reason")}:</strong> {t(`review.reason.${item.reason}`)}</span>
                <em className={`report-status report-status--${item.status}`}>{t(`developer.toolReports.status.${item.status}`)}</em>
                <time dateTime={item.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</time>
              </div>
              {item.details && <p dir="auto" className="report-card__details">{item.details}</p>}
              <div className="report-card__review">
                <span dir="auto">{item.tool.name}</span>
                <span dir="auto">{item.review.authorName}</span>
                {item.review.title && <strong dir="auto">{item.review.title}</strong>}
                <p dir="auto">{item.review.body}</p>
              </div>
              {item.status === "open" && (
                <footer className="report-card__actions">
                  <button type="button" className="secondary-button" disabled={Boolean(busyId)} onClick={() => void act(item.id, "dismiss")}><X aria-hidden="true" />{t("developer.toolReports.dismiss")}</button>
                  <button type="button" className="primary-button" disabled={Boolean(busyId)} onClick={() => void act(item.id, "resolve")}><Check aria-hidden="true" />{t("developer.toolReports.resolve")}</button>
                </footer>
              )}
            </li>
          ))}
        </ul>
      )}
      <nav className="review-pagination" aria-label={t("review.pagination")}>
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("review.previous")}</button>
        <span>{t("review.pageOf", { page, total: Math.max(1, Math.ceil(total / pageSize)) })}</span>
        <button type="button" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage(page + 1)}>{t("review.next")}</button>
      </nav>
    </section>
  );
}