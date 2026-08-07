// scripts/fetch-data.js
//
// 下載新北市三個托育開放資料集 → 正規化 → 寫出 src/data/institutions.json
//
// 原則（見規劃文件第五節「維持 0 成本的紀律」）：
//   - 只打免金鑰的政府開放資料 API，不呼叫任何付費服務
//   - 地圖與家長評價一律走 Google 地圖「連結」，家長點擊才開啟，本專案零 API 用量
//   - 每次全量重建，不做增量與快取

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'src/data/institutions.json');

const BASE = 'https://data.ntpc.gov.tw/api/datasets';
const PAGE_SIZE = 500;

const SOURCES = [
  {
    key: 'preschool',
    oid: 'f563b4cd-b850-41f5-9709-b910f2d147e9',
    label: '幼兒園',
    kind: 'preschool',
    authority: 'edu', // 主管機關：教育部／新北市教育局
  },
  {
    key: 'nursery',
    oid: '69cecdb0-7796-48df-84e5-99e4f1274245',
    label: '托嬰中心',
    kind: 'nursery',
    authority: 'social', // 主管機關：衛福部／新北市社會局
  },
  {
    key: 'nursery_pub',
    oid: 'b3faf2aa-e96b-4f2f-b647-da47dc094860',
    label: '公共托育中心',
    kind: 'nursery',
    authority: 'social',
  },
];

// ---------------------------------------------------------------------------
// 文字清理
// ---------------------------------------------------------------------------

