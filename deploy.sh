#!/usr/bin/env bash
# 一键部署到 GitHub Pages。跑之前先确认你已经能用 git 推到 GitHub
# （SSH key 或 gh auth login 都行）。
set -euo pipefail

REPO="${1:-ua-front-map}"                       # 仓库名，可传参覆盖
USER="${GITHUB_USER:-}"                         # 你的 GitHub 用户名

if [ -z "$USER" ]; then
  read -rp "GitHub 用户名: " USER
fi

cd "$(dirname "$0")"

git init -q 2>/dev/null || true
git symbolic-ref HEAD refs/heads/main
git add -A
git diff --staged --quiet || git commit -q -m "俄乌战线态势图：网页 + 每日自动更新的 GeoJSON feed"

if command -v gh >/dev/null 2>&1; then
  gh repo create "$USER/$REPO" --public --source=. --remote=origin --push
  gh api -X POST "repos/$USER/$REPO/pages" -f "build_type=workflow" >/dev/null 2>&1 || true
else
  echo "没装 gh CLI —— 请先在 https://github.com/new 手动建一个名为 $REPO 的 public 仓库，然后按回车继续"
  read -r
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$USER/$REPO.git"
  git push -u origin main
fi

cat <<EOF

推送完成。还差两个开关（必须在网页上点，API 代劳不了）：

  1. Settings -> Pages -> Build and deployment -> Source  选  GitHub Actions
  2. Settings -> Actions -> General -> Workflow permissions  选  Read and write permissions

然后到 Actions 标签页手动跑一次 "Update front-line data" 验证。

跑完你会得到：
  网页   https://$USER.github.io/$REPO/
  feed   https://$USER.github.io/$REPO/data/latest.geojson
  状态   https://$USER.github.io/$REPO/data/meta.json
EOF
