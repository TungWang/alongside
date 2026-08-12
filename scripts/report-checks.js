// scripts/report-checks.js
//
// 把需要人判斷的事情變成一張 GitHub 待辦（issue），寄到維護者信箱。
//
// 為什麼是 issue 而不是讓建置失敗：擋下建置不會讓線上那份錯金額消失，
// 只會讓機構名冊、裁罰這些沒問題的資料一起停止更新——用一個政策數字凍結整站不成比例。
//
// 去重是這支程式的重點。同一個問題如果每個月寄你一封，三個月後你就不看了，
// 那這個機制等於沒有。所以：已經有一張開著的同類待辦，就完全不動作。
// 你把它關掉才代表處理完了；問題若還在，下個月會重新開一張。
//
// 用法：node scripts/report-checks.js
// 需要環境變數 GITHUB_TOKEN 與 GITHUB_REPOSITORY（GitHub Actions 會自動提供）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldWarnOnSite } from './check-subsidy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/checks.json'), 'utf8'));

const LABEL = '自動偵測';
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;

/** 把狀態變成待辦內容。回傳 null 代表沒事，不用開。 */
export function reportFor(state) {
  const s = state.subsidy;
  if (!s || s.status === 'ok' || s.status === 'unreachable') return null;

  if (s.status === 'mismatch') {
    return {
      title: '補助費率與教育部公告對不上',
      body: [
        '每月自動核對發現 `src/lib/subsidy.js` 採用的金額與教育部全國教保資訊網不一致。',
        '',
        `**差異**：${s.detail}`,
        `**偵測日**：${s.checkedAt}`,
        '',
        '網站已照常發布，但補助試算旁邊已經自動掛上警語，家長看得到提醒。',
        '',
        '### 要做什麼',
        '1. 打開下面三個官方頁面，人工確認現行金額。',
        '2. 確認政策真的變了，就更新 `src/lib/subsidy.js` 的 `CAPS` / `ALLOWANCE` / `SUBSIDY_UPDATED`，',
        '   以及 `scripts/check-subsidy.js` 的 `EXPECTED` / `CURRENT_PERIOD` / `CURRENT_ALLOWANCE_SINCE`。',
        '   兩邊都要改——`verify.js` 有一條檢查會擋住只改一邊的情況。',
        '3. 若只是官網改版導致誤判，修 `check-subsidy.js` 的解析。',
        '4. 處理完把這張待辦關掉。問題還在的話，下個月會重新開一張。',
        '',
        '- https://www.ece.moe.edu.tw/ch/subsidy/public-non-profit/',
        '- https://www.ece.moe.edu.tw/ch/subsidy/zgg-1/',
        '- https://www.ece.moe.edu.tw/ch/subsidy/allowance-1/',
      ].join('\n'),
    };
  }

  return {
    title: '補助費率讀不到，可能是教育部網站改版',
    body: [
      '每月自動核對無法從教育部頁面解析出補助金額。**這不代表金額錯了**，多半只是官網改版。',
      '',
      `**解析失敗原因**：${s.detail}`,
      `**連續失敗次數**：${s.consecutiveUnreadable}`,
      `**偵測日**：${s.checkedAt}`,
      '',
      shouldWarnOnSite(s)
        ? '⚠️ 已連續兩次以上失敗，網站上已經開始顯示「無法自動核對」的說明。'
        : '網站上還沒有任何提示——第一次失敗視為雜訊。若下個月仍失敗才會上站。',
      '',
      '### 要做什麼',
      '修 `scripts/check-subsidy.js` 裡 `readFeeTable` / `readAllowance` 的解析，讓它對得上新版頁面。',
      '順手人工核對一次金額有沒有真的變。處理完把這張待辦關掉。',
    ].join('\n'),
  };
}

async function api(pathname, init) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${pathname}：HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const report = reportFor(STATE);
  if (!report) {
    console.log('  ✓ 沒有需要人處理的事');
    return;
  }
  if (!TOKEN || !REPO) {
    console.log(`  ! 本機執行，不開待辦。內容會是：\n\n${report.title}\n\n${report.body}\n`);
    return;
  }

  const open = await api(
    `/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100`,
  );
  const existing = open.find((i) => i.title === report.title);
  if (existing) {
    // 刻意什麼都不做：連留言都不留。留言一樣會寄信，一樣會變成每月一封。
    console.log(`  · 已有開啟中的待辦 #${existing.number}，不重複開`);
    return;
  }

  const created = await api(`/repos/${REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: report.title, body: report.body, labels: [LABEL] }),
  });
  console.log(`  → 已開待辦 #${created.number}：${report.title}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
