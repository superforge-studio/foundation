-- An address is unique among the active team only, so a deactivated row
-- keeping its address no longer stops someone listed from taking it. The
-- version still serving finds a row by its address only when its slug has
-- none, and gives no active row an address another active row has, so it
-- runs as before with the narrower index.
-- squawk-ignore ban-drop-constraint
ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
-- users holds the team, a few dozen rows at most
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX "users_email_index" ON "users" USING btree ("email") WHERE "users"."deactivated_at" is null;
