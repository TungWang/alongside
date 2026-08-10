// scripts/verify.js
//
// 對建置產物做檢查。每一條都對應一個真的發生過的問題——
// 這些不是理論上的風險，是開發過程中實際踩到、修好之後不希望再回來的。
//
// 用法：npm run verify（會在 npm run build 之後自動跑，CI 也會跑）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/institutions.json'), 'utf8'));

const read = (p) => fs.readFileSync(path.join(DIST, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(DIST, p));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allFiles = walk(DIST);
const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));
const htmlCache = new Map();
const html = (f) => {
  if (!htmlCache.has(f)) htmlCache.set(f, fs.readFileSync(f, 'utf8'));
  return htmlCache.get(f);
};

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

// --- 資料完整性 ---------------------------------------------------------

check('三個資料集都有資料', () => {
  const byCat = {};
  for (const i of DATA.institutions) byCat[i.category] = (byCat[i.category] || 0) + 1;
  const missing = ['幼兒園', '托嬰中心', '公共托育中心'].filter((c) => !byCat[c]);
  return missing.length ? `缺少：${missing.join('、')}` : true;
});

check('主鍵無碰撞', () => {
  const seen = new Set();
  for (const i of DATA.institutions) {
    if (seen.has(i.id)) return `重複的 id：${i.id}`;
    seen.add(i.id);
  }
  return true;
});

// 曾經：幼兒園地址含「[220]新北市板橋區流芳里9鄰」，直接拿去組 Google 連結會重複又帶方括號。
// 注意不能單看開頭有沒有「里」——「阿里荖」「萬里加投」「嘉寶里22號」都是真實地名，
// 剝除成功後仍以這些字開頭。只有「X里」後面緊接「N鄰」才是沒剝乾淨的證據。
check('地址已正規化，無郵遞區號／縣市／里鄰殘留', () => {
  const bad = DATA.institutions.filter(
    (i) =>
      /^\[/.test(i.street) ||
      /新北[市巿]/.test(i.street) ||
      i.street.startsWith(i.district) ||
      /^[一-鿿]{1,4}里\s*\d+鄰/.test(i.street) ||
      /^\d+鄰/.test(i.street),
  );
  return bad.length ? `${bad.length} 筆殘留，例如 ${bad[0].street}` : true;
});

// 反向保護：地名本身含「里」不該被吃掉。這幾筆的原始地址是「草里里4鄰阿里荖…」，
// 剝除若過度貪婪就會變成「荖33-1號」。
check('地名中的「里」未被誤砍', () => {
  const expect = ['阿里荖', '萬里加投', '嘉寶里'];
  const missing = expect.filter((p) => !DATA.institutions.some((i) => i.street.startsWith(p)));
  return missing.length ? `找不到以 ${missing.join('、')} 開頭的地址，疑似被誤砍` : true;
});

// 曾經：街名「區運路」被「切到第一個區字」的寫法砍成「運路」
check('街名含「區」者未被誤切', () => {
  const ok = DATA.institutions.some((i) => i.street.startsWith('區運路'));
  return ok || '找不到區運路，可能被誤切或資料變動';
});

// --- 個資 ---------------------------------------------------------------

check('資料檔不含自然人姓名', () => {
  const blob = JSON.stringify(DATA);
  for (const kw of ['負責人：', '行為人：', '代表人：']) {
    if (blob.includes(kw)) return `institutions.json 仍含「${kw}」`;
  }
  return true;
});

check('產出的頁面不含自然人姓名', () => {
  const hit = htmlFiles.filter((f) => /(負責人|行為人|代表人)：/.test(html(f)));
  return hit.length ? `${hit.length} 頁仍含姓名，例如 ${path.relative(DIST, hit[0])}` : true;
});

// --- 對外連結衛生 -------------------------------------------------------

// 曾經：來源含學校內網 IP、短網址，以及打錯成 email 的 http:/someone@yahoo.com.tw
check('園所連結無內網 IP／短網址／帳號資訊', () => {
  const bad = [];
  for (const i of DATA.institutions) {
    if (!i.website) continue;
    let u;
    try {
      u = new URL(i.website);
    } catch {
      bad.push(i.website);
      continue;
    }
    const h = u.hostname;
    if (u.username || u.password) bad.push(i.website);
    else if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || !h.includes('.')) bad.push(i.website);
    else if (['reurl.cc', 'pse.is', 'wretch.cc'].some((s) => h.endsWith(s))) bad.push(i.website);
  }
  return bad.length ? `${bad.length} 筆有問題，例如 ${bad[0]}` : true;
});

