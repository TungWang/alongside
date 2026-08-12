// scripts/smoke.js
//
// 部署完之後，實際連一次線上網站，確認它真的活著。
//
// 為什麼需要：在這之前，「上傳成功但網站壞掉」完全沒有人會發現。
// 51 條驗證檢查的是 dist/ 裡的檔案，部署步驟只回報「上傳沒有出錯」——
// 兩者都不會去看 https://alongside-53f07.web.app 究竟回了什麼。
//
// 檢查的是「這一次部署的內容真的上線了」，不只是「有回 200」：
// 首頁必須帶有這次建置的擷取日期，否則就是 CDN 還在給舊的、或根本沒換上去。
//
// 用法：node scripts/smoke.js（部署之後跑）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { SITE_URL } = await import('../src/lib/site.js');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/institutions.json'), 'utf8'));

const targets = [
  { path: '/', must: DATA.fetchedAt, why: '首頁應含本次建置的擷取日期' },
  { path: '/sitemap-index.xml', must: '<sitemapindex', why: 'sitemap 是搜尋引擎唯一的入口' },
  { path: '/搜尋/', must: 'search-index', why: '搜尋頁應載入索引' },
  { path: '/招生時程/', must: '什麼時候要登記', why: '時效性內容頁' },
];

// 部署到 CDN 全球生效有幾秒的落差，第一次沒中不代表壞了
async function get(url, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise((r) => setTimeout(r, 3000 * i));
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.text();
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.message;
    }
  }
  throw new Error(last);
}

let failed = 0;
for (const t of targets) {
  const url = new URL(t.path, SITE_URL).href;
  try {
    const body = await get(url);
    if (body.includes(t.must)) {
      console.log(`  ✓ ${t.path}`);
    } else {
      failed++;
      console.log(`  ✗ ${t.path}\n      回應了，但找不到「${t.must}」——${t.why}`);
    }
  } catch (err) {
    failed++;
    console.log(`  ✗ ${t.path}\n      連不上：${err}`);
  }
}

console.log(`\n${targets.length - failed} / ${targets.length} 通過`);
if (failed) process.exit(1);
