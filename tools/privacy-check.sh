#!/usr/bin/env bash
# Run before every push. Fails if the tree holds strings from the private repo's memory or a token shape.
# The word list is passed in, so this file does not contain it: tools/privacy-check.sh Word1 Word2 ...
cd "$(dirname "$0")/.." || exit 1
bad=0
for w in "$@"; do
  if git ls-files -z | xargs -0 grep -il -- "$w" 2>/dev/null | grep -v '^tools/privacy-check.sh$' | grep -q .; then echo "FOUND: $w"; bad=1; fi
done
if git ls-files -z | xargs -0 grep -nE 'gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}' 2>/dev/null | grep -q .; then echo "FOUND: token shape"; bad=1; fi
[ "$bad" = 0 ] && echo "privacy-check: clean"
exit $bad
