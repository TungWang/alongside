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
import { primaryFee } from '../src/lib/site.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'src/data/institutions.json');
const INDEX_DIR = path.join(ROOT, 'public');

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

const TAIPEI_DL = 'https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=';

/**
 * 收錄的縣市。
 *
 * 兩類機構的取得方式完全不同，這是擴張成本的來源：
 *
 * 幼兒園——全國同源（全國教保資訊網），封存端已整理成統一格式，加一個縣市幾乎零成本。
 *   但新北市另有市府開放資料，仍以它為骨幹、封存只當加值層：上游若消失，
 *   新北的幼兒園還在（少了收費與裁罰），不會整批不見。臺北市沒有對應的市府開放資料，
 *   只能以封存為骨幹——這個差異在頁面上要說清楚，不能假裝兩市一樣穩。
 *
 * 托嬰中心——各縣市自己發布，平台、格式、欄位全都不同，每加一個縣市就要寫一段剖析。
 */
const CITIES = [
  {
    name: '新北市',
    // 來源資料出現過異體字「巿」（U+5DFF，非 U+5E02），比對時兩種都要吃
    variants: /新北[市巿]/,
    // 幼兒園有市府開放資料可當骨幹
    preschoolOid: 'f563b4cd-b850-41f5-9709-b910f2d147e9',
    nurseries: [
      { adapter: 'ntpc', oid: '69cecdb0-7796-48df-84e5-99e4f1274245', label: '托嬰中心' },
      { adapter: 'ntpc', oid: 'b3faf2aa-e96b-4f2f-b647-da47dc094860', label: '公共托育中心' },
    ],
  },
  {
    name: '臺北市',
    variants: /[臺台]北[市巿]/,
    preschoolOid: null, // 無市府開放資料，幼兒園以封存為骨幹
    nurseries: [
      { adapter: 'taipei', rid: 'e7cdaca3-e9da-46f9-b857-395e6e8e06a6', label: '托嬰中心' },
      { adapter: 'taipei', rid: 'a02ccc34-dd28-4c5d-b527-c5433ec1a453', label: '公設民營托嬰中心' },
    ],
  },
];

// ---------------------------------------------------------------------------
// 網路
// ---------------------------------------------------------------------------

/**
 * 帶重試的 fetch。整條管線每次建置要打四百多次請求，其中大部分打向 GitHub Pages。
 * 在 CI 上更容易遇到限流與瞬斷——本機跑得過不代表 CI 跑得過，這件事實際發生過：
 * 新增分齡收費（4 個 CSV，當時沒有重試）之後第一次 CI 就掛掉，本機與乾淨 checkout
 * 都重現不出來。所以所有對外請求一律走這裡，不要再有裸 fetch。
 *
 * 429 與 5xx 視為可重試；其餘 4xx 直接拋出，因為重試也不會變。
 */
async function fetchWithRetry(url, { attempts = 4, label = url } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise((r) => setTimeout(r, 600 * 2 ** (i - 1)));
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status === 404) return res; // 由呼叫端決定 404 的意義
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`${label}：HTTP ${res.status}（不重試）`);
      }
      last = new Error(`${label}：HTTP ${res.status}`);
    } catch (err) {
      if (/不重試/.test(err.message)) throw err;
      last = err;
    }
  }
  throw new Error(`${label}：重試 ${attempts} 次後仍失敗——${last?.message}`);
}

// ---------------------------------------------------------------------------
// 文字清理
// ---------------------------------------------------------------------------

// 來源資料夾雜換行、全形空白、連續空白，一律先壓平
function squash(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// 任一縣市名的異體字寫法，用於剝除地址前綴
const ANY_CITY = /(新北|[臺台]北)[市巿]/;

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
  s = s.replace(/^\d{5,6}\s*/, ''); // 臺北市托嬰的郵遞區號有時直接接在前面
  s = s.replace(new RegExp('^' + ANY_CITY.source), ''); // 新北市／臺北巿…
  if (district) s = s.replace(new RegExp('^' + escapeRe(district)), ''); // 板橋區
  s = s.replace(/^[一-鿿]{1,4}里/, ''); // 流芳里
  s = s.replace(/^\d+鄰/, ''); // 9鄰
  return s.trim();
}

