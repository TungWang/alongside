// 從 institutions.json 算出各頁需要的統計。
// 全部在建置期算完寫進 HTML，瀏覽器端不做任何計算。

import data from '../data/institutions.json';

const { institutions } = data;

const median = (nums) => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const countBy = (list, key) => {
  const m = new Map();
  for (const item of list) m.set(key(item), (m.get(key(item)) || 0) + 1);
  return m;
};

// 屬性的固定顯示順序：從公共資源多到少，家長多半依這條軸線比較
export const OWNERSHIP_ORDER = ['公立', '非營利', '準公共', '職場互助', '私立', '公共托育'];

const sortByOwnership = (a, b) => {
  const ia = OWNERSHIP_ORDER.indexOf(a);
  const ib = OWNERSHIP_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
};

const preschools = institutions.filter((i) => i.kind === 'preschool');
const nurseries = institutions.filter((i) => i.kind === 'nursery');

// ---------------------------------------------------------------------------

/** 全市概覽 */
export function overview() {
  const capacities = nurseries.map((i) => i.capacity).filter(Boolean);
  return {
    total: institutions.length,
    preschools: preschools.length,
    nurseries: nurseries.length,
    districts: data.districts.length,
    nurseryCapacity: capacities.reduce((a, b) => a + b, 0),
    nurseryCapacityMedian: median(capacities),
  };
}

/** 各屬性的機構數 */
export function byOwnership(list = institutions) {
  return [...countBy(list, (i) => i.ownership)]
    .sort((a, b) => sortByOwnership(a[0], b[0]))
    .map(([ownership, count]) => ({ ownership, count }));
}

export const FEE_AGES = ['2', '3', '4', '5'];

/**
 * 各屬性在特定年齡的月費。只有幼兒園有，且來自民間封存。
 * 用中位數而非平均——私立的範圍極寬，平均會被極端值拉走。
 *
 * 一定要指定年齡：各齡價差可達三千以上，混在一起算出來的數字沒有意義。
 */
export function feeByOwnership(age = '2') {
  const groups = new Map();
  for (const i of preschools) {
    const fee = i.fees?.[age]?.monthly;
    if (!fee) continue;
    if (!groups.has(i.ownership)) groups.set(i.ownership, []);
    groups.get(i.ownership).push(fee);
  }
  return [...groups]
    .sort((a, b) => sortByOwnership(a[0], b[0]))
    .map(([ownership, fees]) => {
      const min = Math.min(...fees);
      const max = Math.max(...fees);
      return {
        ownership,
        count: fees.length,
        median: median(fees),
        min,
        max,
        // 非營利與職場互助全國都是同一個數字，那是政策訂的收費上限而非實際分布。
        // 標記出來，才不會把定額當成「中位數」呈現。
        flat: min === max,
      };
    });
}

/** 適合畫成圖表的月費資料：家數太少的類型畫出來會誤導，只留在表格裡 */
export const CHART_MIN_SAMPLE = 10;
export const chartableFees = (age = '2') =>
  feeByOwnership(age).filter((f) => f.count >= CHART_MIN_SAMPLE);

/** 各年齡的收費概況，供概況頁比較 */
export function feeByAge() {
  return FEE_AGES.map((age) => {
    const all = preschools.map((i) => i.fees?.[age]?.monthly).filter(Boolean);
    const sorted = [...all].sort((a, b) => a - b);
    return {
      age,
      count: all.length,
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    };
  });
}

/** 收托年齡分布——對 0–3 歲家長，「這間收不收 2 歲」是最關鍵的篩選條件 */
export function ageCoverage() {
  return FEE_AGES.map((age) => ({
    age,
    count: preschools.filter((i) => i.fees?.[age]).length,
  }));
}

/**
 * 裁罰的違規分類。
 *
 * 只依「來源公告自己寫的文字」分類，不從條號推論。
 *
 * 試過用資料自學「條號 → 類型」的對照，結果不可靠：`第26條第2項` 底下同時出現
 * 「違反幼童專用車之相關規定」與「進用未具資格者從事教保服務」兩種完全不同的違規，
 * 而該條號有 162 筆只寫條號。原因是這些裁罰橫跨多個法律版本（106 制定、107 修正、
 * 111 修正重編條號），同一組數字在不同版本指向不同條文。
 *
 * 猜錯的代價不對稱——把娃娃車違規標成「對幼兒不當對待」，或反過來，都是在誤導家長。
 * 所以沒寫內容的就誠實說沒寫，並附官方查詢連結。
 */
