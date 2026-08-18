/**
 * 準公共的判定。
 *
 * 準公共不是一種設立屬性——它是私立園跟政府簽的合約，約到期就回到私立。
 * 所以資料上不能用「屬性」這個單一欄位表達，必須看契約的起訖年度。
 *
 * 這裡只放純函式，讓資料管線與驗證都能引用而不會互相牽動
 * （曾經因為 verify 直接 import 管線，害 verify 每次都重新抓一次資料）。
 */

/** 現在是哪個學年度（8 月換學年）。民國年 = 西元年 - 1911 */
export function schoolYear(d = new Date()) {
  return d.getFullYear() - 1911 - (d.getMonth() + 1 < 8 ? 1 : 0);
}

/**
 * 契約在指定學年度是否有效。
 * 封存的 pre_public 欄位是契約年度區間，例如 "113-115"；沒有契約的是「無」。
 */
export function hasQuasiContract(raw, year) {
  const m = /^(\d+)-(\d+)$/.exec(String(raw ?? '').trim());
  return m ? year >= Number(m[1]) && year <= Number(m[2]) : false;
}

/** 看起來像契約年度區間（用來區分「沒有契約」與「契約已過期」）*/
export const looksLikeContract = (raw) => /^\d+-\d+$/.test(String(raw ?? '').trim());