// 來源資料夾雜換行、全形空白、連續空白，一律先壓平
function squash(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// 「新北市」在來源資料中出現過異體字「巿」（U+5DFF，非 U+5E02），一併處理
const CITY = /新北[市巿]/;

/**
 * 從來源地址取出「街段」——去掉郵遞區號、縣市、行政區、里鄰。
 *
 * 三個資料集格式不同：
 *   幼兒園   [220]新北市板橋區流芳里9鄰東門街30之2號1樓之66、67、68、69
 *   私立托嬰 莊敬路46號2樓
 *   公共托育 樟樹一路137巷26號2樓（少數幾筆混入完整地址或換行）
 *
 * 只在「開頭」剝除，絕不全域取代——實測有街名叫「區運路」，
 * 任何「切到第一個『區』字」的寫法都會把它砍成「運路101號1樓」。
 */
function toStreet(raw, district) {
  let s = squash(raw);
  s = s.replace(/^\[\d+\]\s*/, ''); // [220]
  s = s.replace(new RegExp('^' + CITY.source), ''); // 新北市 / 新北巿
  if (district) s = s.replace(new RegExp('^' + escapeRe(district)), ''); // 板橋區
  s = s.replace(/^[一-鿿]{1,4}里/, ''); // 流芳里
  s = s.replace(/^\d+鄰/, ''); // 9鄰
  return s.trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 行政區：三個資料集欄位名與格式都不同
function toDistrict(row, key) {
  if (key === 'preschool') return squash(row.district); // 「新店區」
  if (key === 'nursery') return squash(row.area).replace(CITY, ''); // 「新北市板橋區」
  return squash(row.town); // 公共托育：「汐止區」
}

// 電話：來源格式為 (02)89681060，補成好讀且可點的形式
function toTel(raw) {
  const s = squash(raw);
  const m = s.match(/^\((\d+)\)\s*(\d+)$/);
  if (!m) return { display: s, href: s.replace(/[^\d+]/g, '') };
  const [, area, rest] = m;
  const pretty = rest.length === 8 ? `${rest.slice(0, 4)}-${rest.slice(4)}` : rest;
  return { display: `(${area}) ${pretty}`, href: `+886-${area.replace(/^0/, '')}-${rest}` };
}

/**
 * 名稱正規化：來源沒有立案字號可當主鍵，跨資料集比對只能靠名稱＋行政區，
 * 所以先把可預期的前後綴差異抹平。
 */
function normalizeName(name) {
  return squash(name)
    .replace(/\s/g, '')
    .replace(/[（）()]/g, '')
    .replace(/^(新北[市巿]|私立|市立|附設)+/, '')
    .trim();
}

/**
 * URL / 檔名安全的 slug。保留中文（中文網址對中文搜尋有利，Google 會解碼顯示），
 * 只把路徑分隔、查詢字元與標點換成連字號。
 */
function slugify(s) {
  return squash(s)
    .replace(/[\/\\?#%&+:;,'"<>|*、，。！？（）()［］\[\]{}~^`$@!=\s]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

// 穩定主鍵：來源的流水號 no 會隨重新發布而變動，不可當永久 ID
function makeId(kind, name, district) {
  return slugify(`${kind}-${normalizeName(name)}-${district}`);
}

// Google 地圖搜尋連結：地圖、導航、家長評價都靠它，本站不呼叫任何 API
function mapsUrl(name, district, street) {
  const query = squash(`${name} 新北市${district}${street}`);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// ---------------------------------------------------------------------------
// 抓取
// ---------------------------------------------------------------------------

async function fetchAll(oid) {
  const rows = [];
  for (let page = 0; ; page++) {
    const url = `${BASE}/${oid}/json?page=${page}&size=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    if (page > 40) throw new Error(`分頁未收斂，疑似 API 行為改變：${oid}`);
  }
  return rows;
}

function normalizeRow(row, src) {
  const name = squash(src.key === 'nursery_pub' ? row.name : row.title);
  const district = toDistrict(row, src.key);
  const street = toStreet(row.address, district);
  const tel = toTel(src.key === 'preschool' ? row.tel : row.localcallservice);

  // 屬性：幼兒園來自 type 欄位（實測 7 種值），托嬰兩個資料集則是固定值
  const ownership =
    src.key === 'preschool' ? squash(row.type) || '其他'
    : src.key === 'nursery_pub' ? '公共托育'
    : '私立';

  return {
    id: makeId(src.kind, name, district),
    kind: src.kind, // preschool | nursery
    category: src.label, // 幼兒園 | 托嬰中心 | 公共托育中心
    authority: src.authority, // edu | social
    name,
    district,
    street,
    address: `新北市${district}${street}`,
    tel: tel.display,
    telHref: tel.href,
    ownership,
    capacity: src.key === 'nursery' && row.person ? Number(row.person) : null,
    operator: squash(row.unit) || null, // 公共托育的受託單位
    mapUrl: mapsUrl(name, district, street),
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const institutions = [];

  for (const src of SOURCES) {
    const rows = await fetchAll(src.oid);
    console.log(`  ${src.label.padEnd(6, '　')} ${String(rows.length).padStart(5)} 筆`);
    for (const row of rows) institutions.push(normalizeRow(row, src));
  }

  // 主鍵唯一性：靜態站一個 id 對應一個檔案，撞名會靜默覆蓋，必須擋在建置前
  const seen = new Map();
  const collisions = [];
  for (const inst of institutions) {
    if (seen.has(inst.id)) collisions.push([inst.id, seen.get(inst.id).name, inst.name]);
    else seen.set(inst.id, inst);
  }
  if (collisions.length) {
    console.error('\n主鍵碰撞，建置中止：');
    for (const [id, a, b] of collisions) console.error(`  ${id}\n    ${a}\n    ${b}`);
    process.exit(1);
  }

  institutions.sort((a, b) => a.district.localeCompare(b.district, 'zh-Hant') || a.name.localeCompare(b.name, 'zh-Hant'));

  const districts = [...new Set(institutions.map((i) => i.district))].sort((a, b) =>
    a.localeCompare(b, 'zh-Hant'),
  );

  const payload = {
    // 資料擷取時間會顯示在每一頁，是本站對家長的誠實聲明，不可省略
    fetchedAt: new Date().toISOString().slice(0, 10),
    total: institutions.length,
    districts,
    institutions,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + '\n');

  console.log(`\n共 ${institutions.length} 間、${districts.length} 個行政區 → ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