// 臺北市的托嬰 CSV 沒有行政區欄位，只能從地址剖析
function districtFromAddress(raw) {
  const m = squash(raw).match(/(新北|[臺台]北)[市巿]([一-鿿]{1,3}區)/);
  return m ? m[2] : '';
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 行政區：三個資料集欄位名與格式都不同
function toDistrict(row, key) {
  if (key === 'preschool') return squash(row.district); // 「新店區」
  if (key === 'nursery') return squash(row.area).replace(ANY_CITY, ''); // 「新北市板橋區」
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
    .replace(/^((新北|[臺台]北)[市巿]|私立|市立|附設)+/, '')
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
function mapsUrl(city, name, district, street) {
  const query = squash(`${name} ${city}${district}${street}`);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// ---------------------------------------------------------------------------
// 抓取
// ---------------------------------------------------------------------------

async function fetchAll(oid) {
  const rows = [];
  for (let page = 0; ; page++) {
    const url = `${BASE}/${oid}/json?page=${page}&size=${PAGE_SIZE}`;
    const res = await fetchWithRetry(url, { label: `開放資料 ${oid} 第 ${page} 頁` });
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    if (page > 40) throw new Error(`分頁未收斂，疑似 API 行為改變：${oid}`);
  }
  return rows;
}

/**
 * 統一的機構結構。各縣市各來源的欄位差異都在呼叫端抹平，這裡只組裝。
 */
function makeInstitution({ city, kind, category, name, district, street, tel, ownership, extra = {} }) {
  return {
    id: makeId(kind, name, district),
    city,
    kind, // preschool | nursery
    category, // 幼兒園 | 托嬰中心 | 公共托育中心…
    authority: kind === 'preschool' ? 'edu' : 'social',
    name,
    district,
    street,
    address: `${city}${district}${street}`,
    tel: tel.display,
    telHref: tel.href,
    ownership,
    capacity: null,
    operator: null,
    mapUrl: mapsUrl(city, name, district, street),

    // 以下由 enrich() 從民間封存補上，托嬰中心無對應資料，維持 null
    regNo: null, // 立案／設立許可字號
    approvedCount: null, // 核定招收人數
    fees: null, // 分齡收費，見 fetchFees()
    ages: [], // 有收費資料的年齡＝有收這個年齡
    floorArea: null,
    website: null,
    closed: false,
    penalties: [],
    floorAreaOut: null, // 戶外活動空間
    lat: null, // 托嬰中心無座標來源，維持 null
    lng: null,
    ...extra,
  };
}

/** 新北市開放資料的幼兒園（有市府骨幹的縣市走這條） */
function fromNtpcPreschool(row, city) {
  const district = squash(row.district);
  return makeInstitution({
    city,
    kind: 'preschool',
    category: '幼兒園',
    name: squash(row.title),
    district,
    street: toStreet(row.address, district),
    tel: toTel(row.tel),
    ownership: squash(row.type) || '其他', // 實測 7 種值
  });
}

/** 新北市開放資料的托嬰／公共托育 */
function fromNtpcNursery(row, city, label) {
  const isPublic = label.includes('公共');
  const name = squash(isPublic ? row.name : row.title);
  const district = isPublic ? squash(row.town) : squash(row.area).replace(ANY_CITY, '');
  return makeInstitution({
    city,
    kind: 'nursery',
    category: label,
    name,
    district,
    street: toStreet(row.address, district),
    tel: toTel(row.localcallservice),
    ownership: isPublic ? '公共托育' : '私立',
    extra: {
      capacity: row.person ? Number(row.person) : null,
      operator: squash(row.unit) || null,
    },
  });
}

/**
 * 臺北市開放資料的托嬰。跟新北市的差異：沒有行政區欄位（要從地址剖析）、
 * 私立那份沒有收托人數、機構類型混在同一個欄位裡。
 */
function fromTaipeiNursery(row, city, label) {
  const raw = squash(row['地址']);
  const district = districtFromAddress(raw);
  const type = squash(row['機構類型']);
  return makeInstitution({
    city,
    kind: 'nursery',
    category: label,
    name: squash(row['機構名稱']),
    district,
    street: toStreet(raw, district),
    tel: toTel(squash(row['電話'])),
    ownership: /公設民營|公辦民營/.test(type) ? '公共托育' : '私立',
    extra: { capacity: toInt(row['收托人數']) },
  });
}

async function fetchCsv(url, label) {
  const res = await fetchWithRetry(url, { label });
  const buf = Buffer.from(await res.arrayBuffer());
  return parseCsv(buf.toString('utf8').replace(/^\uFEFF/, '')); // 臺北市的 CSV 帶 BOM
}

/**
 * 收集所有縣市的機構。
 *
 * archive 可能為 null（上游過期或掛掉）。沒有市府骨幹的縣市在那種情況下
 * 會完全沒有幼兒園——這是事實而非 bug，頁面上要照實呈現。
 */
async function fetchInstitutions(archive) {
  const all = [];

  for (const city of CITIES) {
    let preschools = 0;

    if (city.preschoolOid) {
      for (const row of await fetchAll(city.preschoolOid)) {
        all.push(fromNtpcPreschool(row, city.name));
        preschools++;
      }
    } else if (archive) {
      // 封存含已停辦與同名重複，兩者都要處理，否則主鍵會撞：
      //   已停辦（is_active=0）——家長找托育時一間關掉的園是雜訊，不收錄。
      //     實測台北有搬遷案例：舊址停辦、新址營運，兩筆同名，濾掉停辦的正好留下正確那筆。
      //   真重複——同一間園以「臺北市私立X」與「私立X」兩種寫法各出現一次，
      //     立案字號完全相同，以字號去重。
      const seenReg = new Set();
      const rows = (archive.byCity.get(city.name) || []).filter((p) => {
        if (p.is_active === 0) return false;
        const reg = squash(p.reg_no);
        if (reg && seenReg.has(reg)) return false;
        if (reg) seenReg.add(reg);
        return true;
      });
      for (const p of rows) {
        const district = squash(p.town);
        all.push(
          makeInstitution({
            city: city.name,
            kind: 'preschool',
            category: '幼兒園',
            name: squash(p.title),
            district,
            street: toStreet(p.address, district),
            tel: toTel(p.tel),
            ownership: squash(p.type) || '其他',
            extra: { backboneFromArchive: true },
          }),
        );
        preschools++;
      }
    }

    let nurseries = 0;
    for (const src of city.nurseries) {
      if (src.adapter === 'ntpc') {
        for (const row of await fetchAll(src.oid)) {
          all.push(fromNtpcNursery(row, city.name, src.label));
          nurseries++;
        }
      } else {
        for (const row of await fetchCsv(TAIPEI_DL + src.rid, `臺北市 ${src.label}`)) {
          if (!squash(row['機構名稱'])) continue;
          all.push(fromTaipeiNursery(row, city.name, src.label));
          nurseries++;
        }
      }
    }

    const via = city.preschoolOid ? '市府開放資料' : '封存';
    console.log(`  ${city.name}　幼兒園 ${String(preschools).padStart(4)}（${via}）、托嬰 ${nurseries}`);
  }

  return all;
}

// ---------------------------------------------------------------------------
// 民間封存資料（月費、裁罰、立案字號等），只補幼兒園
// ---------------------------------------------------------------------------

// 比對用：封存端與開放資料端的機構名稱寫法略有出入，去掉空白與括號後可 100% 對上
const matchKey = (name) => squash(name).replace(/\s/g, '').replace(/[（）()]/g, '');

/**
 * 卡片與清單上顯示哪一個年齡的費用：一律用「有資料的最小年齡」。
 * 本站的對象是 0–3 歲家長，最小年齡跟他們最相關；而且各齡價差可達三千以上，
 * 給一個沒標年齡的數字等於沒說。回傳一定帶 age，UI 必須把年齡印出來。
 */
const inRange = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;
const round6 = (v) => Math.round(v * 1e6) / 1e6; // 約 0.1 公尺精度，足夠且省檔案大小

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
/**
 * 抓單一機構的裁罰明細。
 *
 * 每次建置要打四百多次，網路抖一下是常態。這裡的關鍵是要分辨兩種 404：
 * 「這間真的沒有裁罰紀錄」和「這次沒抓到」——前者回空陣列是對的，
 * 後者若也回空陣列，就會讓一間有紀錄的園所無聲變成清白，那是最糟的失敗方式。
 * 所以非 404 的錯誤會重試，重試完仍失敗就 throw，由呼叫端統計並決定是否中止建置。
 */
async function fetchPenalties(city, title) {
  const url = `${ARCHIVE}/data/punish/${encodeURIComponent(city)}/${encodeURIComponent(title)}.json`;

  const res = await fetchWithRetry(url, { label: `裁罰明細（${title}）` });
  if (res.status === 404) return []; // 明確地「這間沒有紀錄」
  return toPenaltyRows(await res.json());
}

function toPenaltyRows(rows) {
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
  const res = await fetchWithRetry(`${ARCHIVE}/preschools.json`, { label: '封存主檔' });
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
  const wanted = new Set(CITIES.map((c) => c.name));
  const byName = new Map();
  const byCity = new Map(CITIES.map((c) => [c.name, []]));
  for (const feature of geo.features || []) {
    const p = feature.properties || {};
    if (!wanted.has(p.city)) continue;
    byCity.get(p.city).push(p);
    // 座標來自封存端以國土測繪中心 API 做的 geocoding（GeoJSON 為 [lng, lat] 順序）。
    // 原規劃文件說「三個資料集全都沒有經緯度所以不做地圖」——那是指政府開放資料，
    // 封存端補上了，因此距離排序現在做得到，且完全不需要呼叫任何地圖 API。
    const c = feature.geometry?.coordinates;
    const key = matchKey(p.title);
    // 同名機構會互相覆蓋。實測臺北市有搬遷案例：舊址已停辦、新址營運中，兩筆同名，
    // 後寫入的若是停辦那筆，就會把停辦的座標、立案字號與收費掛到營運中的機構上。
    // 一律以營運中的那筆為準。
    const prev = byName.get(key);
    if (prev && prev.is_active === 1 && p.is_active !== 1) continue;
    byName.set(key, { ...p, _lng: c?.[0], _lat: c?.[1] });
  }

  return { byName, byCity, updatedAt: updatedAt.toISOString().slice(0, 10), ageDays };
}

/**
 * 極簡 CSV 解析。來源是政府彙總資料，欄位單純，但機構名稱可能含逗號，
 * 所以還是要處理雙引號包住的欄位。
 */
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(head.map((h, i) => [h.trim(), (cells[i] || '').trim()]));
  });
}

