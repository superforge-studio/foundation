#!/usr/bin/env bash
# strip-template.sh — takes out of a new copy what only the template has:
# every path .superforge/template-only marks `template`, this script and
# that list among them, and every block of a Markdown file between
# <!-- template-only --> and <!-- /template-only -->. Run it once, from the
# copy's root, as its setup starts (workbench/setup/1-see-it.md). It needs
# only bash, so it runs before anything is installed, and it's safe to run
# again: once the list is gone, there's nothing left to strip.
set -euo pipefail

cd "$(dirname "$0")/../.."

list=.superforge/template-only
if [ ! -f "$list" ]; then
    echo "Nothing to strip: $list is gone, so this copy is stripped already."
    exit 0
fi

# Read the whole list first, since the list itself is on it
paths=()
while read -r kind path; do
    [ "$kind" = template ] || continue
    case "$path" in
        "" | /* | *..*)
            echo "Refusing to delete '$path': a path on $list is relative to the root, inside it." >&2
            exit 1
            ;;
    esac
    paths+=("${path%/}")
done < <(grep -v '^[[:space:]]*#' "$list")

# The template's blocks in the Markdown files kept, like README.md's
# "This template"
while IFS= read -r file; do
    kept=$(mktemp)
    awk '
        /^<!-- template-only -->$/ { skipping = 1; next }
        /^<!-- \/template-only -->$/ { skipping = 0; next }
        !skipping { print }
    ' "$file" > "$kept"
    mv "$kept" "$file"
    echo "Took the template's own out of $file"
done < <(grep -rl --include='*.md' --exclude-dir=node_modules --exclude-dir=.git -e '^<!-- template-only -->$' . || true)

for path in "${paths[@]}"; do
    if [ -e "$path" ]; then
        rm -rf -- "$path"
        echo "Deleted $path"
    fi
done

echo "Stripped: what's left is the business's copy."
