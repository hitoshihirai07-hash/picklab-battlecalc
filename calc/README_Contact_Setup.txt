# BDC お問い合わせフォーム 追加手順

このフォルダには「`contact.html`（埋め込み用の空スロット付き）」など一式が入っています。
Google フォームを作って iframe を貼るだけで動きます。計算ロジックは触りません。

---
## 1) Google フォームを作成
- タイトル: **BDC フィードバック / お問い合わせ**
- 質問例（推奨）:
  - お名前（任意・短文）
  - 連絡先メール（任意・メール）
  - 端末/ブラウザ（選択肢：PC/スマホ iOS/スマホ Android/その他）
  - 種別（選択肢：不具合/改善要望/表記誤り/その他）
  - 事象の詳細（長文）
  - 再現手順（長文）
  - スクリーンショットURL（短文）
  - 同意（チェックボックス：プライバシーポリシーに同意）
- 右上「**設定**」:
  - 「メールアドレスを収集」**オフ（任意）**
  - 「ログインを必要とする」**オフ**
  - 「回答のコピーを回答者に送信」**オフ（任意）**
  - 確認メッセージ: **ご協力ありがとうございます。内容を受け取りました。**
- 回答 → スプレッドシート作成（任意、後から分析が楽）

## 2) 埋め込みコードを取得
- 右上「**送信**」→「**<>**（埋め込み）」→ **幅=100%**、高さは 1200 前後に
- 生成された `<iframe ...>` をコピー

## 3) contact.html へ貼り付け
- `contact.html` をエディタで開き、`<!-- ▼▼▼ -->` のコメント行から `<!-- ▲▲▲ -->` のブロックを **コピーした iframe 一発**に置き換え
- 例：
  ```html
  <iframe class="embed" src="https://docs.google.com/forms/d/e/XXXXXXXXXXXXXXXX/viewform?embedded=true"
          allow="clipboard-write; encrypted-media" loading="lazy"></iframe>
  ```

## 4) 配置とリンク
- `contact.html` を **サイトのルート直下**に追加してデプロイ
- フッターやメニューに **/contact.html** へのリンクを 1 箇所追加（例：トップのフッターに「お問い合わせ」）

## 5) 追記（任意だが推奨）
- `privacy.html` に **Google フォームの利用**について 1 文追記（`privacy_addendum_googleforms.txt` を参考に）
- `sitemap.xml` に `<loc>https://YOUR-DOMAIN/contact.html</loc>` を追加（`sitemap_contact_snippet.xml` 参照）

## トラブルシュート
- フォームが表示されない → Google フォームの共有が「リンクを知っていれば誰でも」になっているか確認
- スマホで右側が切れる → iframe に `width="100%"`、CSS で `.embed{width:100%}` になっているか確認
- 迷惑回答対策 → Google 側の reCAPTCHA（自動）、必要なら Cloudflare 側の Bot 対策も併用

以上です。