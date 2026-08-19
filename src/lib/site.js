// 全站設定與共用查表

// 部署後改成你的 Firebase 網址（例如 https://alongside-tw.web.app）。
// sitemap 與 canonical 都靠這個值，上線前務必改對。
export const SITE_URL = 'https://alongside-53f07.web.app/';
export const SITE_NAME = '育兒同行';

/**
 * Google Search Console 的網站驗證碼。
 *
 * 在 Search Console 選「HTML 標記」驗證時，它會給一段
 *   <meta name="google-site-verification" content="AbC123..." />
 * 只要把引號裡的那串 content 值貼在下面即可，不用貼整個標籤。
 * 留空則不輸出這個 meta，頁面不受影響。
 *
 * 驗證通過後不要刪掉——Google 會定期重新確認，拿掉會失去資源擁有權。
 */
export const GSC_VERIFICATION = '-FbkcBBuKxZ3C-sOBNFoX-GUGMZcy-516b79xpILpoo';

/**
 * 機構屬性標籤。幼兒園的 type 欄位實測有 7 種值，
 * 托嬰兩個資料集則各自固定，合起來需要 7 種顏色。
 * 全部低飽和暖調，只用來區分類型，不帶價值判斷。
 */
const TAGS = {
  公立: '#6B7A62',
  準公共: '#80744E',
  私立: '#946E4B',
  非營利: '#627A75',
  職場互助: '#7F6F85',
  公共托育: '#9E693E',
};
const TAG_FALLBACK = '#6E665E'; // 公營公司、社團法人附設等零星值

export function tagColor(ownership) {
  return TAGS[ownership] || TAG_FALLBACK;
}

/**
 * 官方查詢連結。
 *
 * 兩個維度都會影響：
 *   主管機關——幼兒園歸教育部／各市教育局，托嬰中心歸衛福部／各市社會局，兩套系統獨立。
 *   縣市——托嬰的四個連結各縣市完全不同；幼兒園只有「收退費」是地方的，
 *          裁罰與評鑑走全國教保資訊網、育兒津貼走教育部，各縣市共用。
 *
 * 注意：教育部三個查詢頁都是 ASP.NET POST 表單，無法用網址帶入園名。
 * 所以機構頁一定要先提供「複製機構名稱」，家長才不會點過去對著空白搜尋框發呆。
 */
const NATIONAL_EDU = {
  penalty: {
    kind: 'penalty',
    label: '裁罰紀錄',
    source: '全國教保資訊網',
    url: 'https://ap.ece.moe.edu.tw/webecems/punishSearch.aspx',
    needsName: true,
  },
  evaluation: {
    kind: 'evaluation',
    label: '基礎評鑑結果',
    source: '全國教保資訊網',
    url: 'https://ap.ece.moe.edu.tw/webecems/evaSearch.aspx',
    needsName: true,
  },
  subsidy: {
    kind: 'subsidy',
    label: '育兒津貼與就學補助',
    source: '教育部',
    url: 'https://www.ece.moe.edu.tw/ch/subsidy/allowance-1/',
    needsName: false,
  },
};

