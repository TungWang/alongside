/**
 * 就學補助與育兒津貼試算。
 *
 * 為什麼需要這個：本站顯示的是「園所申報的收費」，不是家長實付。
 * 一間準公共園申報 12,000，家長其實只付 3,000 上限，差額由政府直接撥給園所。
 * 沒有這層換算，家長並排看到「準公共 12,000」與「私立 17,000」會以為差不多貴，
 * 實際差三倍以上——那是主動誤導，不是資訊不足。
 *
 * 金額全部取自教育部全國教保資訊網（見各項的 source），111 年 8 月起適用。
 * 這些是政策數字不是逐園資料，改版時要一起更新，因此集中在這個檔案。
 *
 * 兩種補助方式完全不同，UI 必須講清楚：
 *   平價教保（公立／非營利／準公共／職場互助）：入學自動減免，家長只繳上限內的金額。
 *   其他（私立等）：家長照付全額，另外請領育兒津貼匯入自己帳戶。
 */

export const SUBSIDY_UPDATED = '111 年 8 月起適用';

export const BIRTH_ORDERS = [
  { key: '1', label: '第 1 胎' },
  { key: '2', label: '第 2 胎' },
  { key: '3', label: '第 3 胎以上' },
];

/**
 * 平價教保服務的家長每月繳費上限。
 * 準公共的上限明確涵蓋「學費、雜費、材料費、活動費、午餐費及點心費」，
 * 正好就是本站 monthly 的六個項目，兩者可直接比較。
 */
const CAPS = {
  公立: { 1: 1000, 2: 0, 3: 0, source: 'https://www.ece.moe.edu.tw/ch/subsidy/public-non-profit/' },
  非營利: { 1: 2000, 2: 1000, 3: 0, source: 'https://www.ece.moe.edu.tw/ch/subsidy/public-non-profit/' },
  職場互助: { 1: 2000, 2: 1000, 3: 0, source: 'https://www.ece.moe.edu.tw/ch/subsidy/public-non-profit/' },
  準公共: { 1: 3000, 2: 2000, 3: 1000, source: 'https://www.ece.moe.edu.tw/ch/subsidy/zgg-1/' },
};

/** 未就讀平價教保者的育兒津貼／就學補助（兩者自 111 年 8 月起金額相同） */
const ALLOWANCE = {
  1: 5000,
  2: 6000,
  3: 7000,
  source: 'https://www.ece.moe.edu.tw/ch/subsidy/allowance-1/',
};

export const isAffordableCare = (ownership) => Object.hasOwn(CAPS, ownership);

/**
 * 算出某個出生序下的每月自付額。
 *
 * @param {string} ownership 機構屬性
 * @param {number} charge    園所申報的每月必繳（本站的 fees[age].monthly）
 * @param {string} order     '1' | '2' | '3'
 * @param {boolean} lowIncome 低收入戶或中低收入戶
 */
export function estimate(ownership, charge, order = '1', lowIncome = false) {
  const cap = CAPS[ownership];

  if (cap) {
    // 低收與中低收入家庭就讀平價教保一律免費
    const limit = lowIncome ? 0 : cap[order];
    // 園所收費低於上限時，付的是實際收費而非上限
    const pay = Math.min(charge, limit);
    return {
      kind: 'cap',
      pay,
      limit,
      covered: Math.max(charge - pay, 0),
      lowIncome,
      note: '入學就自動減免，不必另外申請；差額由政府直接撥給園所。',
      source: cap.source,
    };
  }

  // 私立等未參與平價教保者：照付全額，另外請領津貼匯入自己帳戶
  const allowance = ALLOWANCE[order];
  return {
    kind: 'allowance',
    pay: Math.max(charge - allowance, 0),
    allowance,
    charge,
    lowIncome,
    note: '津貼是每月匯進你的帳戶，不是從學費裡扣——要先向公所或線上提出申請。',
    source: ALLOWANCE.source,
  };
}

export const SUBSIDY_SOURCES = [
  { label: '公立與非營利幼兒園的繳費上限', url: CAPS.公立.source },
  { label: '準公共幼兒園的繳費上限', url: CAPS.準公共.source },
  { label: '育兒津貼與就學補助', url: ALLOWANCE.source },
];
