// scripts/cost.js
//
// 用實際的建置產物推估「免費額度還能撐多少人」。
//
// 為什麼需要這個：Firebase 的 Spark 免費方案**無法設定用量警示**（那是 Blaze 限定），
// 主控台的用量頁只能自己去看。而超過每月 10 GB 的後果是「網站被停用到下個月」，
// 不是收費——對一個家長臨時搜尋才會用到的網站，斷線比帳單糟。
//
// 所以這支腳本在每次建置後把數字印出來：頁面變重、索引變大、收錄範圍擴張時，
// 天花板會跟著往下掉，你會在 log 裡先看到，而不是等到網站被關掉才知道。
//
// 用法：npm run cost（build 之後會自動跑一次）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const FREE_GB = 10; // Firebase Hosting Spark：每月 10 GB 傳輸，超過網站停用至下月

const KB = 1024;
const size = (p) => (fs.existsSync(p) ? fs.statSync(p).size : 0);
const dirSizes = (glob) =>
  fs.existsSync(path.join(DIST, glob))
    ? fs
        .readdirSync(path.join(DIST, glob))
        .map((d) => size(path.join(DIST, glob, d, 'index.html')))
        .filter(Boolean)
    : [];

const instSizes = dirSizes('i');
const distSizes = dirSizes('d');
const avgInst = instSizes.reduce((a, b) => a + b, 0) / instSizes.length / KB;
const avgDistrict = distSizes.reduce((a, b) => a + b, 0) / distSizes.length / KB;
const maxDistrict = Math.max(...distSizes) / KB;
const home = size(path.join(DIST, 'index.html')) / KB;
const index = size(path.join(DIST, 'search-index.json')) / KB;

const assets = fs.existsSync(path.join(DIST, '_astro'))
  ? fs
      .readdirSync(path.join(DIST, '_astro'))
      .filter((f) => /\.(css|js)$/.test(f))
      .reduce((sum, f) => sum + size(path.join(DIST, '_astro', f)), 0) / KB
  : 0;

/**
 * 三種訪客行為。中間那種最接近真實：家長從搜尋進來、看一個行政區、點幾間機構。
 * 「用了搜尋」單獨列出來，因為搜尋索引是目前最大的單一開銷。
 */
const journeys = [
  { label: '看一頁就離開', kb: home + assets },
  { label: '首頁→行政區→3 間機構', kb: home + assets + avgDistrict + avgInst * 3 },
  { label: '同上，再用一次搜尋或「附近」', kb: home + assets + avgDistrict + avgInst * 3 + index },
];

const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

console.log('\n  建置產物的傳輸成本');
console.log(`    機構頁平均 ${fmt(avgInst)} KB（${instSizes.length} 頁）`);
console.log(`    行政區頁平均 ${fmt(avgDistrict)} KB，最大 ${fmt(maxDistrict)} KB（${distSizes.length} 頁）`);
console.log(`    CSS+JS ${fmt(assets)} KB（首次載入後由瀏覽器快取）`);
console.log(`    搜尋索引 ${fmt(index)} KB ← 點搜尋框或開「附近」就整包下載`);

console.log(`\n  免費額度 ${FREE_GB} GB/月　可服務人次（超過網站會被停用到下個月）`);
let tightest = Infinity;
for (const j of journeys) {
  const perMonth = (FREE_GB * 1024 * 1024) / j.kb;
  tightest = Math.min(tightest, perMonth / 30);
  console.log(
    `    ${j.label.padEnd(26, '　')} ${fmt(j.kb).padStart(5)} KB/人 → 每日 ${fmt(perMonth / 30).padStart(6)} 人次`,
  );
}

// 搜尋索引一旦大到蓋過頁面本身，就該分片了——這是擴張時第一個會撞到的牆
const indexShare = index / journeys[2].kb;
console.log(`\n  搜尋索引佔「有用搜尋」那條路徑的 ${Math.round(indexShare * 100)}%`);
if (indexShare > 0.5) {
  console.log('    ⚠ 已超過一半。再擴充收錄範圍前應先把索引改成分縣市載入，否則額度會被它吃光。');
}
console.log(`\n  最保守估計：每日約 ${fmt(tightest)} 人次觸及免費上限`);
console.log('    Spark 方案無法設定用量警示，請定期到 Firebase 主控台 → Hosting → 用量 查看實際數字。\n');
