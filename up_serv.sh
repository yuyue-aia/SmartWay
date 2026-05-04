#!/usr/bin/env bash
set -euo pipefail

commit_message="${1:-chore: update smartway $(date '+%Y-%m-%d %H:%M:%S')}"
branch="$(git rev-parse --abbrev-ref HEAD)"

if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "$commit_message"
else
  echo "没有本地修改，跳过提交"
fi

echo "同步远端分支 origin/$branch"
git pull --rebase origin "$branch"

git push origin "$branch"
node tools/update-github.js
