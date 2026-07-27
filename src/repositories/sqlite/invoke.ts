import { invoke } from "@tauri-apps/api/core";

export class RepositoryError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`${operation}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "RepositoryError";
  }
}
export async function invokeDatabase<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args); }
  catch (error: unknown) { throw new RepositoryError(`Local storage command '${command}' failed`, error); }
}
