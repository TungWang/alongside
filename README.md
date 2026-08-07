# 育兒同行 Alongside

新北市幼兒園與托嬰中心的資訊整理站。純靜態，部署在 Firebase Hosting 免費方案，現金支出 0 元。

規劃背景與決策理由見 [托育網站規劃文件.md](托育網站規劃文件.md)，設計規格見 [ui-mockup.html](ui-mockup.html)。

## 它做什麼

把散在三個政府網站的資訊集中成一頁：機構基本資料來自新北市開放資料，地圖與家長評價連到 Google 地圖，
裁罰、評鑑、收退費、補助則導向主管機關的官方查詢頁。

本站不評分、不排名、不轉載評論，也不自建違規紀錄資料庫。

## 指令

```bash
npm install          # 安裝相依套件
npm run fetch        # 只抓開放資料，更新 src/data/institutions.json
npm run dev          # 本機開發伺服器 http://localhost:4321
npm run build        # 抓資料 + 建置到 dist/
npm run build:offline # 用現有 institutions.json 建置，不連網
npm run preview      # 預覽 dist/ 的建置結果
```

## 架構

```
scripts/fetch-data.js   下載三個開放資料集 → 正規化 → src/data/institutions.json
src/lib/site.js         全站設定：網址、標籤配色、官方連結對照表
src/pages/index.astro   首頁（29 個行政區入口）
src/pages/d/[district]  行政區列表頁，共 29 頁
src/pages/i/[id]        機構頁，共 1,493 頁 ← SEO 主戰場
dist/                   建置產物，直接部署到 Firebase Hosting
```

建置產出 1,524 頁、約 13 MB。

## 兩個容易踩到的地方

**三個資料集的地址格式不一樣。** 幼兒園是 `[220]新北市板橋區流芳里9鄰東門街30號`（含郵遞區號、縣市、
行政區、里鄰），托嬰與公托只有街段 `莊敬路46號2樓`。`toStreet()` 統一剝成街段再自己組回去。
剝除一律只在字串開頭做——實測有街名叫「區運路」，任何「切到第一個『區』字」的寫法都會把它砍壞。
另有少數資料用了異體字「新北巿」（U+5DFF）、地址中夾換行，都已處理。

**幼兒園和托嬰中心歸不同主管機關。** 幼兒園是教育部／新北市教育局，托嬰中心與公托是衛福部／新北市社會局，
兩套查詢系統完全獨立，官方連結必須依 `authority` 分開給。教育部那三個查詢頁是 ASP.NET POST 表單，
沒辦法用網址帶入園名，所以機構頁要先提供「複製機構名稱」按鈕。

## 成本紅線

只用 Firebase Hosting，不啟用 Cloud Functions / Firestore / Storage——那些會被推去綁信用卡的 Blaze 方案。
資料抓取與建置都在 GitHub Actions（免費額度內）完成，上線後的網站不依賴任何後端服務。

地圖與評價走 Google 地圖「連結」，家長點擊才由他們的瀏覽器開啟 Google，本站不呼叫任何 API，無金鑰、無用量、無費用。

## 部署

見 [DEPLOY.md](DEPLOY.md)。
