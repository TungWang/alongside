// scripts/check-subsidy.js
//
// 每月核對 src/lib/subsidy.js 裡的補助金額，跟教育部全國教保資訊網是否一致。
//
// 為什麼需要這個：站上大部分數字都是「抓下來的」，抓不到就消失，家長看得出來。
// 補助費率不一樣——它是寫死在程式裡的政策數字。政策調整後程式照樣算得出漂亮的金額，
// 只是錯的，而那正是家長最會拿來做決定的數字。招生日期過期會自己講，這個不會。
//
// 為什麼只偵測、不自動更新：本檔第一版的解析就抓錯欄位——官方表格是「歷次調整」的
// 多欄結構，同一列有 2,500／1,500／1,000 三個數字，現行金額是最後一欄。若讓它自動採用
// 抓到的值，那個錯誤會直接寫上網站。偵測錯了最多是誤報，成本是人工核對五分鐘。
//
// 三種失敗不是同一件事，混為一談會讓警語變成狼來了：
//   unreachable 連不上——官網短暫掛掉很常見，什麼都不做。
//   unreadable  解析不出來——多半是官網改版，沒有證據說金額錯了。只開待辦，
//               連續兩個月才在站上說明「已經有一段時間無法自動核對」。
//   mismatch    解析成功但數字不同——這才是真的，站上立刻標警語。
//
// 用法：node scripts/check-subsidy.js（在 npm run fetch 之後跑，寫入 src/data/checks.json）

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = path.join(ROOT, 'src/data/checks.json');

/** 解析不出來時丟這個，跟「網路連不上」在呼叫端要分開處理 */
export class UnreadableError extends Error {}

const SOURCES = {
  caps: 'https://www.ece.moe.edu.tw/ch/subsidy/public-non-profit/',
  quasi: 'https://www.ece.moe.edu.tw/ch/subsidy/zgg-1/',
  allowance: 'https://www.ece.moe.edu.tw/ch/subsidy/allowance-1/',
};

/**
 * 目前站上採用的數字，與 src/lib/subsidy.js 必須一致。
 * verify.js 有一條檢查會比對兩邊，避免改了一邊忘了另一邊。
 *
 * 官方表格把非營利與職場互助併成同一列（兩者金額本來就相同），所以核對非營利那列
 * 等於同時核對了 subsidy.js 裡的兩個項目。
 */
export const EXPECTED = {
  公立幼兒園: { 1: 1000, 2: 0, 3: 0 },
  非營利幼兒園: { 1: 2000, 2: 1000, 3: 0 },
  準公共幼兒園: { 1: 3000, 2: 2000, 3: 1000 },
  育兒津貼: { 1: 5000, 2: 6000, 3: 7000 },
};

/** 現行費率所在的那一欄。政策一調整，官方表格就會多一欄，這個字串是最靈敏的哨兵 */
export const CURRENT_PERIOD = '111.8以後';
export const CURRENT_ALLOWANCE_SINCE = '110年8月1日起'; // ← 警報測試用，測完改回 111年8月1日起