/**
 * 分齡收費。
 *
 * 欄位語意是用封存端的收費明細表（slip114，園所依法申報的原始文件）反推並驗證的：
 *   monthly1 = total1 ÷ months                    （40/40 樣本成立）
 *   全學期總收費 = 學費＋雜費＋材料費＋活動費＋午餐費＋點心費（20/20 成立）
 *   total1 = 上學期總收費 × 2                      （19/20 成立）
 *   total2 = 課後延托費 × 2                        （17/20 成立）
 *
 * 所以 monthly1 是「每月必繳費用」，未扣任何政府補助，不含交通費與課後延托費；
 * monthly2 是課後延托費的月攤，屬選繳——一開始誤以為那是補助，驗證後推翻。
 *
 * 之所以改用這份而不用封存 GeoJSON 的 monthly 欄位：後者對 1,057 間中的 782 間
 * （74%）對不上任何年齡的實際收費，也不是各齡平均，來源無法解釋。
 * 一個講不出根據的金額不該掛在家長要拿來評估預算的頁面上。
 */
const FEE_AGES = ['2', '3', '4', '5'];

async function fetchFees() {
  const byName = new Map();
  for (const city of CITIES) {
  for (const age of FEE_AGES) {
    const url = `${ARCHIVE}/data/summary1/${encodeURIComponent(city.name)}/${age}.csv`;
    const res = await fetchWithRetry(url, { label: `${city.name} 分齡收費 ${age} 歲` });
    if (!res.ok) throw new Error(`分齡收費下載失敗（${city.name} ${age} 歲）：${res.status}`);
    for (const row of parseCsv(await res.text())) {
      const monthly = toInt(row.monthly1);
      if (!row.point || !monthly) continue;
      const key = matchKey(row.point);
      if (!byName.has(key)) byName.set(key, {});
      byName.get(key)[age] = {
        monthly, // 每月必繳
        months: Number(row.months) || null, // 一年收費幾個月
        yearly: toInt(row.total1), // 全年必繳
        afterHours: toInt(row.monthly2), // 課後延托，選繳
      };
    }
  }
  }
  return byName;
}

