CREATE TABLE "file_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"trashed_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"state" text DEFAULT 'uploading' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"trashed_at" timestamp (3) with time zone,
	CONSTRAINT "files_state_check" CHECK ("state" in ('uploading', 'ready'))
);
--> statement-breakpoint
CREATE TABLE "internal"."rate_limits" (
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"window_started_at" timestamp (3) with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limits_bucket_key_pk" PRIMARY KEY("bucket","key")
);
--> statement-breakpoint
-- users.role goes below, and its check with it: nothing has read or
-- written role since 0.18.0, which the version still serving is
-- squawk-ignore ban-drop-constraint
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_parent_id_file_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."file_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_file_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."file_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_folders_parent_id_index" ON "file_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "file_folders_created_by_index" ON "file_folders" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "file_folders_trashed_at_index" ON "file_folders" USING btree ("trashed_at");--> statement-breakpoint
CREATE INDEX "files_folder_id_index" ON "files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "files_uploaded_by_index" ON "files" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "files_trashed_at_index" ON "files" USING btree ("trashed_at");--> statement-breakpoint
CREATE INDEX "rate_limits_window_started_at_index" ON "internal"."rate_limits" USING btree ("window_started_at");--> statement-breakpoint
-- Nothing has read or written users.role since 0.18.0, the release this
-- one follows, so the version still serving never asks for it
-- squawk-ignore ban-drop-column
ALTER TABLE "users" DROP COLUMN "role";