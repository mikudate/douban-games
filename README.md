# 豆瓣「玩过的游戏」RSS（GitHub Pages 静态托管）

每天 09:00（北京时间）用 GitHub Actions 重新生成一份只含「玩过」游戏的 RSS，提交回仓库，并发布到 GitHub Pages。云端阅读器（Feedly / Inoreader / …）直接订阅 Pages 地址即可。

## 订阅地址

```
https://<你的GitHub用户名>.github.io/<仓库名>/lyx030605/played-games.xml
```

## 目录结构

| 路径 | 说明 |
|---|---|
| `tools/douban-played-games-feed.mjs` | 生成器：调豆瓣 rexxar 接口翻页取全部「玩过」，输出 RSS + OPML |
| `feeds/lyx030605/played-games.xml` | 生成结果（由 Actions 更新） |
| `feeds/lyx030605/douban.opml` | 可导入阅读器的 OPML |
| `.github/workflows/refresh-douban-feed.yml` | 每天重建 + 发布 Pages |
| `rsshub-route/` | 备选方案：自建 RSSHub 路由（不需要就别管） |

## 部署（3 步）

1. **建仓库并上传**：在 GitHub 新建 **public** 仓库（免费版 Pages 只支持公开仓库），把本目录内容传上去。
   - 装了 Git：`git init && git add -A && git commit -m init && git remote add origin <url> && git push -u origin main`
   - 没装 Git：用 GitHub 网页的 “Upload files”，把 `tools/`、`feeds/`、`.github/`、`.gitignore`、`README.md` 一起拖进去（网页上传支持文件夹和 `.github` 这种点目录）。
2. **打开 Pages**：仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。
3. **手动跑一次**：Actions → `refresh-douban-feed` → Run workflow。跑完在 Pages 页面就能看到站点地址。

之后每天定时跑；也可以随时手动触发。

## 本地预览

```powershell
node .\tools\douban-played-games-feed.mjs --user lyx030605 --out .\feeds\lyx030605\played-games.xml --opml .\feeds\lyx030605\douban.opml
python .\tools\serve-feeds.py --port 8811
# http://127.0.0.1:8811/lyx030605/played-games.xml
```

## 换用户 / 换内容

- 换豆瓣 ID：改 `.github/workflows/refresh-douban-feed.yml` 里的 `--user`，以及 `feeds/` 下的目录名。
- 想带短评：生成器加 `--with-comments`。
- 想改刷新时间：改 cron（`0 1 * * *` 是 UTC 01:00 = 北京时间 09:00）。

## 说明与限制

- 只包含 `game` + `done`（玩过），不含想玩/在玩。
- 数据来自豆瓣公开接口，账号隐藏或 ID 错误时会生成空 feed，属预期行为。
- 仓库是公开的，游戏列表和星级会公开可见；不想公开就用 Cloudflare Pages 部署私有仓库。