async function enrich(institutions, archive) {
  if (!archive) return { enriched: 0, withFees: 0, penaltyCount: 0, archive: null };

  const fees = await fetchFees();
  const preschools = institutions.filter((i) => i.kind === 'preschool');
  let enriched = 0;
  let withFees = 0;

  for (const inst of preschools) {
    const p = archive.byName.get(matchKey(inst.name));
    if (!p) continue;
    enriched++;
    inst.regNo = squash(p.reg_docno) || squash(p.reg_no) || null;
    inst.approvedCount = toInt(p.count_approved);

    inst.floorArea = squash(p.size) || null;
    inst.website = safeWebsite(p.url);
    inst.closed = p.is_active === 0;
    inst.floorAreaOut = squash(p.size_out) || null;
    // 只收在新北市合理範圍內的座標，避免 geocoding 失敗落到海上或別的縣市
    if (inRange(p._lat, 24.6, 25.4) && inRange(p._lng, 121.0, 122.2)) {
      inst.lat = round6(p._lat);
      inst.lng = round6(p._lng);
    }
    inst._hasPenalty = squash(p.penalty) !== '' && squash(p.penalty) !== '無';
  }

  for (const inst of preschools) {
    const f = fees.get(matchKey(inst.name));
    if (!f) continue;
    withFees++;
    inst.fees = f;
    // 有這個年齡的收費資料，就代表這間收這個年齡的孩子
    inst.ages = FEE_AGES.filter((a) => f[a]).map(Number);
  }

  // 只對標記有裁罰的機構抓明細，省掉九成請求
  const targets = preschools.filter((i) => i._hasPenalty);
  const results = await mapLimit(targets, 5, async (inst) => {
    try {
      return await fetchPenalties(inst.city, inst.name);
    } catch (err) {
      return err; // 先收集，全部跑完再一起判斷，避免一筆失敗就中斷四百多次請求
    }
  });

  const failures = results.filter((r) => r instanceof Error);
  if (failures.length) {
    console.error(`\n  ${failures.length} / ${targets.length} 間的裁罰明細抓取失敗：`);
    for (const err of failures.slice(0, 5)) console.error(`    ${err.message}`);
    // 少數失敗容忍（該園顯示為無紀錄，並非理想但可接受）；大量失敗代表上游有狀況，
    // 這時寧可讓建置失敗，也不要把幾百間有紀錄的園所publish成清白。
    if (failures.length > targets.length * 0.05) {
      throw new Error('裁罰明細失敗比例過高，中止建置以免發布錯誤資訊');
    }
    console.error('  失敗比例在容忍範圍內，該些機構本次顯示為無紀錄');
  }

  let penaltyCount = 0;
  targets.forEach((inst, i) => {
    inst.penalties = results[i] instanceof Error ? [] : results[i];
    penaltyCount += inst.penalties.length;
  });
  for (const inst of preschools) delete inst._hasPenalty;

  return {
    enriched,
    withFees,
    penaltyCount,
    institutionsWithPenalty: targets.filter((i) => i.penalties.length).length,
    archive: { ...ARCHIVE_CREDIT, updatedAt: archive.updatedAt },
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  // 封存要先抓：沒有市府開放資料的縣市（臺北市）拿它當幼兒園骨幹
  console.log('  下載民間封存…');
  const archive = await fetchArchive();

  const institutions = await fetchInstitutions(archive);

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
  const meta = await enrich(institutions, archive);

  // 跟裁罰抓取同一類的防護：上游若改欄位名或資料結構，比對會靜靜地全部落空，
  // 整站的月費與裁罰就無聲消失。與其發布一個「看起來正常但少了一半資料」的網站，
  // 不如讓建置失敗。實測正常情況是 100% 對上。
  const preschoolCount = institutions.filter((i) => i.kind === 'preschool').length;
  if (meta.archive && meta.enriched < preschoolCount * 0.8) {
    throw new Error(
      `封存資料只對上 ${meta.enriched} / ${preschoolCount} 間，低於 80%，疑似上游格式變更，中止建置`,
    );
  }
  if (meta.archive) {
    console.log(
      `  對上 ${meta.enriched} 間，其中 ${meta.withFees} 間有分齡收費、${meta.institutionsWithPenalty} 間有裁罰共 ${meta.penaltyCount} 筆（封存更新於 ${meta.archive.updatedAt}）`,
    );
  }

  institutions.sort(
    (a, b) =>
      a.city.localeCompare(b.city, 'zh-Hant') ||
      a.district.localeCompare(b.district, 'zh-Hant') ||
      a.name.localeCompare(b.name, 'zh-Hant'),
  );

  const districts = [...new Set(institutions.map((i) => i.district))].sort((a, b) =>
    a.localeCompare(b, 'zh-Hant'),
  );

  // 每個縣市的幼兒園骨幹來自哪裡，頁面上要照實說明資料韌性的差異
  const cities = CITIES.map((c) => {
    const list = institutions.filter((i) => i.city === c.name);
    return {
      name: c.name,
      total: list.length,
      preschools: list.filter((i) => i.kind === 'preschool').length,
      nurseries: list.filter((i) => i.kind === 'nursery').length,
      districts: [...new Set(list.map((i) => i.district))].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
      preschoolBackbone: c.preschoolOid ? 'open-data' : 'archive',
    };
  }).filter((c) => c.total > 0);

  const payload = {
    // 資料擷取時間會顯示在每一頁，是本站對家長的誠實聲明，不可省略
    fetchedAt: new Date().toISOString().slice(0, 10),
    total: institutions.length,
    cities,
    districts,
    archive: meta.archive, // 民間封存的出處與更新日；為 null 表示本次未採用
    institutions,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + '\n');

  /**
   * 索引依「用途」拆成兩包，不是依縣市。
   *
   * 量過才知道：按縣市分片幾乎沒用——Brotli 對重複的中文壓縮率極高，
   * 整包 520 KB 壓完只有 44 KB，拆成兩市各一包省不到幾 KB。
   * 真正的浪費是搜尋頁一直在下載它從來不用的座標（2,488 筆各兩個浮點數，
   * 而浮點數正好是壓縮率最差的東西）。
   *
   * 所以搜尋索引不含座標，座標索引只含有座標的那些，兩邊各拿各的。
   * 兩包都放 public/，由頁面在使用者互動時才抓，不影響首次載入。
   */
  const common = (i) => ({
    i: i.id,
    n: i.name,
    d: i.district,
    o: i.ownership,
    m: primaryFee(i)?.monthly || 0,
    a: primaryFee(i)?.age || 0,
    p: i.penalties.length,
  });

  const index = institutions.map((i) => ({ ...common(i), ct: i.city, c: i.category }));
  const geoIndex = institutions
    .filter((i) => i.lat)
    .map((i) => ({ ...common(i), y: i.lat, x: i.lng }));
  await fs.mkdir(INDEX_DIR, { recursive: true });
  await fs.writeFile(path.join(INDEX_DIR, 'search-index.json'), JSON.stringify(index));
  await fs.writeFile(path.join(INDEX_DIR, 'geo-index.json'), JSON.stringify(geoIndex));
  const kb = Math.round(Buffer.byteLength(JSON.stringify(index)) / 1024);
  const geoKb = Math.round(Buffer.byteLength(JSON.stringify(geoIndex)) / 1024);
  console.log(
    `搜尋索引 ${index.length} 筆 ${kb} KB、座標索引 ${geoIndex.length} 筆 ${geoKb} KB（未壓縮）`,
  );

  console.log(
    `\n共 ${institutions.length} 間、${cities.length} 個縣市、${districts.length} 個行政區 → ${path.relative(ROOT, OUT_FILE)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
