==============================
Battle Damege Calc (BDC) 公開用 追加ファイル（同梱手順）
==============================

1) このフォルダの中身を、あなたのプロジェクトのルートに「上書きでコピー」してください。
   - `icons/`, `.well-known/`, `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, `opengraph.png` など

2) `index.html` を開き、以下を挿入
   - `inject_head.html` の中身を、`</head>` の直前にそのまま貼り付け
   - `inject_body_end.html` の中身を、`</body>` の直前にそのまま貼り付け
   - フッターが無い場合は、`footer_block.html` を `</body>` の直前に貼り付けてもOK

   置換ポイント：
   - injectファイル内の `https://YOUR-DOMAIN` をあなたの本番URL（例：https://bdc4.pages.dev）に置換

3) 免責・プライバシー
   - `disclaimer.html`, `privacy.html` はそのままルートに置いてOK（文言は適宜編集）

4) オフライン対応（任意）
   - `sw.js` と `offline.html` はルート直下に置いてください
   - Service Worker は自動登録（`inject_body_end.html` 内）

5) 検索エンジン
   - `robots.txt` と `sitemap.xml` の中の `https://YOUR-DOMAIN` を本番URLに置換

6) セキュリティヘッダー（任意）
   - `_headers_plus` を `_headers` にリネームして有効化（まずは Preview で動作確認）

7) 反映
   - Git にコミット＆プッシュ、または Cloudflare Pages「Drag and drop」でデプロイ

—————
補足：
- すべて「アプリ本体のJS/計算ロジック」には触れていません。公開に必要な静的資産のみ追加です。
- 何か壊れた場合は `_headers`（セキュリティヘッダー）だけ外して再デプロイしてください。