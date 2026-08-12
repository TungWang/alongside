/**
 * 每月自動核對的結果，給頁面用。
 *
 * checks.json 由 scripts/check-subsidy.js 產生並隨資料一起進版控，
 * 所以本機建置與 CI 建置看到的是同一份。
 */
import checks from '../data/checks.json';
import { shouldWarnOnSite } from '../../scripts/check-subsidy.js';

export const subsidy = checks.subsidy ?? null;

/**
 * 補助試算旁邊要不要掛警語。
 *
 * 兩種情況會掛，但講法不同——把「我們發現金額變了」跟「我們最近核對不了」
 * 講成同一句話，會讓家長高估或低估風險。
 */
export function subsidyWarning() {
  if (!shouldWarnOnSite(subsidy)) return null;
  if (subsidy.status === 'mismatch') {
    return {
      title: '政府公告的補助金額可能已經調整',
      body:
        '本站在自動核對時發現教育部頁面上的金額與本站採用的不一致，下面的試算可能已經不準。' +
        '在本站更新之前，請直接以教育部全國教保資訊網的公告與園所通知為準。',
    };
  }
  return {
    title: '本站已有一段時間無法自動核對補助金額',
    body:
      '教育部的頁面格式改變，本站連續兩次讀不到上面的金額，因此無法確認下面的試算是否仍與現行政策一致。' +
      '這不代表金額一定錯了，但請務必自行向園所或主管機關確認。',
  };
}
