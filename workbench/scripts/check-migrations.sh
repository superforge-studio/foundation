#!/usr/bin/env bash
# check-migrations.sh — fails on a migration that would break the deploy
# that ships it, before it gets there. Part of `pnpm check`, so CI runs it
# on every PR (`pnpm database:check` runs it alone). It reads Postgres's
# migrations, in source/database/migrations/ (workbench/writing-code.md,
# "Migrations"). Three checks:
#
# - The journal (meta/_journal.json) numbers its entries from 0 with no
#   gaps, each entry's `when` comes after the one before it, and each
#   entry's .sql file exists. Drizzle applies only the migrations timed
#   after the newest one a database has, so one generated on a branch
#   before another merged would never run in production. Generate it again
#   on top of the newest.
#
# - squawk lints every migration (.squawk.toml has its settings): for a
#   lock that would hold up the app while the migration runs, like an index
#   built on a table that already has rows, and for a change the previous
#   version can't survive while it still serves during the deploy, like a
#   dropped column. A finding that's safe, like an index on a table that's
#   small, is allowed in the migration, with the reason, on the line before
#   the statement:
#     -- small table, a few rows per account
#     -- squawk-ignore require-concurrent-index-creation
#
# - The migrations hold every change to schema.ts: drizzle-kit generate,
#   run on a copy of the folder, writes nothing. A missing column fails the
#   tests anyway, since Drizzle names every column, but a changed check,
#   index, default or on-delete doesn't, and production would keep the old
#   one. Run `pnpm database:generate` for the change.
set -euo pipefail

cd "$(dirname "$0")/../.."

FOLDER=source/database/migrations

failed=0

if ! node - "$FOLDER" <<'EOF'; then
const fs = require("node:fs")
const [folder] = process.argv.slice(2)
const journal = JSON.parse(fs.readFileSync(`${folder}/meta/_journal.json`, "utf8"))
const problems = []

journal.entries.forEach((entry, position) => {
    const before = journal.entries[position - 1]
    if (entry.idx !== position) {
        problems.push(`${entry.tag} is numbered ${entry.idx} in the journal, where ${position} comes next.`)
    }
    if (before !== undefined && entry.when <= before.when) {
        problems.push(`${entry.tag} is timed ${entry.when} in the journal, which isn't after ${before.tag} (${before.when}), so no database that has ${before.tag} would run it. Generate it again on top of the newest one.`)
    }
    if (!fs.existsSync(`${folder}/${entry.tag}.sql`)) {
        problems.push(`${folder}/${entry.tag}.sql is in the journal, but missing.`)
    }
})

for (const problem of problems) {
    console.error(problem)
}
process.exit(problems.length === 0 ? 0 : 1)
EOF
    failed=1
fi

# A new app has no migrations yet, and squawk needs a file to read
shopt -s nullglob
migrations=("$FOLDER"/*.sql)
if [ ${#migrations[@]} -gt 0 ] && ! pnpm exec squawk --config .squawk.toml "${migrations[@]}"; then
    echo >&2
    echo "squawk found a migration that would lock a table the app is using, or" >&2
    echo "break the version still serving while it runs. Make the change in" >&2
    echo "steps instead (workbench/writing-code.md, \"Migrations\"), or, if it's" >&2
    echo "safe, say why on the line before a \"-- squawk-ignore <rule>\" comment." >&2
    failed=1
fi

# drizzle-kit generate, on a copy of the folder so nothing here changes,
# with no terminal to ask on (a rename it can't tell from a drop and an add
# fails here, and `pnpm database:generate` asks)
before=$(mktemp -d)
cp -R "$FOLDER/." "$before/"
if ! pnpm exec drizzle-kit generate </dev/null >"$before.log" 2>&1; then
    cat "$before.log" >&2
    echo "drizzle-kit generate failed, or needs to ask about a rename: run" >&2
    echo "\`pnpm database:generate\` in a terminal, and commit its migration." >&2
    failed=1
elif ! diff -rq "$before" "$FOLDER" >/dev/null; then
    diff -rq "$before" "$FOLDER" >&2 || true
    echo "schema.ts has changes no migration holds. Run" >&2
    echo "\`pnpm database:generate --name=<what-it-changed>\` and commit it" >&2
    echo "(workbench/writing-code.md, \"Migrations\")." >&2
    failed=1
fi
# Put the folder back as it was, whatever generate wrote
rm -rf "$FOLDER"
mkdir -p "$FOLDER"
cp -R "$before/." "$FOLDER/"
rm -rf "$before" "$before.log"

exit $failed
