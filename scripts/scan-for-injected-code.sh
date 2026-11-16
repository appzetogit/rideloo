#!/usr/bin/env sh
# Refuses the tree if it carries the code that has been injected into this
# project three times: an obfuscated script hidden in a file nobody reads.
#
# Every one of those injections had the same shape. It appends itself to the
# end of a file that runs automatically - a Vite config, a VS Code task - after
# a long run of tab characters, so the line looks blank in a diff and the file
# looks untouched unless you check its size. It ships as `fa-solid-500.woff2`,
# a font name that does not exist in FontAwesome, which is really JavaScript.
# And it adds its own tooling to .gitignore so `git status` stays quiet.
#
# The checks are written against those habits rather than a hash, so a
# recompiled payload still trips them. Exit 1 means do not commit or push.
#
# Usage:
#   scripts/scan-for-injected-code.sh            every tracked file on disk
#   scripts/scan-for-injected-code.sh --staged   what is about to be committed
#   scripts/scan-for-injected-code.sh <rev>      a commit, e.g. origin/main
set -u

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Not a git repository."; exit 2; }
cd "$ROOT" || exit 2

# What to search. git grep does the whole tree in one process - the first
# version forked grep several times per file and took over five minutes on
# this repo, which is long enough that nobody would leave the hook enabled.
case "${1:-}" in
  --staged) SCOPE="--cached"; LABEL="staged changes"; LIST=$(git diff --cached --name-only --diff-filter=ACMR) ;;
  "")       SCOPE="";         LABEL="working tree";   LIST=$(git ls-files) ;;
  *)        SCOPE="$1";       LABEL="commit $1";      LIST=$(git ls-tree -r --name-only "$1") ;;
esac

# Findings go to a file rather than a counter: several checks read through
# `| while`, which runs in a subshell in POSIX sh, so a counter incremented
# there is lost and an infected tree would be reported clean.
FINDINGS=$(mktemp 2>/dev/null || echo "/tmp/scan-findings-$$")
: > "$FINDINGS"
trap 'rm -f "$FINDINGS"' EXIT
say() { echo "$1" >> "$FINDINGS"; }

echo "Scanning $LABEL for injected code..."

# Content checks, one git grep each. -I skips binaries, -l lists files only.
search() {
  # $1 = description, remaining = git grep arguments (-E/-F and the pattern)
  desc=$1; shift
  hits=$(mktemp 2>/dev/null || echo "/tmp/scan-hits-$$")
  errs=$(mktemp 2>/dev/null || echo "/tmp/scan-errs-$$")

  # This script and its CI job necessarily contain the strings they search
  # for, so they are excluded - otherwise the scanner reports itself.
  #
  # --cached is an option and must come before the pattern; a revision is an
  # operand and must come after it. The first version put both after, so git
  # read "--cached" as a revision name and failed - and see below for why that
  # went unnoticed.
  case "$SCOPE" in
    --cached) git grep -lI --cached "$@" -- . ':!scripts/scan-for-injected-code.sh' ':!.github/workflows/scan-for-injected-code.yml' >"$hits" 2>"$errs" ;;
    "")       git grep -lI          "$@" -- . ':!scripts/scan-for-injected-code.sh' ':!.github/workflows/scan-for-injected-code.yml' >"$hits" 2>"$errs" ;;
    *)        git grep -lI "$@" "$SCOPE" -- . ':!scripts/scan-for-injected-code.sh' ':!.github/workflows/scan-for-injected-code.yml' >"$hits" 2>"$errs" ;;
  esac
  rc=$?

  # Fail closed. git grep exits 0 for matches, 1 for none, and anything higher
  # when it did not run at all. The first version discarded stderr and read an
  # empty result as "none", so a scan that crashed reported the tree Clean and
  # let a planted marker straight through the pre-commit hook. A scanner that
  # cannot run must refuse, never pass.
  if [ "$rc" -gt 1 ]; then
    say "SCANNER DID NOT RUN ($desc): git grep exited $rc - $(head -1 "$errs")"
  fi

  sed "s|^[^:]*:||" "$hits" | while IFS= read -r f; do
    [ -n "$f" ] && say "$f: $desc"
  done
  rm -f "$hits" "$errs"
}

# A file's contents at the scope being scanned: on disk, staged, or at a
# revision. Everything that inspects a file's contents goes through this.
#
# Two earlier bugs came from not doing so. Reading .gitignore straight off
# disk while scanning a revision reported origin/main clean when its committed
# .gitignore still hid the payload's tooling. And `git show rev:path` is
# mangled by git-bash on Windows into "rev;path", which silently reads nothing
# - so this resolves the blob hash first and reads that instead.
scoped_cat() {
  case "$SCOPE" in
    "")       cat "$1" 2>/dev/null ;;
    --cached) b=$(git ls-files -s -- "$1" | awk '{print $2}'); [ -n "$b" ] && git cat-file -p "$b" 2>/dev/null ;;
    *)        b=$(git ls-tree "$SCOPE" -- "$1" | awk '{print $3}'); [ -n "$b" ] && git cat-file -p "$b" 2>/dev/null ;;
  esac
}
blob_head() { scoped_cat "$1" | head -c 4; }