const CATEGORY_RULES = [
  ['對幼兒不當對待', /不當對待|不當管教|體罰|身心虐待|傷害幼兒/],
  ['幼童專用車', /幼童專用車|娃娃車|載運/],
  ['人員資格與配置', /未具資格|不適任|資格|配置.{0,4}教保服務人員|專任/],
  ['超收人數或違規擴充', /超收|招收人數|擴充/],
  ['編班與師生比', /師生比|編班|班級人數|年齡規定/],
  ['收費違規', /收費|費用|退費/],
  ['衛生保健與服務禁止規定', /禁止規定|衛生保健|教保及照顧服務/],
  ['妨礙檢查或評鑑', /規避|妨礙|拒絕檢查|評鑑/],
  ['未經核准提供服務', /未經核准/],
  ['行政與資訊揭露', /公開資訊|備查|書面契約|報.{0,4}主管機關/],
];

export const UNSPECIFIED = '原始公告未載明內容';

export function penaltyCategory(description) {
  // 條號前綴不參與比對，只看後面的敘述
  const body = (description || '').replace(/^第\d+條(第\d+項)?[-－—\s]*/, '');
  if (body.length < 3) return UNSPECIFIED;
  for (const [name, pattern] of CATEGORY_RULES) if (pattern.test(body)) return name;
  return '其他違規';
}

/** 有裁罰紀錄的機構，供裁罰總覽頁使用 */
export function penalisedInstitutions() {
  return preschools
    .filter((i) => i.penalties.length)
    .map((i) => {
      const cats = [...new Set(i.penalties.map((p) => penaltyCategory(p.description)))];
      const dates = i.penalties.map((p) => p.date).filter(Boolean).sort();
      return {
        id: i.id,
        name: i.name,
        district: i.district,
        ownership: i.ownership,
        count: i.penalties.length,
        latest: dates[dates.length - 1] || '',
        categories: cats,
        fines: i.penalties.reduce((s, p) => s + (p.fineAmount || 0), 0),
      };
    })
    // 依最近一次裁罰排序，不依筆數——依筆數排等於做出一份「最壞排行榜」，
    // 而筆數多寡與違規輕重無關。時間序至少能回答「最近有沒有事」。
    .sort((a, b) => b.latest.localeCompare(a.latest));
}

/** 各違規類型的筆數 */
export function penaltyCategories() {
  const all = preschools.flatMap((i) => i.penalties);
  return [...countBy(all, (p) => penaltyCategory(p.description))]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));
}

/** 裁罰統計 */
export function penaltyStats() {
  const withPenalty = preschools.filter((i) => i.penalties.length);
  const all = preschools.flatMap((i) => i.penalties);
  const fines = all.map((p) => p.fineAmount).filter(Boolean);

  const byYear = [...countBy(all, (p) => p.date.slice(0, 4))]
    .filter(([y]) => /^\d{4}$/.test(y))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, count]) => ({ year, count }));

  // 各屬性被裁罰的機構比例——比絕對筆數更能說明問題，因為各屬性家數差很多
  const rate = [...countBy(preschools, (i) => i.ownership)]
    .sort((a, b) => sortByOwnership(a[0], b[0]))
    .map(([ownership, total]) => {
      const hit = preschools.filter((i) => i.ownership === ownership && i.penalties.length).length;
      return { ownership, total, hit, percent: Math.round((hit / total) * 100) };
    });

  const kinds = [...countBy(all, (p) => p.sanctionKind)]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => ({ kind, count }));

  return {
    institutions: withPenalty.length,
    ofPreschools: preschools.length,
    percent: Math.round((withPenalty.length / preschools.length) * 100),
    records: all.length,
    fineMedian: median(fines),
    fineMax: fines.length ? Math.max(...fines) : null,
    byYear,
    rate,
    kinds,
  };
}

/** 各行政區的機構數與組成 */
export function districtStats() {
  return data.districts
    .map((district) => {
      const list = institutions.filter((i) => i.district === district);
      return {
        district,
        total: list.length,
        preschools: list.filter((i) => i.kind === 'preschool').length,
        nurseries: list.filter((i) => i.kind === 'nursery').length,
        byOwnership: byOwnership(list),
      };
    })
    .sort((a, b) => b.total - a.total);
}

export const archive = data.archive;
export const fetchedAt = data.fetchedAt;
