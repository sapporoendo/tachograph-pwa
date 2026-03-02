# タコグラフ撮影 PWA

## セットアップ手順

```bash
# 1. このフォルダに移動
cd tachograph-pwa

# 2. 依存パッケージをインストール
npm install

# 3. 開発サーバー起動
npm run dev
# → http://localhost:3000 でブラウザ確認

# 4. 本番ビルド（PWA化）
npm run build
npm run start
```

## ファイル構成

```
tachograph-pwa/
├── src/
│   ├── app/
│   │   ├── layout.tsx      # HTML全体の枠（PWAメタタグ含む）
│   │   ├── page.tsx        # トップページ
│   │   └── globals.css     # Tailwind読み込み
│   └── components/
│       └── CameraView.tsx  # カメラUI（ガイド円付き）← 主な編集対象
├── public/
│   └── manifest.json       # PWA設定
├── next.config.js           # PWA（next-pwa）設定
└── package.json
```

## 次のステップ候補

- [ ] 撮影画像をサーバーに自動アップロード（Fabric / S3 など）
- [ ] 撮影履歴一覧ページ
- [ ] アイコン画像（icon-192.png, icon-512.png）を public/ に追加
- [ ] iOSホーム画面への追加テスト

## 注意

- `npm run dev` では PWA は無効（開発効率のため）
- `npm run build && npm start` で PWA 機能が有効になる
- カメラはHTTPS環境（本番）またはlocalhost（開発）でのみ動作
