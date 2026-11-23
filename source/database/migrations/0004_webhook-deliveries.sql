CREATE TABLE "internal"."webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"delivery_id" text,
	"headers" jsonb NOT NULL,
	"body" text NOT NULL,
	"outcome" text DEFAULT 'received' NOT NULL,
	"problem" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "webhook_deliveries_outcome_check" CHECK ("outcome" in ('received', 'refused', 'ignored', 'accepted', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_received_at_index" ON "internal"."webhook_deliveries" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_source_delivery_id_index" ON "internal"."webhook_deliveries" USING btree ("source","delivery_id");