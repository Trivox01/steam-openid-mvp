import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthorizationRepository } from "../src/authorization/authorizationRepository.ts";
import { InMemoryBadgeRepository } from "../src/badges/badgeRepository.ts";
import { BadgeService } from "../src/badges/badgeService.ts";
import { InMemoryBadgeAssignmentRepository } from "../src/badgeAssignments/badgeAssignmentRepository.ts";
import {
  BadgeAssignmentService,
  parseAssignmentQuery
} from "../src/badgeAssignments/badgeAssignmentService.ts";

const now = Date.parse("2026-07-30T12:00:00.000Z");
const baseDraft = {
  slug: "founder",
  displayName: "Founder",
  description: "Founding member.",
  category: "special",
  rarity: "exclusive",
  priority: 100,
  isActive: true,
  isVisible: true,
  grantMode: "manual"
} as const;

async function setup() {
  const authorization = new InMemoryAuthorizationRepository();
  const actor = await authorization.ensureAuthenticatedUser(
    "76561198000000001",
    new Date(now).toISOString()
  );
  const user = await authorization.ensureAuthenticatedUser(
    "76561198000000002",
    new Date(now).toISOString()
  );
  const badgeRepository = new InMemoryBadgeRepository();
  const badges = new BadgeService(badgeRepository);
  const badge = await badges.create(baseDraft, actor.id);
  const repository = new InMemoryBadgeAssignmentRepository(
    authorization,
    badgeRepository
  );
  const service = new BadgeAssignmentService(repository, () => now);
  return { authorization, actor, user, badges, badge, repository, service };
}

test("assign, list, revoke, and reassign preserve immutable history", async () => {
  const context = await setup();
  const first = await context.service.assign({
    userId: context.user.id,
    badgeDefinitionId: context.badge.id,
    reason: "  verified contribution  "
  }, context.actor.id);
  assert.equal(first.assignmentReason, "verified contribution");
  assert.equal(await context.service.hasActive(context.user.id, context.badge.id), true);
  assert.equal((await context.service.list(parseAssignmentQuery(
    new URLSearchParams(`userId=${context.user.id}&status=active`)
  ))).total, 1);
  await assert.rejects(
    context.service.assign({
      userId: context.user.id,
      badgeDefinitionId: context.badge.id
    }, context.actor.id),
    /BADGE_ALREADY_ASSIGNED/
  );
  const revoked = await context.service.revoke(
    first.id,
    { reason: "Policy change" },
    context.actor.id
  );
  assert.ok(revoked.revokedAt);
  await assert.rejects(
    context.service.revoke(first.id, {}, context.actor.id),
    /BADGE_ASSIGNMENT_ALREADY_REVOKED/
  );
  const second = await context.service.assign({
    userId: context.user.id,
    badgeDefinitionId: context.badge.id
  }, context.actor.id);
  assert.notEqual(second.id, first.id);
  assert.equal(context.repository.assignments.size, 2);
  assert.deepEqual(
    context.authorization.auditEvents
      .filter((event) => event.action.startsWith("badge.assignment"))
      .map((event) => event.action),
    [
      "badge.assignment_created",
      "badge.assignment_revoked",
      "badge.assignment_created"
    ]
  );
});

test("assignment eligibility rejects missing users and unavailable badges", async () => {
  const context = await setup();
  await assert.rejects(context.service.assign({
    userId: "00000000-0000-4000-8000-000000000099",
    badgeDefinitionId: context.badge.id
  }, context.actor.id), /USER_NOT_FOUND/);
  await assert.rejects(context.service.assign({
    userId: context.user.id,
    badgeDefinitionId: "00000000-0000-4000-8000-000000000099"
  }, context.actor.id), /BADGE_NOT_FOUND/);

  const cases = [
    { slug: "inactive", isActive: false, error: "BADGE_INACTIVE" },
    { slug: "future", startsAt: "2026-08-01T00:00:00.000Z", error: "BADGE_NOT_STARTED" },
    { slug: "expired", endsAt: "2026-07-29T00:00:00.000Z", error: "BADGE_EXPIRED" },
    { slug: "automatic", grantMode: "automatic" as const, error: "BADGE_MANUAL_ASSIGNMENT_NOT_ALLOWED" }
  ];
  for (const item of cases) {
    const badge = await context.badges.create({
      ...baseDraft,
      slug: item.slug,
      ...(item.isActive === undefined ? {} : { isActive: item.isActive }),
      ...(item.startsAt ? { startsAt: item.startsAt } : {}),
      ...(item.endsAt ? { endsAt: item.endsAt } : {}),
      ...(item.grantMode ? { grantMode: item.grantMode } : {})
    }, context.actor.id);
    await assert.rejects(context.service.assign({
      userId: context.user.id,
      badgeDefinitionId: badge.id
    }, context.actor.id), new RegExp(item.error));
  }
  const archived = await context.badges.create(
    { ...baseDraft, slug: "archived" },
    context.actor.id
  );
  await context.badges.archive(archived.id, context.actor.id);
  await assert.rejects(context.service.assign({
    userId: context.user.id,
    badgeDefinitionId: archived.id
  }, context.actor.id), /BADGE_ARCHIVED/);
});

test("request contracts reject HTML, arbitrary identifiers, metadata and unsafe sorting", async () => {
  const context = await setup();
  assert.throws(() => context.service.assign({
    userId: context.user.id,
    badgeDefinitionId: context.badge.id,
    reason: "<b>unsafe</b>"
  }, context.actor.id), /INVALID_REASON/);
  assert.throws(() => context.service.assign({
    userId: context.user.id,
    badgeDefinitionId: context.badge.id,
    metadata: { token: "forbidden" }
  }, context.actor.id), /INVALID_REQUEST|metadata/);
  assert.throws(
    () => parseAssignmentQuery(new URLSearchParams("sort=DROP TABLE")),
    /INVALID_ASSIGNMENT_QUERY/
  );
});