check('所有外部連結都帶 rel="noopener"', () => {
  const sample = ['index.html', 'd/板橋區/index.html', 'i/preschool-悅淨幼兒園-板橋區/index.html'];
  for (const p of sample) {
    if (!exists(p)) return `找不到 ${p}`;
    for (const a of read(p).match(/<a [^>]*href="https?:\/\/[^"]+"[^>]*>/g) || []) {
      if (!a.includes('rel=')) return `${p} 有未帶 rel 的外連：${a.slice(0, 70)}`;
    }
  }
  return true;
});

// --- 裁罰資料的正確性 ---------------------------------------------------

// 曾經：把「停止招生：2026/04/24~2027/04/23」的日期串成 2026042420270423 元
check('罰鍰金額在合理範圍', () => {
  const fines = DATA.institutions.flatMap((i) => i.penalties.map((p) => p.fineAmount)).filter(Boolean);
  const max = Math.max(...fines);
  return max <= 1_000_000 ? true : `最高罰鍰 ${max.toLocaleString('en-US')} 元，疑似解析錯誤`;
});

check('非罰鍰的處分不應有金額', () => {
  const bad = DATA.institutions
    .flatMap((i) => i.penalties)
    .filter((p) => p.sanctionKind !== '罰鍰' && p.fineAmount);
  return bad.length ? `${bad.length} 筆非罰鍰卻有金額，例如「${bad[0].sanction}」` : true;
});

// --- 主管機關分流 -------------------------------------------------------

// 幼兒園歸教育部、托嬰歸衛福部，兩套系統不能給錯
check('幼兒園頁只給教育部連結', () => {
  const bad = htmlFiles.filter(
    (f) => f.includes('/i/preschool-') && html(f).includes('sw.ntpc.gov.tw'),
  );
  return bad.length ? `${bad.length} 頁誤含社會局連結` : true;
});

check('托嬰頁只給社會局連結', () => {
  const bad = htmlFiles.filter(
    (f) => f.includes('/i/nursery-') && html(f).includes('ap.ece.moe.edu.tw'),
  );
  return bad.length ? `${bad.length} 頁誤含教育部連結` : true;
});

// --- 頁面結構 -----------------------------------------------------------

check('頁數符合資料筆數', () => {
  const inst = htmlFiles.filter((f) => f.includes(`${path.sep}i${path.sep}`)).length;
  const dist = htmlFiles.filter((f) => f.includes(`${path.sep}d${path.sep}`)).length;
  if (inst !== DATA.total) return `機構頁 ${inst}，應為 ${DATA.total}`;
  if (dist !== DATA.districts.length) return `行政區頁 ${dist}，應為 ${DATA.districts.length}`;
  return true;
});

check('每頁都有 canonical 與 description', () => {
  const bad = htmlFiles.filter(
    (f) => !html(f).includes('rel="canonical"') || !html(f).includes('name="description"'),
  );
  return bad.length ? `${bad.length} 頁缺少` : true;
});

check('canonical 指向正式網域', () => {
  const bad = htmlFiles.filter((f) => html(f).includes('alongside-tw.web.app'));
  return bad.length ? `${bad.length} 頁仍指向範例網域` : true;
});

