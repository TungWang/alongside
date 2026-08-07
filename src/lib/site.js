// 全站設定與共用查表

// 部署後改成你的 Firebase 網址（例如 https://alongside-tw.web.app）。
// sitemap 與 canonical 都靠這個值，上線前務必改對。
export const SITE_URL = 'https://alongside-53f07.web.app/';
export const SITE_NAME = '育兒同行';

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
 * 每個資料集在開放平台上的頁面。聲明資料可能有誤時要附「可以點過去核對的東西」，
 * 只寫機關名稱幫不上忙。
 */
export const DATASETS = {
  幼兒園: {
    label: '新北市公私立立案幼兒園資料',
    agency: '新北市政府教育局',
    url: 'https://data.ntpc.gov.tw/datasets/f563b4cd-b850-41f5-9709-b910f2d147e9',
  },
  托嬰中心: {
    label: '新北市私立托嬰機構名冊',
    agency: '新北市政府社會局',
    url: 'https://data.ntpc.gov.tw/datasets/69cecdb0-7796-48df-84e5-99e4f1274245',
  },
  公共托育中心: {
    label: '新北市公共托育中心名冊',
    agency: '新北市政府社會局',
    url: 'https://data.ntpc.gov.tw/datasets/b3faf2aa-e96b-4f2f-b647-da47dc094860',
  },
};

export const datasetFor = (category) => DATASETS[category] || DATASETS['幼兒園'];

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
