ALTER TABLE "analytics_visits" ADD COLUMN "ip_address" "inet";--> statement-breakpoint
-- analytics_visits began with Foundation 0.7.0, on Nov 21, 2026, so a copy
-- holds a few weeks of visits at most, and every one's ip_address was just
-- added as null, so the index starts empty and building it is one short
-- scan of the table
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "analytics_visits_ip_address_started_at_index" ON "analytics_visits" USING btree ("started_at") WHERE "analytics_visits"."ip_address" is not null;