// 曾經：只在有裁罰時渲染區塊，家長無從分辨「查過沒有」與「根本沒查」
check('機構頁一律有收費與裁罰兩個區塊', () => {
  const sample = [
    'i/preschool-維珍妮幼兒園-五股區/index.html', // 有裁罰的幼兒園
    'i/preschool-悅淨幼兒園-板橋區/index.html', // 幼兒園
    'i/nursery-汐止忠厚公共托育中心-汐止區/index.html', // 托嬰，兩者皆無資料
  ];
  for (const p of sample) {
    if (!exists(p)) return `找不到 ${p}`;
    const h = read(p);
    if (!h.includes('>收費</h2>')) return `${p} 缺少收費區塊`;
    if (!h.includes('裁罰紀錄')) return `${p} 缺少裁罰區塊`;
  }
  return true;
});

check('全站都有資料聲明與授權頁連結', () => {
  const bad = htmlFiles.filter(
    (f) => !html(f).includes('程式自動整理') || !html(f).includes('/授權/'),
  );
  return bad.length ? `${bad.length} 頁缺少` : true;
});

// --- 樣式與資產 ---------------------------------------------------------

// 曾經：.inst-card{display:flex} 蓋掉 UA 的 [hidden]{display:none}，篩選按了沒反應
check('[hidden] 有 !important 保護', () => {
  const css = allFiles.filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(f, 'utf8'));
  return css.some((c) => c.replace(/\s/g, '').includes('[hidden]{display:none!important'))
    ? true
    : '找不到 [hidden] 的 !important 規則，篩選功能會失效';
});

check('無圖片／字型／媒體檔，無外部字型請求', () => {
  const assets = allFiles.filter(
    (f) => !/\.(html|xml|txt|css|js|json)$/.test(f),
  );
  if (assets.length) return `含非文字資產：${assets.map((f) => path.relative(DIST, f)).join(', ')}`;
  const css = allFiles.filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(f, 'utf8'));
  if (css.some((c) => c.includes('@font-face') || c.includes('fonts.g'))) return '含外部字型請求';
  return true;
});

check('無 <img> 標籤', () => {
  const bad = htmlFiles.filter((f) => html(f).includes('<img'));
  return bad.length ? `${bad.length} 頁含 <img>` : true;
});

// 曾經：JSX 換行讓全形句號後多出一個空白
check('無全形標點後的多餘空白', () => {
  const bad = [];
  for (const f of htmlFiles) {
    const t = html(f)
      .replace(/<(script|style|pre)[^>]*>[\s\S]*?<\/\1>/g, '')
      .replace(/<[^>]+>/g, '');
    if (/[。，、；：）]\s+\S/.test(t)) bad.push(path.relative(DIST, f));
  }
  return bad.length ? `${bad.length} 頁有多餘空白，例如 ${bad[0]}` : true;
});

// --- 搜尋 ---------------------------------------------------------------

check('搜尋索引存在且筆數相符', () => {
  if (!exists('search-index.json')) return '缺少 search-index.json';
  const idx = JSON.parse(read('search-index.json'));
  if (idx.length !== DATA.total) return `索引 ${idx.length} 筆，應為 ${DATA.total}`;
  const missing = idx.filter((it) => !exists(`i/${it.i}/index.html`));
  return missing.length ? `${missing.length} 筆索引指向不存在的頁面` : true;
});

check('座標覆蓋與範圍', () => {
  const pre = DATA.institutions.filter((i) => i.kind === 'preschool');
  const withGeo = pre.filter((i) => i.lat);
  if (withGeo.length < pre.length * 0.95) {
    return `幼兒園只有 ${withGeo.length}/${pre.length} 有座標`;
  }
  // geocoding 失敗常表現為落在海上或別的縣市，不是缺值
  const out = withGeo.filter(
    (i) => i.lat < 24.6 || i.lat > 25.4 || i.lng < 121.0 || i.lng > 122.2,
  );
  return out.length ? `${out.length} 筆座標落在新北市範圍外` : true;
});

