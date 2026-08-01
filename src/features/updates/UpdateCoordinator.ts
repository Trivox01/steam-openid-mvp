import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { isTauriRuntime } from "../../runtime/environment";

export type UpdateSource = "automatic" | "settings" | "tray";
export type UpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "installing" | "offline" | "unavailable" | "error";
export type UpdateSnapshot = { status: UpdateStatus; source?: UpdateSource; version?: string; notes?: string; progress?: number; message?: string };

class UpdateCoordinator {
  private snapshot: UpdateSnapshot = { status: "idle" };
  private listeners = new Set<(snapshot: UpdateSnapshot) => void>();
  private pending?: Promise<void>;
  private update?: Update;

  subscribe = (listener: (snapshot: UpdateSnapshot) => void) => { this.listeners.add(listener); listener(this.snapshot); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;

  check(source: UpdateSource) {
    if (this.pending) return this.pending;
    this.pending = this.runCheck(source).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async runCheck(source: UpdateSource) {
    if (!isTauriRuntime()) { this.set({ status: "unavailable", source }); return; }
    this.set({ status: "checking", source });
    try {
      this.update = await check({ timeout: 10_000, allowDowngrades: false }) ?? undefined;
      if (!this.update) this.set({ status: "up-to-date", source });
      else this.set({ status: "available", source, version: this.update.version, notes: this.update.body });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const offline = /network|offline|dns|connect|timed?\s*out/i.test(message);
      this.set({ status: offline ? "offline" : "unavailable", source });
    }
  }

  async downloadAndInstall() {
    if (!this.update || this.pending) return;
    const update = this.update;
    let downloaded = 0;
    let total: number | undefined;
    this.pending = (async () => {
      try {
        this.set({ ...this.snapshot, status: "downloading", progress: 0 });
        await update.download((event: DownloadEvent) => {
          if (event.event === "Started") total = event.data.contentLength;
          if (event.event === "Progress") downloaded += event.data.chunkLength;
          this.set({ ...this.snapshot, status: "downloading", progress: total ? Math.min(100, Math.round(downloaded / total * 100)) : undefined });
        }, { timeout: 120_000 });
        this.set({ ...this.snapshot, status: "ready", progress: 100 });
        this.set({ ...this.snapshot, status: "installing" });
        await update.install();
      } catch {
        this.set({ ...this.snapshot, status: "error" });
      }
    })().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  later() { if (this.snapshot.status === "available") this.set({ status: "idle" }); }
  private set(snapshot: UpdateSnapshot) { this.snapshot = snapshot; for (const listener of this.listeners) listener(snapshot); }
}

export const updateCoordinator = new UpdateCoordinator();
