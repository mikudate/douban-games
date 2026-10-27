#!/usr/bin/env node
/**
 * 豆瓣「玩过」游戏 → RSS 2.0（富文本版）
 *
 * 复用 douban-skill 里 douban-frodo-export.py 的 Frodo API 鉴权方式，
 * 只拉 game + done 一个分类，输出标准 RSS 2.0：封面、评分、短评、豆瓣链接都在条目里。
 *
 * 用法：
 *   node tools/douban-played-games-feed.mjs --user lyx030605 --out feeds/lyx030605/played-games.xml
 *   node tools/douban-played-games-feed.mjs --user lyx030605 --out ... --opml feeds/lyx030605/douban.opml
 *
 * 选项：
 *   --user <id>        豆瓣 ID（必填）
 *   --out <file>       RSS 输出路径
 *   --opml <file>      额外输出可导入阅读器的 OPML
 *   --feed-url <url>   OPML 里登记的订阅地址
 *   --brief            只输出星级，不带封面/短评/副标题（旧版行为）
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

// --- 与 douban-skill 相同的 Frodo 公开凭证（豆瓣 Android App 内置，所有用户共用）---
const API_KEY = '0dad551ec0f84ed02907ff5c42e8ec70';
const HMAC_SECRET = 'bf7dddc7c9cfe6f7';
const BASE_URL = 'https://frodo.douban.com';
const USER_AGENT =
  'api-client/1 com.douban.frodo/7.22.0.beta9(231) Android/23 product/Mate40 ' +
  'vendor/HUAWEI model/Mate40 brand/HUAWEI rom/android network/wifi platform/AndroidPad';

const PAGE_SIZE = 50;
const PAGE_DELAY_MS = 1500;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const USER = arg('user', process.env.DOUBAN_USER);
if (!USER || !/^[A-Za-z0-9._-]+$/.test(USER)) {
  console.error('用法: node douban-played-games-feed.mjs --user <豆瓣ID> [--out <文件路径>]');
  process.exit(2);
}

const OUT = path.resolve(arg('out', path.join('feeds', USER, 'played-games.xml')));
const OPML_OUT = arg('opml', '');
const FEED_URL = arg('feed-url', `http://127.0.0.1:8811/${USER}/played-games.xml`);
const HTML_URL = `https://www.douban.com/people/${USER}/games?action=collect`;
const BRIEF = process.argv.includes('--brief');

// 封面图有防盗链：不带豆瓣 Referer 会 418。RSS 阅读器不会带 Referer，
// 所以把封面下载到站点目录里自己托管。CI 里自动开启，本地可用参数覆盖。
function pagesBase() {
  const repoFull = process.env.GITHUB_REPOSITORY || '';
  const [owner, repo] = repoFull.split('/');
  if (!owner || !repo) return '';
  return repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? `https://${repo.toLowerCase()}`
    : `https://${owner.toLowerCase()}.github.io/${repo.toLowerCase()}`;
}

const IN_CI = process.env.GITHUB_ACTIONS === 'true';
const ASSET_BASE = arg('asset-base', IN_CI ? `${pagesBase()}/covers` : '');
const ASSET_DIR = arg(
  'asset-dir',
  IN_CI ? path.join(path.dirname(OUT), '..', 'covers') : ''
);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function signature(ts) {
  const p = `/api/v2/user/${USER}/interests`;
  const raw = `GET&${encodeURIComponent(p)}&${ts}`;
  return crypto.createHmac('sha1', HMAC_SECRET).update(raw).digest('base64');
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 20000 }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`Bad JSON: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchAllPlayedGames() {
  const apiPath = `${BASE_URL}/api/v2/user/${USER}/interests`;
  const items = [];
  let start = 0;
  let total = null;

  for (let page = 0; page < 200; page++) {
    const ts = String(Math.floor(Date.now() / 1000));
    const qs = new URLSearchParams({
      type: 'game', status: 'done', start: String(start), count: String(PAGE_SIZE),
      apiKey: API_KEY, _ts: ts, _sig: signature(ts), os_rom: 'android',
    });
    const data = await getJson(`${apiPath}?${qs}`);
    const batch = data.interests || [];
    if (total === null) {
      total = data.total ?? 0;
      console.log(`玩过 总数: ${total}`);
      if (!total) break;
    }
    if (!batch.length) break;
    items.push(...batch);
    console.log(`  已取 ${items.length}/${total}`);
    if (items.length >= total) break;
    start += batch.length;
    await sleep(PAGE_DELAY_MS);
  }
  return items;
}

// --- XML / HTML 工具 ---

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function xml(s) {
  return decodeEntities(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function html(s) {
  return decodeEntities(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cdata(s) {
  return `<![CDATA[${String(s).replaceAll(']]>', ']]&gt;')}]]>`;
}

function stars(rating) {
  if (!rating || !rating.value) return '';
  const n = rating.max && rating.max > 5 ? Math.round(rating.value / 2) : Math.round(rating.value);
  return '★'.repeat(Math.max(0, Math.min(5, n)));
}

function rfc822(dateStr) {
  const d = dateStr ? new Date(`${dateStr.slice(0, 10)}T00:00:00+08:00`) : new Date();
  return isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

// --- 条目 HTML ---

function buildContent(game) {
  const parts = [];
  if (game.cover) {
    parts.push(`<p><img src="${html(game.cover)}" alt="${html(game.title)}" width="140" /></p>`);
  }
  parts.push(`<p><strong>${html(game.title)}</strong></p>`);
  if (game.subtitle) {
    parts.push(`<p><small>${html(game.subtitle)}</small></p>`);
  }
  const meta = [game.stars, `玩过 ${game.date}`].filter(Boolean).join(' · ');
  if (meta) {
    parts.push(`<p>${html(meta)}</p>`);
  }
  if (game.comment) {
    parts.push(`<blockquote>${html(game.comment).replace(/\n/g, '<br />')}</blockquote>`);
  }
  parts.push(`<p><a href="${html(game.url)}">在豆瓣打开</a></p>`);
  return parts.join('\n');
}

const raw = await fetchAllPlayedGames();
const games = raw
  .map(it => {
    const s = it.subject || {};
    const url = s.id ? `https://www.douban.com/game/${s.id}/` : (s.url || '');
    return {
      id: s.id ? String(s.id) : '',
      title: s.title || '(无标题)',
      url,
      cover: s.cover_url || '',
      subtitle: s.card_subtitle || '',
      date: (it.create_time || '').slice(0, 10),
      stars: stars(it.rating),
      comment: (it.comment || '').trim(),
    };
  })
  .filter(g => g.url)
  .sort((a, b) => (a.date < b.date ? 1 : -1));

// --- 封面本地化（绕过豆瓣防盗链）---
function fetchBinary(url, referer, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 3) return reject(new Error('too many redirects'));
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0', Referer: referer },
      timeout: 20000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchBinary(res.headers.location, referer, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

if (ASSET_DIR) {
  const dir = path.resolve(ASSET_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const todo = games.filter(g => g.id && g.cover);
  let downloaded = 0;
  let failed = 0;

  for (let i = 0; i < todo.length; i += 6) {
    const batch = todo.slice(i, i + 6);
    await Promise.all(batch.map(async g => {
      const file = path.join(dir, `${g.id}.jpg`);
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
        try {
          const buf = await fetchBinary(g.cover, 'https://movie.douban.com/');
          fs.writeFileSync(file, buf);
          downloaded++;
        } catch (e) {
          failed++;
          return; // 下载失败就继续用豆瓣原图
        }
      }
      g.cover = ASSET_BASE ? `${ASSET_BASE}/${g.id}.jpg` : g.cover;
    }));
  }
  console.log(`封面: 新增 ${downloaded} 张，失败 ${failed} 张，目录 ${dir}`);
}

console.log(`\n生成 RSS，共 ${games.length} 条（${BRIEF ? '精简：仅星级' : '富文本：封面 + 短评 + 链接'}）`);

const now = new Date().toUTCString();
const items = games
  .map(g => {
    const description = BRIEF ? xml(g.stars) : cdata(buildContent(g));
    const enclosure = g.cover
      ? `    <enclosure url="${xml(g.cover)}" type="image/jpeg" length="0"/>\n    <media:content url="${xml(g.cover)}" medium="image"/>\n    <media:thumbnail url="${xml(g.cover)}"/>\n`
      : '';
    const contentEncoded = BRIEF ? '' : `    <content:encoded>${cdata(buildContent(g))}</content:encoded>\n`;
    return [
      '  <item>',
      `    <title>${xml(g.title)}</title>`,
      `    <link>${xml(g.url)}</link>`,
      `    <guid isPermaLink="true">${xml(g.url)}</guid>`,
      `    <pubDate>${rfc822(g.date)}</pubDate>`,
      `    <description>${description}</description>`,
      contentEncoded.trimEnd(),
      enclosure.trimEnd(),
      '  </item>',
    ].filter(l => l !== '').join('\n');
  })
  .join('\n');

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>豆瓣玩过的游戏 · ${xml(USER)}</title>
    <link>${xml(HTML_URL)}</link>
    <description>从豆瓣 Frodo 接口抓取的「玩过」游戏收藏，仅含 game + done。</description>
    <language>zh-CN</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${xml(FEED_URL)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, feed, 'utf8');
console.log(`已写入: ${OUT}`);

if (OPML_OUT) {
  const opmlPath = path.resolve(OPML_OUT);
  const outlineTitle = `豆瓣 · ${USER} 玩过的游戏`;
  const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${xml(outlineTitle)}</title>
    <dateCreated>${now}</dateCreated>
  </head>
  <body>
    <outline type="rss" text="${xml(outlineTitle)}" title="${xml(outlineTitle)}"
             xmlUrl="${xml(FEED_URL)}" htmlUrl="${xml(HTML_URL)}"/>
  </body>
</opml>
`;
  fs.mkdirSync(path.dirname(opmlPath), { recursive: true });
  fs.writeFileSync(opmlPath, opml, 'utf8');
  console.log(`已写入 OPML: ${opmlPath}`);
}
