#!/usr/bin/env bash
# 全自动部署到 GitHub Pages。你只需要在浏览器里授权一次。
set -uo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH

REPO="${REPO:-ua-front-map}"
cd "$(dirname "$0")"

say(){ printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
die(){ printf "\n\033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }

# ── 1. gh CLI ──────────────────────────────────────────────────────────
if ! command -v gh >/dev/null 2>&1; then
  say "安装 GitHub CLI（约 1 分钟）"
  brew install gh || die "brew install gh 失败"
fi
say "gh $(gh --version | head -1 | awk '{print $3}') 就绪"

# ── 2. 授权：唯一需要你动手的一步 ──────────────────────────────────────
if ! gh auth status >/dev/null 2>&1; then
  cat <<'MSG'

  ┌────────────────────────────────────────────────────────────┐
  │  接下来 GitHub 要确认是你本人。照着提示走：                │
  │                                                            │
  │   · What account do you want to log into?  → GitHub.com    │
  │   · Preferred protocol?                    → HTTPS         │
  │   · Authenticate Git with your credentials? → Yes          │
  │   · How would you like to authenticate?    → Login with a  │
  │                                              web browser   │
  │                                                            │
  │  屏幕上会给你一个 XXXX-XXXX 的一次性码，回车后浏览器自动   │
  │  打开，把码粘进去、点 Authorize 就行。                     │
  │                                                            │
  │  之后的所有步骤都是自动的，你不用再管。                    │
  └────────────────────────────────────────────────────────────┘

MSG
  gh auth login -s repo,workflow || die "授权未完成"
fi

USER=$(gh api user -q .login) || die "拿不到用户名"
say "已登录：$USER"

# ── 3. git 身份 ────────────────────────────────────────────────────────
[ -z "$(git config --global user.name  || true)" ] && git config --global user.name  "$USER"
[ -z "$(git config --global user.email || true)" ] && \
  git config --global user.email "$(gh api user -q .email 2>/dev/null || echo "$USER@users.noreply.github.com")"

# ── 4. 建仓库并推送 ────────────────────────────────────────────────────
git init -q 2>/dev/null || true
git symbolic-ref HEAD refs/heads/main 2>/dev/null || true
git add -A
git diff --staged --quiet 2>/dev/null || \
  git commit -q -m "俄乌战线态势图：网页 + 每日自动更新的 GeoJSON feed"

if gh repo view "$USER/$REPO" >/dev/null 2>&1; then
  say "仓库 $USER/$REPO 已存在，直接推送"
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$USER/$REPO.git"
  git push -u origin main --force-with-lease || git push -u origin main
else
  say "创建 public 仓库 $USER/$REPO 并推送"
  gh repo create "$USER/$REPO" --public \
     --description "俄乌战场态势图 · 每日自动更新（DeepStateMap + ISW）" \
     --source=. --remote=origin --push || die "创建/推送失败"
fi

# ── 5. 打开 Pages（用 Actions 构建）────────────────────────────────────
say "启用 GitHub Pages"
gh api -X POST "repos/$USER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PUT "repos/$USER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
  || echo "  （Pages 可能已启用，继续）"

# ── 6. 给 Actions 写权限（否则刷新的数据提交不回去）────────────────────
say "给 Actions 开写权限"
gh api -X PUT "repos/$USER/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=false >/dev/null 2>&1 \
  || echo "  （设置失败，稍后到 Settings → Actions 手动改成 Read and write）"

# ── 7. 立刻跑一次构建 ──────────────────────────────────────────────────
say "触发首次构建"
sleep 3
gh workflow run "Update front-line data" -R "$USER/$REPO" >/dev/null 2>&1 \
  || gh workflow run update.yml -R "$USER/$REPO" >/dev/null 2>&1 \
  || echo "  （自动触发失败，可到 Actions 标签页手动点 Run workflow）"

printf "\n\033[1;32m%s\033[0m\n" "════════════════════════════════════════════════════════════"
cat <<EOF
 部署完成。构建约 2–3 分钟，跑完后这些链接就是活的：

   网页   https://$USER.github.io/$REPO/
   feed   https://$USER.github.io/$REPO/data/latest.geojson
   状态   https://$USER.github.io/$REPO/data/meta.json

 构建进度： https://github.com/$USER/$REPO/actions

 网页是公开的：任何拿到链接的人直接打开就能看，
 不需要 GitHub 账号，也不需要登录。
EOF
printf "\033[1;32m%s\033[0m\n\n" "════════════════════════════════════════════════════════════"
printf "%s\n" "$USER/$REPO" > .deployed_as
