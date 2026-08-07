# 部署步驟

以下每一步都涉及你的帳號與憑證，需要你本人操作。照順序做，中間可以停。

---

## 步驟 1　建 GitHub repo

1. 到 [github.com/new](https://github.com/new) 建一個新的 repository。
   - 名稱隨意（例如 `alongside`）
   - **選 Public**——公開 repo 的 GitHub Actions 完全免費，私有 repo 每月只有 2,000 分鐘額度
   - 不要勾「Add a README file」，這裡已經有了
2. 回到終端機，在專案目錄執行（把網址換成你剛建的）：

```bash
git remote add origin https://github.com/你的帳號/alongside.git && git branch -M main && git push -u origin main
```

---

## 步驟 2　建 Firebase 專案

1. 到 [console.firebase.google.com](https://console.firebase.google.com/) 用 Google 帳號登入，點「建立專案」。
2. **專案 ID 就是你的網址，建立後不能改。** 例如專案 ID 填 `alongside-tw`，網站就會是
   `https://alongside-tw.web.app`。挑一個好記、拼得出來的。
3. Google Analytics 這一步**先關掉**，之後要再開很容易。
4. 建好後進入專案，左側選單找到「Hosting」，點「開始使用」。前面幾步照著點完即可，
   它會叫你安裝 CLI，下一步會做。
5. **全程維持免費的 Spark 方案，不要升級到 Blaze**，就不會被要求綁信用卡。
   Hosting 在 Spark 方案有每月約 10 GB 儲存、360 MB／日傳輸，這個站約 13 MB，綽綽有餘。

---

## 步驟 3　把網址填進程式碼

專案 ID 決定後，改兩個地方（canonical 網址與 sitemap 都靠它，填錯 Google 會收錄到不存在的網址）：

- `src/lib/site.js` 第一個常數 `SITE_URL`
- `public/robots.txt` 最後一行的 Sitemap 網址

兩處都把 `https://alongside-tw.web.app` 換成你的實際網址。

---

## 步驟 4　第一次手動部署

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

會開瀏覽器要你授權 Google 帳號。授權完回到終端機：

```bash
firebase use --add
```

選你剛建的專案，alias 隨便填（例如 `default`）。然後：

```bash
npm run build && firebase deploy --only hosting
```

跑完會印出你的網址。開起來確認首頁、隨便點一個行政區、再點一間機構——三層都正常就成功了。

---

## 步驟 5　設定 GitHub Actions 自動更新

這一步做完，每月 1 號會自動抓最新開放資料、重建網站、部署上線，你不用開電腦。

**5a. 產生部署金鑰**

在專案目錄執行：

```bash
firebase init hosting:github
```

它會問你 GitHub repo（填 `你的帳號/alongside`），然後自動產生一組 service account 金鑰並存進
GitHub Secrets，名稱是 `FIREBASE_SERVICE_ACCOUNT_你的專案ID`。

過程中它會問要不要覆寫 workflow 檔案——**選 No**，這裡已經寫好一份更完整的了。

**5b. 對齊 Secret 名稱**

打開 `.github/workflows/update.yml`，把這一行：

```yaml
firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
```

改成上一步實際產生的名稱，例如 `${{ secrets.FIREBASE_SERVICE_ACCOUNT_ALONGSIDE_TW }}`。
確切名稱可到 GitHub repo 的 Settings → Secrets and variables → Actions 查看。

**5c. 設定專案 ID 變數**

同一頁切到「Variables」分頁 → New repository variable：

- Name: `FIREBASE_PROJECT_ID`
- Value: 你的 Firebase 專案 ID

**5d. 測試**

推上去後到 repo 的 Actions 分頁，選「每月更新資料並部署」→ Run workflow 手動觸發一次。
綠燈就代表自動化通了。

> 金鑰一律放 GitHub Secrets，**絕不 commit 進程式碼**。`.gitignore` 已經擋掉 `.env` 與 `.firebase/`。

---

## 步驟 6　讓 Google 找到你

**Search Console**（SEO 命脈，這站的流量全靠它）

1. 到 [search.google.com/search-console](https://search.google.com/search-console/) 新增資源。
2. 選「網址前置字元」，填你的 `https://xxx.web.app/`。
3. 驗證方式選「HTML 標記」，它會給你一段 `<meta name="google-site-verification" ...>`。
   把那一行加進 `src/layouts/Base.astro` 的 `<head>` 裡，重新 build + deploy，再回去按驗證。
4. 驗證過後，左側「Sitemap」→ 提交 `sitemap-index.xml`。
5. 收錄要等幾天到幾週。1,500 頁不會一次全收，慢慢來。

**Analytics**（想看流量再做，不急）

[analytics.google.com](https://analytics.google.com/) 建資源，拿到 `G-XXXXXXX` 追蹤碼後加進 `Base.astro`。

**AdSense**（最後才做）

新站內容太少會被拒。建議等 Search Console 顯示已收錄大部分頁面、且有一些自然流量之後再申請。
申請通過後在機構頁與列表頁放少量版位就好——家長的信任感是這類網站的命脈，廣告塞太多會反效果。

---

## 之後想改東西

改完程式碼 `git push` 就會自動重新部署（workflow 有設 `push: branches: [main]`）。
只想在本機看效果不部署，用 `npm run dev`。
