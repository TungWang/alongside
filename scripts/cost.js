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
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const FREE_GB = 10; // Firebase Hosting Spark：每月 10 GB 傳輸，超過網站停用至下月

const KB = 1024;

/**
 * 量壓縮後的大小，不是檔案大小。
 *
 * 這裡踩過一次：第一版直接用 fs.statSync 的位元組數，算出來的天花板比實際
 * 悲觀 8.6 倍（每日 457 vs 3,927 人次）。Firebase Hosting 會自動以 Brotli 傳輸，
 * 而 HTML 與 JSON 都是高度重複的文字，壓縮率極高——520 KB 的搜尋索引實際只傳 44 KB。
 * 用錯的數字會導出錯的優化決策，所以一律以壓縮後計算。
 */
const size = (p) => {
  if (!fs.existsSync(p)) return 0;
  return zlib.brotliCompressSync(fs.readFileSync(p), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
};
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
const geo = size(path.join(DIST, 'geo-index.json')) / KB;

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
  { label: '同上，再用一次搜尋', kb: home + assets + avgDistrict + avgInst * 3 + index },
  { label: '同上，改用「附近」', kb: home + assets + avgDistrict + avgInst * 3 + (geo || index) },
];

const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

console.log('\n  建置產物的傳輸成本（Brotli 壓縮後，即實際傳輸量）');
console.log(`    機構頁平均 ${fmt(avgInst)} KB（${instSizes.length} 頁）`);
console.log(`    行政區頁平均 ${fmt(avgDistrict)} KB，最大 ${fmt(maxDistrict)} KB（${distSizes.length} 頁）`);
console.log(`    CSS+JS ${fmt(assets)} KB（首次載入後由瀏覽器快取）`);
console.log(`    搜尋索引 ${fmt(index)} KB ← 點搜尋框才載`);
if (geo) console.log(`    座標索引 ${fmt(geo)} KB ← 開「附近」才載`);

console.log(`\n  免費額度 ${FREE_GB} GB/月　可服務人次（超過網站會被停用到下個月）`);
let tightest = Infinity;
for (const j of journeys) {
  const perMonth = (FREE_GB * 1024 * 1024) / j.kb;
  tightest = Math.min(tightest, perMonth / 30);
  console.log(
    `    ${j.label.padEnd(26, '　')} ${fmt(j.kb).padStart(5)} KB/人 → 每日 ${fmt(perMonth / 30).padStart(6)} 人次`,
  );
}

// 索引已依用途拆成兩包（搜尋不含座標、座標包不含搜尋欄位）。
// 量過：按縣市再分片幾乎沒用——Brotli 對重複的中文壓縮率極高，拆了省不到幾 KB。
// 下一個有意義的做法是把大型行政區頁分頁，或讓索引改成前綴分片，
// 但那要等真的接近上限再說，現在做是過早優化。
const heaviest = Math.max(...journeys.map((j) => j.kb));
const indexShare = Math.max(index, geo) / heaviest;
console.log(`\n  索引佔最重路徑的 ${Math.round(indexShare * 100)}%（兩包已依用途拆開）`);
if (indexShare > 0.6) {
  console.log('    ⚠ 索引又變成主要開銷了，該考慮前綴分片或只載入使用者所在縣市。');
}
console.log(`\n  最保守估計：每日約 ${fmt(tightest)} 人次觸及免費上限`);
console.log('    Spark 方案無法設定用量警示，請定期到 Firebase 主控台 → Hosting → 用量 查看實際數字。\n');