check('搜尋索引含座標，供距離排序使用', () => {
  const idx = JSON.parse(read('search-index.json'));
  const withGeo = idx.filter((it) => it.y && it.x);
  return withGeo.length >= 1000 ? true : `索引只有 ${withGeo.length} 筆帶座標`;
});

// 動態產生的節點拿不到 Astro 的 data-astro-cid 屬性，樣式必須在全域，
// 否則「附近」清單會退化成一堆無樣式的底線文字
check('附近清單的樣式在全域 CSS 而非 scoped', () => {
  const css = allFiles.filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(f, 'utf8')).join('');
  const rule = css.match(/\.near-list a[^{]*\{[^}]*\}/);
  if (!rule) return '找不到 .near-list a 規則';
  return /data-astro-cid/.test(rule[0]) ? '.near-list a 被 scoped，動態節點吃不到' : true;
});

// 曾經：封存 GeoJSON 的 monthly 欄位對 74% 的機構對不上任何年齡的實際收費，
// 來源無法解釋。改用可交叉驗證的分齡資料後，這個欄位不該再出現。
check('已無來源不明的 monthly 欄位', () => {
  const bad = DATA.institutions.filter((i) => 'monthly' in i);
  return bad.length ? `${bad.length} 筆仍帶 monthly 欄位` : true;
});

check('分齡收費覆蓋率與內部一致性', () => {
  const pre = DATA.institutions.filter((i) => i.kind === 'preschool');
  const withFees = pre.filter((i) => i.fees);
  if (withFees.length < pre.length * 0.9) {
    return `只有 ${withFees.length}/${pre.length} 有分齡收費`;
  }
  for (const i of withFees) {
    for (const [age, f] of Object.entries(i.fees)) {
      if (!f.monthly || f.monthly < 500 || f.monthly > 80000) {
        return `${i.name} ${age} 歲收費 ${f.monthly} 不合理`;
      }
      // monthly1 = total1 ÷ months，這是反推欄位語意時驗證過的等式，必須持續成立
      if (f.yearly && f.months && Math.abs(f.yearly / f.months - f.monthly) > 2) {
        return `${i.name} ${age} 歲：全年 ${f.yearly} ÷ ${f.months} 個月 ≠ 每月 ${f.monthly}`;
      }
      if (!i.ages.includes(Number(age))) return `${i.name} 有 ${age} 歲收費卻不在 ages 裡`;
    }
  }
  return true;
});

check('收托年齡可用於篩選', () => {
  const accepts2 = DATA.institutions.filter((i) => i.ages?.includes(2)).length;
  if (accepts2 < 300) return `只有 ${accepts2} 間標示收 2 歲，疑似資料異常`;
  const sample = 'd/板橋區/index.html';
  const h = read(sample);
  if (!h.includes('data-ages=')) return '行政區頁的卡片缺少 data-ages';
  if (!h.includes('收 2 歲')) return '行政區頁缺少「收 2 歲」篩選鈕';
  return true;
});

// 卡片與清單上的金額一律要標年齡：2 歲與 5 歲可差三千以上
check('顯示金額處都標了年齡', () => {
  const h = read('d/板橋區/index.html');
  if (/平均月費/.test(h)) return '仍有未標年齡的「平均月費」字樣';
  return /歲每月必繳/.test(h) ? true : '卡片上找不到標了年齡的費用';
});

check('收費區塊講明未扣補助', () => {
  const h = read('i/preschool-悅淨幼兒園-板橋區/index.html');
  return h.includes('沒有扣掉任何政府補助') ? true : '收費區塊未聲明補助未扣除';
});

// --- 執行 ---------------------------------------------------------------

let failed = 0;
for (const { name, fn } of checks) {
  let result;
  try {
    result = fn();
  } catch (err) {
    result = `檢查本身出錯：${err.message}`;
  }
  if (result === true) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}\n      ${result}`);
  }
}

console.log(`\n${checks.length - failed} / ${checks.length} 通過`);
if (failed) process.exit(1);
