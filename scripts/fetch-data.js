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

// 民間封存：g0v 江明宗（kiang）長期備份全國教保資訊網的幼兒園資料。
// 政府開放資料沒有月費與裁罰，這是目前唯一結構化、可程式取用的來源。
// 只補幼兒園，托嬰中心無對應資料。詳見 README「資料來源與其限制」。
const ARCHIVE = 'https://kiang.github.io/ap.ece.moe.edu.tw';
const ARCHIVE_CREDIT = {
  name: '台灣幼兒園地圖封存資料',
  author: '江明宗 kiang',
  url: 'https://github.com/kiang/ap.ece.moe.edu.tw',
  license: 'MIT',
  origin: '全國教保資訊網',
};
// 封存超過這個天數就不採用——上游停止維護時要讓資料消失，而不是無聲變舊
const ARCHIVE_MAX_AGE_DAYS = 120;

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

    // 以下由 enrich() 從民間封存補上，托嬰中心無對應資料，維持 null
    regNo: null, // 立案／設立許可字號
    approvedCount: null, // 核定招收人數
    monthly: null, // 平均月費
    floorArea: null,
    website: null,
    closed: false,
    penalties: [],
  };
}

// ---------------------------------------------------------------------------
// 民間封存資料（月費、裁罰、立案字號等），只補幼兒園
// ---------------------------------------------------------------------------

// 比對用：封存端與開放資料端的機構名稱寫法略有出入，去掉空白與括號後可 100% 對上
const matchKey = (name) => squash(name).replace(/\s/g, '').replace(/[（）()]/g, '');

