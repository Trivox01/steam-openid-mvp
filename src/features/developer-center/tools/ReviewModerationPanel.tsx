import { useCallback, useEffect, useState } from "react";
import { Eye, Flag, MessageSquareText, RotateCcw, Trash } from "lucide-react";
import { Surface } from "../../../components/ui/Surface";
import { useTranslation } from "../../../i18n/TranslationContext";
import type { ToolClient } from "../../tools/ToolClient";
import type { ToolReviewStatus, ToolReviewAdminView } from "../../tools/types";
import { ReplyReviewModal } from "./ReplyReviewModal";
type Filter = "all" | ToolReviewStatus | "reported";

export function ReviewModerationPanel({ client, onOpenReports, canOpenReports, canReply }: { client?: ToolClient; onOpenReports: () => void; canOpenReports: boolean; canReply: boolean }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<ToolReviewAdminView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ToolReviewAdminView>();
  const pageSize = 25;
  const load = useCallback(async () => {
    if (!client) return;
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (filter !== "all") params.set("status", filter);
      if (filter === "reported") params.set("reported", "true");
      const result = await client.adminReviews(params);
      setItems(result.items);
      setTotal(result.total);
      setError(false);
    } catch { setError(true); }
  }, [client, filter, page]);
  useEffect(() => { void load(); }, [load]);
  if (!client) return <Surface className="badge-state">{t("developer.toolReviews.error")}</Surface>;
  const moderate = async (id: string, action: "hide" | "restore" | "remove") => {
    if (!client) return;
    if (action !== "restore" && !window.confirm(t(`developer.toolReviews.confirm.${action}`))) return;
    setBusyId(id);
    setError(false);
    try {
      await client.moderateReview(id, action, action === "remove" ? t("developer.toolReviews.reasonRemoved") : undefined);
      await load();
    } catch { setError(true); }
    finally { setBusyId(""); }
  };
  return (
    <section className="tool-admin review-admin">
      <header>
        <h2 className="nexus-display-title">{t("developer.section.toolReviews")}</h2>
      </header>
      <div className="review-admin-toolbar">
        <div className="segmented" role="group" aria-label={t("developer.toolReviews.filterLabel")}>
          {(["all", "active", "hidden", "removed", "reported"] as Filter[]).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); }}>{t(`developer.toolReviews.filter.${value}`)}</button>
          ))}
        </div>
        {canOpenReports && <button className="secondary-button" type="button" onClick={onOpenReports}><Flag size={16} aria-hidden="true" />{t("developer.toolReviews.openReports")}</button>}
      </div>
      {error && <p role="alert">{t("developer.toolReviews.error")}</p>}
      {!items.length ? <p className="review-empty">{t("developer.toolReviews.empty")}</p> : (
        <div className="review-admin-table" role="table" aria-label={t("developer.section.toolReviews")}>
          <div className="review-admin-row review-admin-row--head" role="row">
            <span role="columnheader">{t("developer.toolReviews.tool")}</span>
            <span role="columnheader">{t("developer.toolReviews.author")}</span>
            <span role="columnheader">{t("developer.toolReviews.status")}</span>
            <span role="columnheader">{t("developer.toolReviews.reports")}</span>
            <span role="columnheader">{t("developer.toolReviews.created")}</span>
            <span role="columnheader" />
          </div>
          {items.map((item) => (
            <div className="review-admin-row" role="row" key={item.id}>
              <span role="cell"><strong dir="auto">{item.tool.name}</strong><small dir="ltr">{item.tool.slug}</small></span>
              <span role="cell"><span dir="auto" className="review-admin-row__author">{item.displayName}</span><small>{item.rating === null ? "—" : `${item.rating}/5`}</small></span>
              <span role="cell"><em className={`review-status review-status--${item.status}`}>{t(`developer.toolReviews.status.${item.status}`)}</em></span>
              <span role="cell">{item.reportsCount}</span>
              <span role="cell"><time dateTime={item.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(item.createdAt))}</time></span>
              <span role="cell" className="review-admin-row__actions">
                {item.status === "active" && <button type="button" disabled={Boolean(busyId)} onClick={() => void moderate(item.id, "hide")} aria-label={t("developer.toolReviews.hide")}><Eye /></button>}
                {item.status === "hidden" && <button type="button" disabled={Boolean(busyId)} onClick={() => void moderate(item.id, "restore")} aria-label={t("developer.toolReviews.restore")}><RotateCcw /></button>}
                {item.status === "hidden" && <button type="button" disabled={Boolean(busyId)} onClick={() => void moderate(item.id, "remove")} aria-label={t("developer.toolReviews.remove")}><Trash /></button>}
                {canReply && item.status === "active" && <button type="button" className={item.developerReply ? "reply-exists" : ""} disabled={Boolean(busyId)} onClick={() => setReplyTarget(item)} aria-label={item.developerReply ? t("review.replyEdit") : t("review.reply")}><MessageSquareText /></button>}
              </span>
            </div>
          ))}
        </div>
      )}
      <nav className="review-pagination" aria-label={t("review.pagination")}>
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("review.previous")}</button>
        <span>{t("review.pageOf", { page, total: Math.max(1, Math.ceil(total / pageSize)) })}</span>
        <button type="button" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage(page + 1)}>{t("review.next")}</button>
      </nav>
      {replyTarget && <ReplyReviewModal client={client} review={replyTarget} onClose={() => setReplyTarget(undefined)} onSaved={() => void load()} />}
    </section>
  );
}