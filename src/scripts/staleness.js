/**
 * 資料老舊自我揭露。
 *
 * 為什麼一定要在瀏覽器端算：這個判斷要警告的情況，正是「頁面沒有被重新產生」——
 * cron 被停用、抓資料失敗、部署失敗。那時候整站會維持原狀，每一頁看起來都完全正常，
 * 而任何在建置期算出來的東西都不會更新，包括「這份資料已經很舊了」這句話本身。
 * 所以判斷必須發生在訪客載入頁面的那一刻，拿他當下的日期去比。
 *
 * 兩個門檻：
 *   45 天　漏一次每月更新。頁尾的擷取時間旁加一句提醒。
 *   90 天　漏兩次，不可能是巧合。每頁最上方出現橫幅。
 *
 * 為什麼是 90：三個月足夠讓園所歇業、電話改號、新的裁罰出現，家長拿舊資料
 * 做決定的風險已經實在了。這也是維護者自己的最後一道防線——通知信全漏看時，
 * 進網站一眼就知道。
 */

const SOFT_DAYS = 45;
const LOUD_DAYS = 90;

// 訪客的系統時鐘可能是錯的，這比想像中常見（新裝置、電池沒電的桌機、刻意改時間）。
// 負數或誇張的大數字一律不採信：與其顯示「已 19,000 天未更新」把人嚇跑，不如安靜。
const MAX_SANE_DAYS = 1825;

/** @returns {number|null} 天數；無法判斷或數字不合理時回 null */
export function ageInDays(fetchedAt, now = Date.now()) {
  const t = Date.parse(`${fetchedAt}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((now - t) / 86400000);
  if (days < 0 || days > MAX_SANE_DAYS) return null;
  return days;
}

/** @returns {'fresh'|'soft'|'loud'} */
export function levelFor(days) {
  if (days === null || days < SOFT_DAYS) return 'fresh';
  return days >= LOUD_DAYS ? 'loud' : 'soft';
}

export function mount() {
  const banner = document.getElementById('stale-banner');
  const badge = document.getElementById('data-age');
  const fetchedAt = banner?.dataset.fetched;
  if (!fetchedAt) return;

  const days = ageInDays(fetchedAt);
  const level = levelFor(days);
  if (level === 'fresh') return;

  if (badge) {
    badge.textContent = `已 ${days} 天未更新`;
    badge.hidden = false;
  }

  if (level === 'loud') {
    banner.textContent =
      `這份資料已經 ${days} 天沒有更新了。園所可能已經歇業、搬遷或改號，` +
      `本站的自動更新可能出了問題——請一律以官方公告與機構本身的說明為準。`;
    banner.hidden = false;
  }
}
