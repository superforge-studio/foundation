-- files holds the team's own files, a few thousand rows at most: rewriting
-- it for the wider size, and checking its folders again for the new delete
-- rule, takes a moment. The version still serving reads a size as a number
-- either way, and never deletes a folder with a file still in it.
-- squawk-ignore ban-drop-constraint
ALTER TABLE "files" DROP CONSTRAINT "files_folder_id_file_folders_id_fk";
--> statement-breakpoint
-- squawk-ignore changing-column-type
ALTER TABLE "files" ALTER COLUMN "size" SET DATA TYPE bigint;--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_file_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."file_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- The analytics can be millions of rows, so their checks hold for what's
-- written from now on, without a scan of what's there, which the server
-- only ever wrote from the same lists
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_source_check" CHECK ("source" in ('browser', 'server')) NOT VALID;--> statement-breakpoint
ALTER TABLE "analytics_visits" ADD CONSTRAINT "analytics_visits_device_check" CHECK ("device" in ('mobile', 'tablet', 'desktop')) NOT VALID;
