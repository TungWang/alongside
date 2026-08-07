// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './src/lib/site.js';

export default defineConfig({
  site: SITE_URL,
  trailingSlash: 'always',
  integrations: [sitemap()],
  build: {
    // 產生 /d/板橋區/index.html 這種結構，Firebase Hosting 直接就能服務乾淨網址
    format: 'directory',
  },
  // 全站唯一的兩段腳本（篩選、複製名稱）都很短，直接內嵌避免多送兩個檔案請求
  vite: {
    build: {
      assetsInlineLimit: 4096,
    },
  },
});
