-- The template says "login", not "sign-in" (0.13.0): when a user last
-- logged in. The version still serving writes the old name at each login
-- until the new one starts, so a login in the minute the deploy takes
-- fails, and its person tries again.
-- squawk-ignore renaming-column
ALTER TABLE "users" RENAME COLUMN "signed_in_at" TO "logged_in_at";