/** 把 HTML 壓成一行純文字。表格結構在文字順序裡仍然成立，不需要 DOM */
export function flatten(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const toNumber = (raw) => (raw === '免費' ? 0 : Number(raw.replace(/[^\d]/g, '')));

/**
 * 讀出一張「家長每月繳費」表。
 *
 * 表頭長這樣：類型 幼兒出生次序/屬性 107.8~110.7 110.8~111.7 111.8以後
 * 每一列長這樣：公立幼兒園 第 1 胎 不超過 2,500元/月 不超過 1,500元/月 不超過 1,000元/月
 *
 * 所以每格有「欄數」個值，現行的是最後一個。欄數本身也回傳出去，因為多一欄
 * 就代表政策調整了——那比金額對不上更早、更明確。
 */
export function readFeeTable(text, rowLabels) {
  const headStart = text.search(/幼兒出生次序\s*\/\s*屬性/);
  if (headStart < 0) throw new UnreadableError('找不到表頭「幼兒出生次序/屬性」');

  const firstRow = Math.min(
    ...rowLabels.map((l) => {
      const i = text.indexOf(l, headStart);
      return i < 0 ? Infinity : i;
    }),
  );
  if (!Number.isFinite(firstRow)) throw new UnreadableError(`找不到任何列：${rowLabels.join('、')}`);

  const periods = [...text.slice(headStart, firstRow).matchAll(/\d+\.\d+\s*~\s*\d+\.\d+|\d+\.\d+以後/g)]
    .map((m) => m[0].replace(/\s+/g, ''));
  if (periods.length < 2) throw new UnreadableError(`表頭解析不到期間欄位（得到 ${periods.length} 欄）`);

  // 表格到「低收、中低收入家庭子女」為止，再往後是備註，裡面也有「不超過」會誤抓
  const tail = text.indexOf('低收、中低收入家庭子女', firstRow);
  const table = text.slice(firstRow, tail < 0 ? undefined : tail);

  const rows = {};
  for (const label of rowLabels) {
    const start = table.indexOf(label);
    if (start < 0) throw new UnreadableError(`找不到「${label}」這一列`);
    const nextStarts = rowLabels
      .map((l) => (l === label ? -1 : table.indexOf(l, start + label.length)))
      .filter((i) => i > start);
    const block = table.slice(start, nextStarts.length ? Math.min(...nextStarts) : undefined);

    const orders = [...block.matchAll(/第\s*(\d)\s*胎/g)];
    if (!orders.length) throw new UnreadableError(`「${label}」這一列找不到胎次`);

    const byOrder = {};
    for (let i = 0; i < orders.length; i++) {
      const from = orders[i].index + orders[i][0].length;
      const to = i + 1 < orders.length ? orders[i + 1].index : block.length;
      const cells = [...block.slice(from, to).matchAll(/不超過\s*([\d,]+)\s*元|免費/g)].map((m) =>
        toNumber(m[1] ?? '免費'),
      );
      if (cells.length !== periods.length) {
        throw new UnreadableError(
          `「${label}」第 ${orders[i][1]} 胎有 ${cells.length} 個金額，表頭卻有 ${periods.length} 欄`,
        );
      }
      byOrder[orders[i][1]] = cells.at(-1); // 最後一欄＝現行
    }
    rows[label] = byOrder;
  }
  return { periods, rows };
}

/**
 * 讀出育兒津貼。這頁的結構不同：每一列是一個生效日期加三個金額，
 * 現行的是最後一列，所以「有沒有出現更晚的生效日」就是政策調整的哨兵。
 */
export function readAllowance(text) {
  const rows = [...text.matchAll(/(\d+年\d+月\d+日起)\s*((?:[\d,]+\s*元\(每月\)\s*){3})/g)];
  if (!rows.length) throw new UnreadableError('找不到任何「N年N月N日起」的金額列');
  const last = rows.at(-1);
  const values = [...last[2].matchAll(/([\d,]+)\s*元/g)].map((m) => toNumber(m[1]));
  return { since: last[1], rows: rows.length, byOrder: { 1: values[0], 2: values[1], 3: values[2] } };
}

/** 把解析結果跟站上採用的數字比對。回傳不一致的描述陣列，空陣列代表全部對上 */
export function diff({ capsTable, quasiTable, allowance }) {
  const bad = [];

  for (const table of [capsTable, quasiTable]) {
    const period = table.periods.at(-1);
    if (period !== CURRENT_PERIOD) {
      bad.push(`表頭最後一欄是「${period}」，站上依據的是「${CURRENT_PERIOD}」——官方可能新增了適用期間`);
    }
  }
  if (allowance.since !== CURRENT_ALLOWANCE_SINCE) {
    bad.push(
      `育兒津貼最後一列生效日是「${allowance.since}」，站上依據的是「${CURRENT_ALLOWANCE_SINCE}」`,
    );
  }

  const actual = { ...capsTable.rows, ...quasiTable.rows, 育兒津貼: allowance.byOrder };
  for (const [label, orders] of Object.entries(EXPECTED)) {
    for (const [order, want] of Object.entries(orders)) {
      const got = actual[label]?.[order];
      if (got !== want) bad.push(`${label} 第 ${order} 胎：站上 ${want}，官網 ${got}`);
    }
  }
  return bad;
}

/**
 * 把這次的結果併進既有狀態。
 *
 * 連不上不改變任何判斷——我們這次什麼都沒學到，沿用上次的結論，
 * 否則官網掛一天就會把連續失敗的計數洗掉，升級規則永遠不會觸發。
 */
export function merge(prev, result, today) {
  const base = prev ?? { status: 'ok', consecutiveUnreadable: 0 };
  if (result.status === 'unreachable') {
    return { ...base, lastAttempt: today, lastError: result.detail };
  }
  return {
    status: result.status,
    detail: result.detail ?? null,
    checkedAt: today,
    lastAttempt: today,
    consecutiveUnreadable: result.status === 'unreadable' ? base.consecutiveUnreadable + 1 : 0,
  };
}

/**
 * 站上要不要顯示警語。
 * 解析失敗第一次不顯示（多半只是改版），連續兩個月才顯示——
 * 一次失敗是雜訊，兩個月都失敗代表這個核對機制真的停了，那件事家長有權知道。
 */
export const shouldWarnOnSite = (s) =>
  s?.status === 'mismatch' || (s?.status === 'unreadable' && s.consecutiveUnreadable >= 2);

// --- 執行 -----------------------------------------------------------------

async function run(today) {
  let texts;
  try {
    const [a, b, c] = await Promise.all(
      Object.values(SOURCES).map(async (url) => {
        for (let i = 0; i < 3; i++) {
          if (i) await new Promise((r) => setTimeout(r, 800 * 2 ** (i - 1)));
          try {
            const res = await fetch(url);
            if (res.ok) return flatten(await res.text());
          } catch {
            /* 重試 */
          }
        }
        throw new Error(`${url} 取不到`);
      }),
    );
    texts = { caps: a, quasi: b, allowance: c };
  } catch (err) {
    return { status: 'unreachable', detail: err.message };
  }

  let parsed;
  try {
    parsed = {
      capsTable: readFeeTable(texts.caps, ['公立幼兒園', '非營利幼兒園']),
      quasiTable: readFeeTable(texts.quasi, ['準公共幼兒園']),
      allowance: readAllowance(texts.allowance),
    };
  } catch (err) {
    if (err instanceof UnreadableError) return { status: 'unreadable', detail: err.message };
    throw err;
  }

  const bad = diff(parsed);
  return bad.length
    ? { status: 'mismatch', detail: bad.join('；') }
    : { status: 'ok', detail: null };
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  let state = {};
  try {
    state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    /* 第一次跑，沒有舊狀態 */
  }

  const result = await run(today);
  state.subsidy = merge(state.subsidy, result, today);

  await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

  const s = state.subsidy;
  const mark = { ok: '✓', unreachable: '·', unreadable: '?', mismatch: '✗' }[s.status];
  console.log(`  ${mark} 補助費率：${s.status}${s.detail ? `　${s.detail}` : ''}`);
  if (shouldWarnOnSite(s)) console.log('    → 站上會顯示警語');
  // 刻意不 exit 1：這是提醒不是中止。擋下建置不會讓線上那份錯金額消失，
  // 只會讓機構名冊、裁罰這些沒問題的資料一起停止更新。
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
