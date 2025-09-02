# GitHub 手動アップロード完全ガイド

## ⚠️ 重要: ファイルは必ずリポジトリのルートに配置

### 手順1: 既存ファイルの削除（必要に応じて）
1. GitHub リポジトリで不要なサブフォルダがあれば削除

### 手順2: 必須ファイルを順番にアップロード

**1. package.json (最優先)**
- 「Add file」→「Create new file」
- ファイル名: `package.json`
- 内容をコピペして Commit

**2. server-production.js**
- 「Add file」→「Upload files」
- ファイルをドラッグ&ドロップ

**3. vercel.json**
- 同様にアップロード

**4. public フォルダ**
- 「Create new file」で以下を作成:
  - `public/index.html`
  - `public/styles.css`  
  - `public/script.js`

### 手順3: 最終確認
リポジトリルートに以下が表示されることを確認:
```
✅ package.json
✅ server-production.js  
✅ vercel.json
✅ public/
   ├── index.html
   ├── styles.css
   └── script.js
```

### 手順4: Vercel再デプロイ
- Vercel Dashboard → Redeploy
- 「Use existing Build Cache」のチェックを外す
- Deploy実行