import { ToolError } from "./contracts.ts";
import type { ToolRatingRepository } from "./toolRatingRepository.ts";

export class ToolRatingService {
  readonly repository: ToolRatingRepository;

  constructor(repository: ToolRatingRepository) {
    this.repository = repository;
  }

  summary(toolId: string) {
    return this.repository.summary(toolId);
  }

  summaries(toolIds: string[]) {
    return this.repository.summaries(toolIds);
  }

  async mine(toolId: string, userId: string) {
    return (await this.repository.getMine(toolId, userId))?.rating ?? null;
  }

  async save(toolId: string, userId: string, value: unknown) {
    const rating = parseRating(value);
    try {
      const result = await this.repository.upsert(toolId, userId, rating);
      await this.repository.audit(
        result.previous === undefined ? "tool.rating_created" : "tool.rating_updated",
        userId,
        toolId,
        result.previous === undefined
          ? { new: rating }
          : { previous: result.previous, new: rating }
      ).catch(() => {});
      return { rating };
    } catch (error) {
      await this.repository.audit("tool.rating_denied", userId, toolId).catch(() => {});
      throw error;
    }
  }

  async remove(toolId: string, userId: string) {
    try {
      const previous = await this.repository.remove(toolId, userId);
      await this.repository.audit(
        "tool.rating_removed",
        userId,
        toolId,
        { previous: previous.rating }
      ).catch(() => {});
    } catch (error) {
      await this.repository.audit("tool.rating_denied", userId, toolId).catch(() => {});
      throw error;
    }
  }
}

function parseRating(value: unknown) {
  if (
    value === null ||
    typeof value !== "object" ||
    !("rating" in value) ||
    !Number.isInteger(value.rating) ||
    Number(value.rating) < 1 ||
    Number(value.rating) > 5
  ) throw new ToolError("INVALID_TOOL_RATING");
  return Number(value.rating);
}