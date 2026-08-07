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

/**
 * 各屬性的月費。只有幼兒園有這筆資料，且來自民間封存。
 * 用中位數而非平均——私立的範圍極寬，平均會被極端值拉走。
 */
export function feeByOwnership() {
  const groups = new Map();
  for (const i of preschools) {
    if (!i.monthly) continue;
    if (!groups.has(i.ownership)) groups.set(i.ownership, []);
    groups.get(i.ownership).push(i.monthly);
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
export const chartableFees = () => feeByOwnership().filter((f) => f.count >= CHART_MIN_SAMPLE);

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
