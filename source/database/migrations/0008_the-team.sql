-- The team: `users` holds only the business's own people, as
-- backend/auth/access.ts lists them, each found by a slug that never
-- changes, and deactivated rather than deleted once they're taken off it.
-- Nobody else logs in, so everyone who was `external` is deactivated, with
-- their sessions ended, and keeps their row, so what they did still points
-- at them. `role` stays until the next release, which drops it: the
-- version still serving reads it.
--
-- users holds the business's people: a few hundred rows at most, so the
-- locks below are held for moments. The version still serving can't make a
-- user without a slug, so a first login in the minute the deploy takes
-- fails, and its person tries again.
--
-- Each user's slug: their id for now, which no list gives anyone, so the
-- server's start finds each listed person by their address and gives
-- their row the slug they're listed with (backend/users/sync.ts)
ALTER TABLE "users" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "users" SET "slug" = "id"::text;--> statement-breakpoint
-- Every row was given a slug above
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "users" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
-- squawk-ignore disallowed-unique-constraint, constraint-missing-not-valid
ALTER TABLE "users" ADD CONSTRAINT "users_slug_unique" UNIQUE("slug");--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "users" ADD CONSTRAINT "users_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp (3) with time zone;--> statement-breakpoint
-- Nothing writes role now, and the next release drops it; until then a
-- row made without it is one of the team's
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'internal';--> statement-breakpoint
-- Everyone who isn't the business's own, who can't log in now
UPDATE "users" SET "deactivated_at" = now() WHERE "role" = 'external';--> statement-breakpoint
DELETE FROM "auth"."sessions"
WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "deactivated_at" IS NOT NULL);