const CITY_LINKS = {
  新北市: {
    eduFee: {
      kind: 'fee',
      label: '收退費標準',
      source: '新北市幼兒教育資源網',
      url: 'https://kidedu.ntpc.edu.tw/p/412-1000-154.php',
      needsName: false,
    },
    social: [
      { kind: 'penalty', label: '裁罰公告', source: '新北市社會局', needsName: true,
        url: 'https://www.sw.ntpc.gov.tw/home.jsp?id=1746a22a2af02008' },
      { kind: 'evaluation', label: '機構評鑑結果', source: '新北市社會局', needsName: true,
        url: 'https://www.sw.ntpc.gov.tw/home.jsp?id=40c85471efd9ce2f' },
      { kind: 'fee', label: '收費與相關規定', source: '新北市托嬰中心專區', needsName: false,
        url: 'https://www.sw.ntpc.gov.tw/home.jsp?id=9f08068f32b4c183' },
      { kind: 'subsidy', label: '育兒津貼與托育補助', source: '衛生福利部', needsName: false,
        url: 'https://www.mohw.gov.tw/cp-5130-58003-1.html' },
    ],
  },
  臺北市: {
    eduFee: {
      kind: 'fee',
      label: '收退費標準',
      source: '臺北市學前教育資源網',
      url: 'https://kids.gov.taipei/News.aspx?n=AA655CD4DF0EB38B&sms=69B4E6B26379EE4E',
      needsName: false,
    },
    social: [
      { kind: 'penalty', label: '違反兒少法公告', source: '臺北市社會局', needsName: true,
        url: 'https://dosw.gov.taipei/News.aspx?n=1C4804606DA85DC2&sms=F0A015F5CA923CDA' },
      { kind: 'evaluation', label: '歷年評鑑結果', source: '臺北市社會局', needsName: true,
        url: 'https://dosw.gov.taipei/News_Content.aspx?n=4645626222691382&s=3B360100D6749752&sms=A457979BAA25CDBE' },
      { kind: 'fee', label: '準公共收費上限', source: '臺北市社會局', needsName: false,
        url: 'https://dosw.gov.taipei/News_Content.aspx?n=B10CA82FD36E1CAB&sms=21504F85D4D084B8&s=CE2AE54CF5409D60' },
      { kind: 'subsidy', label: '友善托育補助', source: '臺北市社會局', needsName: false,
        url: 'https://dosw.gov.taipei/cp.aspx?n=46A2CAA8E124546D&s=1ADF41E184075E8A' },
    ],
  },
};

/**
 * 依用途取連結，不要用標籤文字比對——各縣市的標籤名稱不同
 * （新北叫「裁罰公告」、臺北叫「違反兒少法公告」），比對文字會在加新縣市時默默失效。
 */
export const linkOfKind = (links, kind) => links.find((l) => l.kind === kind);

export function officialLinks(city, authority) {
  const set = CITY_LINKS[city];
  if (!set) return [];
  if (authority === 'social') return set.social;
  return [NATIONAL_EDU.penalty, NATIONAL_EDU.evaluation, set.eduFee, NATIONAL_EDU.subsidy];
}

/**
 * 各縣市各類機構的資料出處。聲明「資料可能有誤」時要附可以點過去核對的東西，
 * 只寫機關名稱幫不上忙。
 *
 * 臺北市的幼兒園沒有市府開放資料，出處就是民間封存——這點不迴避，直接標出來。
 */
const CITY_DATASETS = {
  新北市: {
    幼兒園: { label: '新北市公私立立案幼兒園資料', agency: '新北市政府教育局',
      url: 'https://data.ntpc.gov.tw/datasets/f563b4cd-b850-41f5-9709-b910f2d147e9' },
    托嬰中心: { label: '新北市私立托嬰機構名冊', agency: '新北市政府社會局',
      url: 'https://data.ntpc.gov.tw/datasets/69cecdb0-7796-48df-84e5-99e4f1274245' },
    公共托育中心: { label: '新北市公共托育中心名冊', agency: '新北市政府社會局',
      url: 'https://data.ntpc.gov.tw/datasets/b3faf2aa-e96b-4f2f-b647-da47dc094860' },
  },
  臺北市: {
    幼兒園: { label: '台灣幼兒園地圖封存資料',
      agency: '民間封存，原始出處為全國教保資訊網——臺北市沒有市府層級的幼兒園開放資料',
      url: 'https://github.com/kiang/ap.ece.moe.edu.tw' },
    托嬰中心: { label: '臺北市嬰幼兒照顧服務_私立托嬰中心', agency: '臺北市政府社會局',
      url: 'https://data.taipei/dataset/detail?id=081df75e-85c7-464c-b125-546920911c5c' },
    公設民營托嬰中心: { label: '臺北市嬰幼兒照顧服務_公辦民營托嬰中心', agency: '臺北市政府社會局',
      url: 'https://data.taipei/dataset/detail?id=9c9a3f77-8340-48d8-bc0e-f9155521b758' },
    社區公共托育家園: { label: '臺北市準公共化托嬰中心', agency: '臺北市政府社會局',
      url: 'https://data.taipei/dataset/detail?id=aeaaa517-089c-42a7-ad5b-60fef89c3545' },
    托嬰中心評鑑: { label: '臺北市托嬰中心評鑑結果', agency: '臺北市政府社會局',
      url: 'https://data.taipei/dataset/detail?id=e7b45593-9d44-469c-97fa-f1a52c69ebaa' },
  },
};

