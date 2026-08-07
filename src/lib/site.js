// 全站設定與共用查表

// 部署後改成你的 Firebase 網址（例如 https://alongside-tw.web.app）。
// sitemap 與 canonical 都靠這個值，上線前務必改對。
export const SITE_URL = 'https://alongside-tw.web.app';
export const SITE_NAME = '育兒同行';

/**
 * 機構屬性標籤。幼兒園的 type 欄位實測有 7 種值，
 * 托嬰兩個資料集則各自固定，合起來需要 7 種顏色。
 * 全部低飽和暖調，只用來區分類型，不帶價值判斷。
 */
const TAGS = {
  公立: '#7A8B6F',
  準公共: '#9A8C5E',
  私立: '#B08863',
  非營利: '#6F8B85',
  職場互助: '#8E7F94',
  公共托育: '#C08A5E',
};
const TAG_FALLBACK = '#7A7169'; // 公營公司、社團法人附設等零星值

export function tagColor(ownership) {
  return TAGS[ownership] || TAG_FALLBACK;
}

/**
 * 官方查詢連結。
 *
 * 幼兒園歸教育部／新北市教育局，托嬰中心歸衛福部／新北市社會局——
 * 兩套系統完全獨立，連結必須依 authority 分開給，不能共用。
 *
 * 注意：教育部三個查詢頁都是 ASP.NET POST 表單，無法用網址帶入園名。
 * 所以機構頁一定要先提供「複製機構名稱」，家長才不會點過去對著空白搜尋框發呆。
 */
const LINKS = {
  edu: [
    {
      label: '裁罰紀錄',
      source: '全國教保資訊網',
      url: 'https://ap.ece.moe.edu.tw/webecems/punishSearch.aspx',
      needsName: true,
    },
    {
      label: '基礎評鑑結果',
      source: '全國教保資訊網',
      url: 'https://ap.ece.moe.edu.tw/webecems/evaSearch.aspx',
      needsName: true,
    },
    {
      label: '收退費標準',
      source: '新北市幼兒教育資源網',
      url: 'https://kidedu.ntpc.edu.tw/p/412-1000-154.php',
      needsName: false,
    },
    {
      label: '育兒津貼與就學補助',
      source: '教育部',
      url: 'https://www.ece.moe.edu.tw/ch/subsidy/allowance-1/',
      needsName: false,
    },
  ],
  social: [
    {
      label: '裁罰公告',
      source: '新北市社會局',
      url: 'https://www.sw.ntpc.gov.tw/home.jsp?id=1746a22a2af02008',
      needsName: true,
    },
    {
      label: '機構評鑑結果',
      source: '新北市社會局',
      url: 'https://www.sw.ntpc.gov.tw/home.jsp?id=40c85471efd9ce2f',
      needsName: true,
    },
    {
      label: '收費與相關規定',
      source: '新北市托嬰中心專區',
      url: 'https://www.sw.ntpc.gov.tw/home.jsp?id=9f08068f32b4c183',
      needsName: false,
    },
    {
      label: '育兒津貼與托育補助',
      source: '衛生福利部',
      url: 'https://www.mohw.gov.tw/cp-5130-58003-1.html',
      needsName: false,
    },
  ],
};

export function officialLinks(authority) {
  return LINKS[authority] || [];
}

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

export const districtPath = (district) => `/d/${encodeURIComponent(district)}/`;
export const institutionPath = (id) => `/i/${encodeURIComponent(id)}/`;
