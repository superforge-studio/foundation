#!/usr/bin/env bash
# ruleset.sh — puts the `main` ruleset on this repository on GitHub
# (`pnpm github:ruleset`), from .github/rulesets/main.json: no deleting or
# force-pushing `main`, a pull request to change it, and CI's `check` passed
# before it merges. It makes the ruleset, or makes the one already there
# match the file, so it's safe to run again after the file changes.
#
# It runs as whoever `gh` is logged in as, who has to administer the
# repository. GitHub has rulesets on a public repository on every plan, and
# on a private one from Pro or Team up: where the plan has none, this says
# so and passes, since nothing else depends on the ruleset.
set -euo pipefail

cd "$(dirname "$0")/../.."

file=.github/rulesets/main.json
name=$(node --print "JSON.parse(require('node:fs').readFileSync('$file', 'utf8')).name")
repository=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

# A ruleset is found by its name, since the file holds no ID: an ID is one
# repository's, and every copy has this file.
if ! listed=$(gh api "repos/$repository/rulesets" --paginate 2>&1); then
    if grep -q -i -E "upgrade|HTTP 403" <<<"$listed"; then
        echo "No ruleset: $repository's GitHub plan has none for a private repository (Pro or Team has). Nothing else needs it."
        exit 0
    fi
    echo "$listed" >&2
    exit 1
fi
id=$(node --print "(JSON.parse(process.argv[1]).find((ruleset) => ruleset.name === process.argv[2]) ?? { id: '' }).id" "$listed" "$name")

if [ -n "$id" ]; then
    method=PUT
    path="repos/$repository/rulesets/$id"
else
    method=POST
    path="repos/$repository/rulesets"
fi

if ! answer=$(gh api --method "$method" "$path" --input "$file" 2>&1); then
    if grep -q -i -E "upgrade|HTTP 403" <<<"$answer"; then
        echo "No ruleset: $repository's GitHub plan has none for a private repository (Pro or Team has), or this login can't administer it. Nothing else needs it."
        exit 0
    fi
    echo "$answer" >&2
    exit 1
fi

echo "The \`$name\` ruleset on $repository matches $file."