export const datasetFor = (city, category) =>
  CITY_DATASETS[city]?.[category] || CITY_DATASETS[city]?.['幼兒園'];

export const datasetsForCity = (city) => Object.values(CITY_DATASETS[city] || {});


/**
 * 屬性＋類別的完整說法。多數情況是相接的（「準公共」＋「幼兒園」→「準公共幼兒園」），
 * 但公共托育的屬性本身已包含類別（「公共托育」＋「公共托育中心」），直接相接會變成
 * 「公共托育公共托育中心」，所以要判斷。
 */
export function fullType(inst) {
  return inst.category.startsWith(inst.ownership) ? inst.category : inst.ownership + inst.category;
}

// 屬性標籤已經說完的事，類別標籤就不用再說一次
export const needsCategoryTag = (inst) => !inst.category.startsWith(inst.ownership);

/** 「新北市與臺北市」這種列舉，隨收錄縣市自動變動，不要在文案裡寫死 */
export const cityList = (cities, sep = '與') => cities.map((c) => c.name).join(sep);

export const districtPath = (district) => `/d/${encodeURIComponent(district)}/`;
export const institutionPath = (id) => `/i/${encodeURIComponent(id)}/`;

/**
 * 卡片與清單顯示哪一個年齡的費用：一律用「有資料的最小年齡」。
 *
 * 本站對象是 0–3 歲家長，最小年齡跟他們最相關；而各齡價差可達三千以上，
 * 給一個沒標年齡的數字等於沒說。所以回傳一定帶 age，UI 必須把年齡印出來。
 */
export function primaryFee(inst) {
  if (!inst.fees) return null;
  for (const age of ['2', '3', '4', '5']) {
    if (inst.fees[age]) return { age: Number(age), ...inst.fees[age] };
  }
  return null;
}

export const acceptsAge = (inst, age) => Boolean(inst.fees?.[String(age)]);

/**
 * 課後延托費（選繳）。家長訪談中被點名為關鍵資訊，資料本來就在，只是沒突顯。
 * 各齡通常同價，取第一個有值的即可。
 */
export function afterHoursFee(inst) {
  if (!inst.fees) return null;
  for (const age of ['2', '3', '4', '5']) {
    const v = inst.fees[age]?.afterHours;
    if (v) return v;
  }
  return null;
}

/**
 * 收費月數，用來回答「有沒有寒暑假」。
 *
 * 注意這是代理指標，不是直接答案：來源的收費明細表只有上下學期，沒有寒暑假班欄位。
 * 收費 12 個月代表全年收費（寒暑假多半照常收托），9 個月代表只收學期間
 * （寒暑假通常另外安排或另外收費）。要確定仍得問園所。
 */
export function feeMonths(inst) {
  if (!inst.fees) return null;
  const months = Object.values(inst.fees).map((f) => f.months).filter(Boolean);
  return months.length ? Math.max(...months) : null;
}

export const termLabel = (months) =>
  months == null ? null : months >= 12 ? '全年收費' : `學期制 ${months} 個月`;