search "payload marker global.i = 'A8-...'"                       -E "global\.i *= *['\"]A8-"
search "obfuscated payload signature _0x4925"                     -F "_0x4925"
TABS=$(printf '\t%.0s' $(seq 1 50))
search "50+ consecutive tabs - how appended code is pushed off-screen" -F "$TABS"

# Path checks, from the file list alone.
printf '%s\n' "$LIST" | grep -i 'fa-solid-500' | while IFS= read -r f; do
  [ -n "$f" ] && say "$f: FontAwesome has no 500 weight - this name has been the payload every time"
done

# A font that is not a font. Only a handful of these exist, so a loop is fine.
printf '%s\n' "$LIST" | grep -iE '\.woff2?$' | while IFS= read -r f; do
  [ -n "$f" ] || continue
  sig=$(blob_head "$f")
  case "$f" in
    *.woff2|*.WOFF2) [ "$sig" = "wOF2" ] || say "$f: named .woff2 but does not start with wOF2" ;;
    *)               [ "$sig" = "wOFF" ] || say "$f: named .woff but does not start with wOFF" ;;
  esac
done

# Known malicious launcher files
printf '%s\n' "$LIST" | grep -E '(^|/)(init|api\.js)$' | while IFS= read -r f; do
  [ -n "$f" ] && say "$f: launcher file used by malicious injection payloads"
done

# A script whose source is one enormous line. Hand-written code never looks
# like that; the 10 Oct payload (Backend/api.js, 29 KB on a single line) did.
printf '%s\n' "$LIST" | grep -E '(\.(c|m)?js|(^|/)init)$' | grep -vE '(^|/)(node_modules|dist|build|vendor)/|\.min\.js$' | while IFS= read -r f; do
  [ -n "$f" ] || continue
  if scoped_cat "$f" | awk 'length > 5000 { found = 1; exit } END { exit !found }'; then
    say "$f: a line over 5000 characters - how obfuscated payloads look"
  fi
done

# npm scripts that run something before the app. The same payload made
# "npm start" run "node api.js && node server.js", so starting the backend
# executed it first.
printf '%s\n' "$LIST" | grep -E '(^|/)package\.json$' | while IFS= read -r f; do
  [ -n "$f" ] || continue
  if scoped_cat "$f" | grep -E '"(start|dev|prestart|predev|postinstall|preinstall|install|build)" *:' | grep -qE 'node +[^ "&]+ *&&'; then
    say "$f: an npm script runs another file before the app - the payload's launcher"
  fi
done

# Anything in a fonts folder that is not a font - the payload once renamed
# itself fa-solid-300.llf to dodge the name and .woff checks.
printf '%s\n' "$LIST" | grep -iE '(^|/)fonts/' | while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    *.ttf|*.TTF|*.otf|*.OTF|*.woff|*.WOFF|*.woff2|*.WOFF2|*.eot|*.EOT|*.svg|*.SVG|*.md|*.txt|*/LICENSE*|*/OFL*) ;;
    *) say "$f: not a font file but sits in a fonts folder - where the payload has hidden" ;;
  esac
done

# Editor auto-run, read at the scanned scope.
for f in .vscode/tasks.json .vscode/launch.json; do
  if scoped_cat "$f" | grep -q 'folderOpen'; then
    say "$f: runs a task on folderOpen - opening this folder in VS Code executes it"
  fi
done

# ...and on disk too when scanning something other than the working tree. An
# untracked auto-run task is not part of any commit, but opening the folder
# still executes it, so it is reported whatever is being scanned.
if [ -n "$SCOPE" ]; then
  for f in .vscode/tasks.json .vscode/launch.json; do
    if [ -f "$f" ] && grep -q 'folderOpen' "$f" 2>/dev/null; then
      say "$f (on this machine's disk): runs a task on folderOpen"
    fi
  done
fi

# The payload's tooling is never committed - it lives on the infected machine.
# Always checked on disk: finding it means this machine has run the payload.
for f in temp_auto_push.bat temp_interactive_push.bat branch_structure.json; do
  [ -e "$f" ] && say "$f: present on this machine - the payload's own push tooling"
done

# .gitignore at the scanned scope.
GITIGNORE=$(scoped_cat .gitignore)
if [ -n "$GITIGNORE" ]; then
  for p in temp_auto_push temp_interactive_push branch_structure config.bat; do
    printf '%s\n' "$GITIGNORE" | grep -q "$p" && say ".gitignore hides '$p' - added by the payload to stay invisible"
  done
  printf '%s\n' "$GITIGNORE" | grep -qx '\.gitignore' && say ".gitignore ignores itself - added by the payload to hide its own edits"
fi

# wc rather than `grep -c . || echo 0`: grep prints 0 *and* exits 1 on an
# empty file, so the fallback fired too, COUNT became "0\n0", and every clean
# tree was refused.
COUNT=$(sort -u "$FINDINGS" | wc -l | tr -d ' ')
echo
if [ "$COUNT" -eq 0 ]; then
  echo "Clean - nothing matching the known injection found."
  exit 0
fi

sort -u "$FINDINGS" | nl -w2 -s'. ' | sed 's/^/  /'
cat <<'WARN'

REFUSED. The findings above match code that has been injected into this
project before. Do not commit, push, build, or open this folder in VS Code
until they are dealt with.

A false positive is possible - but every previous injection also looked like
a harmless file. Tell the team before overriding: git commit --no-verify
WARN
exit 1