const toInt = (v) => {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * 受處分人只保留角色，不保留姓名。
 *
 * 來源是「負責人：黃桂貞」「行為人：某某」這種格式，全市共 477 位可識別自然人。
 * 家長選園在意的是機構，不是某個人的姓名；而公開自然人的裁罰紀錄——尤其官方公告
 * 已下架之後——涉及個資與名譽，風險遠高於它帶來的價值。
 * 在這裡就砍掉，姓名不會進入 institutions.json，也不會進到版控。
 * 保留角色是有意義的：「行為人」表示是教保人員個人的行為，「負責人」是經營者。
 */
function toRole(raw) {
  const role = squash(raw).split(/[：:]/)[0].trim();
  return ['負責人', '行為人', '代表人'].includes(role) ? role : null;
}

/**
 * 園所網站：來源夾雜學校內網 IP、缺 TLD 的殘缺網址、短網址與已停止服務的平台。
 * 這些連結對家長沒有用，短網址更等於把人送去我們沒看過的目的地，一律不輸出。
 */
const DEAD_HOSTS = ['wretch.cc', 'myblog.yahoo.com', 'blogkids.net', 'mypaper.pchome.com.tw'];
const SHORTENERS = ['reurl.cc', 'pse.is', 'bit.ly', 'lihi.cc', 'goo.gl', 'tinyurl.com'];

function safeWebsite(raw) {
  let url;
  try {
    url = new URL(squash(raw));
  } catch {
    return null; // 「http://blog」「http://http://…」這類殘缺網址在這裡就被擋下
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  // 帶帳號密碼的網址一律不要。來源實際出現過 http:/someone@yahoo.com.tw——
  // 那其實是打錯的電子郵件地址，會被解析成 userinfo，既洩漏個資又是釣魚連結的形態。
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  if (!host.includes('.')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null; // 學校內網 IP
  if (SHORTENERS.some((s) => host === s || host.endsWith(`.${s}`))) return null;
  if (DEAD_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) return null;

  // 輸出正規化後的網址，不是原始字串——來源有「http:www.example.tw/」這種
  // 少寫斜線的寫法，直接輸出會變成點不開的死連結。
  return url.href;
}

/**
 * 處分欄位不一定是罰鍰，也可能是「停止招生：2026/04/24~2027/04/23」這種期間，
 * 或「公布姓名」這種沒有數值的處分。只有明確標示罰鍰時才解析金額——
 * 否則會把日期區間的數字串成天文數字。
 */
function parseSanction(raw) {
  const text = squash(raw);
  const fine = text.match(/罰鍰[：:]\s*([\d,]+)\s*元/);
  const kind = text.split(/[：:]/)[0].trim() || '其他處分';
  return { text, kind, fineAmount: fine ? toInt(fine[1]) : null };
}

// 併發抓取，避免一次打太多請求
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * 裁罰明細：封存端以「縣市／機構全名.json」存放，每筆是一個陣列
 *   [日期, 裁處書字號, 法條, 違反內容, 受處分人, 罰鍰]
 */
async function fetchPenalties(title) {
  const url = `${ARCHIVE}/data/punish/${encodeURIComponent('新北市')}/${encodeURIComponent(title)}.json`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((r) => Array.isArray(r) && r.length >= 6)
    .map(([date, docNo, statute, description, person, sanction]) => {
      const s = parseSanction(sanction);
      return {
        date: squash(date),
        docNo: squash(docNo),
        statute: squash(statute),
        description: squash(description),
        role: toRole(person), // 只留「負責人」／「行為人」，姓名不輸出
        sanction: s.text, // 原文，例如「罰鍰：60,000元」或「停止招生：2026/04/24~2027/04/23」
        sanctionKind: s.kind, // 罰鍰 / 停止招生 / 減少招收人數 …
        fineAmount: s.fineAmount, // 僅罰鍰有值
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

async function fetchArchive() {
  const res = await fetch(`${ARCHIVE}/preschools.json`);
  if (!res.ok) throw new Error(`封存資料下載失敗：${res.status}`);

  // 上游停更就整批不採用，寧可少顯示也不要給家長過期資訊
  const lastModified = res.headers.get('last-modified');
  const updatedAt = lastModified ? new Date(lastModified) : null;
  const ageDays = updatedAt ? Math.floor((Date.now() - updatedAt) / 86400000) : Infinity;
  if (ageDays > ARCHIVE_MAX_AGE_DAYS) {
    console.warn(`  封存資料已 ${ageDays} 天未更新，超過 ${ARCHIVE_MAX_AGE_DAYS} 天上限，本次不採用`);
    return null;
  }

  const geo = await res.json();
  const byName = new Map();
  for (const feature of geo.features || []) {
    const p = feature.properties || {};
    if (p.city !== '新北市') continue;
    byName.set(matchKey(p.title), p);
  }

  return { byName, updatedAt: updatedAt.toISOString().slice(0, 10), ageDays };
}

async function enrich(institutions) {
  const archive = await fetchArchive();
  if (!archive) return { enriched: 0, penaltyCount: 0, archive: null };

  const preschools = institutions.filter((i) => i.kind === 'preschool');
  let enriched = 0;

  for (const inst of preschools) {
    const p = archive.byName.get(matchKey(inst.name));
    if (!p) continue;
    enriched++;
    inst.regNo = squash(p.reg_docno) || squash(p.reg_no) || null;
    inst.approvedCount = toInt(p.count_approved);
    inst.monthly = toInt(p.monthly);
    inst.floorArea = squash(p.size) || null;
    inst.website = safeWebsite(p.url);
    inst.closed = p.is_active === 0;
    inst._hasPenalty = squash(p.penalty) !== '' && squash(p.penalty) !== '無';
  }

  // 只對標記有裁罰的機構抓明細，省掉九成請求
  const targets = preschools.filter((i) => i._hasPenalty);
  const results = await mapLimit(targets, 8, (inst) => fetchPenalties(inst.name));

  let penaltyCount = 0;
  targets.forEach((inst, i) => {
    inst.penalties = results[i];
    penaltyCount += results[i].length;
  });
  for (const inst of preschools) delete inst._hasPenalty;

  return {
    enriched,
    penaltyCount,
    institutionsWithPenalty: targets.filter((i) => i.penalties.length).length,
    archive: { ...ARCHIVE_CREDIT, updatedAt: archive.updatedAt },
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

  console.log('\n  補充月費與裁罰（民間封存）…');
  const meta = await enrich(institutions);
  if (meta.archive) {
    console.log(
      `  對上 ${meta.enriched} 間，其中 ${meta.institutionsWithPenalty} 間有裁罰、共 ${meta.penaltyCount} 筆（封存更新於 ${meta.archive.updatedAt}）`,
    );
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
    archive: meta.archive, // 民間封存的出處與更新日；為 null 表示本次未採用
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
