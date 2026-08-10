/**
 * 收藏清單。
 *
 * 找托育是跨好幾週的事，家長會分很多次來看。沒有收藏，每次都要重找一遍。
 *
 * 存在 localStorage：不需要後端、不需要帳號、資料留在使用者自己的裝置上，
 * 完全不影響「純靜態、零成本」的前提，也不用處理任何個資。
 * 代價是換裝置或清瀏覽器資料就沒了——這個取捨對本站是划算的。
 */

const KEY = 'alongside:shortlist:v1';
const MAX = 30;

export function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => x && typeof x.id === 'string') : [];
  } catch {
    return []; // localStorage 被停用或內容壞掉時，當成空清單而不是讓整頁壞掉
  }
}

function write(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    /* 隱私模式或容量滿：靜靜失敗，收藏功能不該擋住瀏覽 */
  }
}

export const has = (id) => read().some((x) => x.id === id);

export function toggle(entry) {
  const items = read();
  const i = items.findIndex((x) => x.id === entry.id);
  if (i >= 0) items.splice(i, 1);
  else items.unshift(entry);
  write(items);
  broadcast();
  return i < 0;
}

export function remove(id) {
  write(read().filter((x) => x.id !== id));
  broadcast();
}

export const clear = () => {
  write([]);
  broadcast();
};

function broadcast() {
  window.dispatchEvent(new CustomEvent('shortlist:change', { detail: read() }));
}

/** 頁首的計數徽章，在每一頁都要反映最新數量 */
export function mountCounter() {
  const el = document.getElementById('shortlist-count');
  if (!el) return;
  const paint = () => {
    const n = read().length;
    el.textContent = n ? String(n) : '';
    el.hidden = n === 0;
  };
  window.addEventListener('shortlist:change', paint);
  // 另一個分頁改動時同步
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) paint();
  });
  paint();
}
