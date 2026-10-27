#!/usr/bin/env node
/**
 * 豆瓣「玩过」游戏 → RSS 2.0
 *
 * douban-skill 本身不生成 RSS（它只做 CSV 同步）。这个脚本复用该 skill
 * douban-frodo-export.py 里同样的 Frodo API 鉴权方式（公开的 App 凭证），
 * 只拉取 game + done 一个分类，输出一个只含「玩过」游戏的标准 RSS 2.0 文件。
 *
 * 用法：
 *   node tools/douban-played-games-feed.mjs --user lyx030605 --out feeds/lyx030605/played-games.xml
 *   node tools/douban-played-games-feed.mjs --user lyx030605 --out ... --opml feeds/lyx030605/douban.opml
 *
 * 选项：
 *   --user <id>            豆瓣 ID（必填）
 *   --out <file>           RSS 输出路径
 *   --opml <file>          额外输出可导入阅读器的 OPML
 *   --feed-url <url>       OPML 里登记的订阅地址（默认 http://127.0.0.1:8811/<id>/played-games.xml）
 *   --with-comments        description 里带上短评原文（默认只保留星级）
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
const WITH_COMMENTS = process.argv.includes('--with-comments');
const OPML_OUT = arg('opml', '');
const FEED_URL = arg('feed-url', `http://127.0.0.1:8811/${USER}/played-games.xml`);
const HTML_URL = `https://www.douban.com/people/${USER}/games?action=collect`;

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

// 先解码豆瓣返回的 HTML 实体，再做 XML 转义，避免出现 &amp;amp;
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

function stars(rating) {
  if (!rating || !rating.value) return '';
  const n = rating.max && rating.max > 5 ? Math.round(rating.value / 2) : Math.round(rating.value);
  return '★'.repeat(Math.max(0, Math.min(5, n)));
}

function rfc822(dateStr) {
  const d = dateStr ? new Date(`${dateStr.slice(0, 10)}T00:00:00+08:00`) : new Date();
  return isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

const games = await fetchAllPlayedGames();
const items = games
  .map(it => {
    const s = it.subject || {};
    const url = s.id ? `https://www.douban.com/game/${s.id}/` : (s.url || '');
    return {
      title: s.title || '(无标题)',
      url,
      date: (it.create_time || '').slice(0, 10),
      rating: stars(it.rating),
      comment: it.comment || '',
    };
  })
  .filter(g => g.url)
  .sort((a, b) => (a.date < b.date ? 1 : -1));

console.log(`\n生成 RSS，共 ${items.length} 条`);

const now = new Date().toUTCString();
const body = items
  .map(g => {
    const desc = [g.rating, WITH_COMMENTS ? g.comment : ''].filter(Boolean).join(' ');
    return [
      '  <item>',
      `    <title>${xml(g.title)}</title>`,
      `    <link>${xml(g.url)}</link>`,
      `    <guid isPermaLink="true">${xml(g.url)}</guid>`,
      `    <pubDate>${rfc822(g.date)}</pubDate>`,
      `    <description>${xml(desc)}</description>`,
      '  </item>',
    ].join('\n');
  })
  .join('\n');

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>豆瓣玩过的游戏 · ${xml(USER)}</title>
    <link>${xml(HTML_URL)}</link>
    <description>从豆瓣 Frodo 接口抓取的「玩过」游戏收藏，仅含 game + done。</description>
    <language>zh-CN</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${xml(FEED_URL)}" rel="self" type="application/rss+xml"/>
${body}
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
