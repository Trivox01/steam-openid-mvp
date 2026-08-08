export interface SessionSummaryQueueItem {
  sessionId: string;
  endedAtMs: number;
}

export function mergeUnseenSummaries<T extends SessionSummaryQueueItem>(
  current: T[],
  incoming: T[],
  limit = 6
): T[] {
  const byId = new Map(current.map((summary) => [summary.sessionId, summary]));
  for (const summary of incoming) byId.set(summary.sessionId, summary);
  return [...byId.values()]
    .sort((left, right) => right.endedAtMs - left.endedAtMs)
    .slice(0, Math.max(1, limit));
}
