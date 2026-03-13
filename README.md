# Browser Screenshot All

**開いている全タブのスクリーンショットをワンクリックで一括保存するブラウザ拡張機能**

Microsoft Edge / Google Chrome 対応 | Manifest V3 | ビルド不要

---

## どんな拡張機能？

ブラウザで調べものをしていて「今開いてるタブ全部まとめて保存したい」と思ったことはありませんか？

この拡張機能は、**現在のウィンドウで開いている全タブを自動で順番にスクリーンショット撮影**し、**ZIP ファイルにまとめて一発で保存**します。

- 10 個タブが開いていれば 10 枚のスクリーンショットが ZIP に入ります
- ページの一番下まで自動スクロールして全体をキャプチャするモードもあります
- `edge://` や `chrome://` などのシステムページは自動でスキップします
- 1 つのタブで失敗しても他のタブの処理は止まりません

## 主な機能

| 機能 | 説明 |
|------|------|
| **全タブ一括キャプチャ** | 現在のウィンドウの全タブを順番に処理。他のウィンドウは対象外 |
| **2つの撮影モード** | ページ全体キャプチャ (スクロール結合) / 表示範囲のみ |
| **ZIP 一括保存** | 全画像を日時付き ZIP (`edge_tabs_capture_YYYYMMDD_HHMMSS.zip`) で保存 |
| **メタデータ同梱** | `metadata.json` と `summary.txt` を ZIP に含める |
| **画像形式選択** | PNG / JPEG (JPEG は品質スライダーで調整可能) |
| **Lazy load 対策** | 撮影前にページ末尾まで一度スクロールして画像を読み込ませる (ON/OFF 可) |
| **fixed ヘッダー対策** | 固定ヘッダー等を一時的に解除して重複を防止 |
| **エラー耐性** | 1 タブの失敗で全体が止まらない。スキップ/エラーは一覧表示 |
| **設定の記憶** | モードや形式の選択を保存。次回起動時に復元 |

## 対応ブラウザ

| ブラウザ | 対応状況 |
|----------|----------|
| **Microsoft Edge** (Chromium 版) | 対応 |
| **Google Chrome** | 対応 |

どちらも同じ Chromium ベースのため、**まったく同じファイルをそのまま読み込むだけ**で動作します。

## インストール手順

### 1. ダウンロード

```bash
git clone https://github.com/naofumi0814/Browser-Screenshot-All-Plugin.git
```

または GitHub ページ右上の **Code → Download ZIP** でダウンロードして展開してください。

### 2-A. Microsoft Edge にインストール

1. Edge のアドレスバーに `edge://extensions/` と入力
2. 左下の **「開発者モード」** をオンにする
3. **「展開して読み込み」** をクリック
4. ダウンロードした `edge-tabs-screenshot` フォルダを選択
5. ツールバーにアイコンが表示されれば完了

### 2-B. Google Chrome にインストール

1. Chrome のアドレスバーに `chrome://extensions/` と入力
2. 右上の **「デベロッパーモード」** をオンにする
3. **「パッケージ化されていない拡張機能を読み込む」** をクリック
4. ダウンロードした `edge-tabs-screenshot` フォルダを選択
5. ツールバーにアイコンが表示されれば完了

> **ヒント**: ツールバーにアイコンが見えない場合は、パズルピースのアイコン (拡張機能メニュー) をクリックして「Edge Tabs Screenshot All」をピン留めしてください。

## 使い方

1. ブラウザで複数のタブを開いた状態にする
2. ツールバーの拡張機能アイコンをクリック
3. 設定を選択:
   - **撮影モード**: 「全体キャプチャ」 or 「表示範囲のみ」
   - **画像形式**: PNG or JPEG
   - **Lazy load 対策**: ON / OFF
4. **「スクリーンショット開始」** をクリック
5. 自動でタブが順番に切り替わりながら撮影が進む
6. 完了すると ZIP ファイルの保存ダイアログが表示される
7. アイコンを再度クリックすると結果サマリーが表示される

> **注意**: 処理中はタブが自動で切り替わります。処理が終わるまでタブの操作は避けてください。完了後、元のアクティブタブに自動で戻ります。

## 出力される ZIP の中身

```
edge_tabs_capture_20250313_143022.zip
├── 01_example.com_Example_Page.png
├── 02_github.com_naofumi0814_Browser-Screenshot-All-Plugin.png
├── 03_google.com_Google.png
├── ...
├── metadata.json    ← 各タブの詳細情報 (JSON)
└── summary.txt      ← 処理結果のサマリー (テキスト)
```

### 画像ファイル名の規則

```
{連番}_{ドメイン名}_{ページタイトル}.png
```

- 連番は 01 から
- ファイル名に使えない文字 (`\ / : * ? " < > |` など) は自動除去
- タイトルは 80 文字で切り詰め

### metadata.json

```json
[
  {
    "tabIndex": 1,
    "title": "Example Page",
    "url": "https://example.com",
    "hostname": "example.com",
    "captureMode": "full",
    "status": "success",
    "errorMessage": null,
    "capturedAt": "2025-03-13T14:30:22.000Z"
  }
]
```

### summary.txt

```
Edge Tabs Screenshot - Summary
================================
処理日時: 2025/3/13 14:30:22
撮影モード: 全体キャプチャ
画像形式: PNG
対象タブ数: 10
成功: 8
スキップ: 1
エラー: 1

--- 詳細 ---
[SUCCESS] Tab1: Example Page (https://example.com)
[SKIPPED] Tab2: 拡張機能 (edge://extensions/) - システムページまたはアクセス不可のURL
...
```

## プロジェクト構成

```
edge-tabs-screenshot/
├── manifest.json      Manifest V3 定義
├── background.js      Service Worker (キャプチャ制御・ZIP 生成)
├── content.js         コンテンツスクリプト (スクロール制御・ページ情報取得)
├── popup.html         ポップアップ UI
├── popup.css          スタイル
├── popup.js           UI 制御・進捗ポーリング
├── lib/
│   └── jszip.min.js   JSZip 3.10.1 (ローカル同梱)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### 技術構成

- **Manifest V3** (最新の拡張機能仕様)
- **素の JavaScript** のみ。フレームワークなし
- **ビルド不要**。ファイルをそのまま読み込むだけ
- 外部依存は **JSZip** のみ (ZIP 生成に使用、ローカルに同梱済み)
- 画像結合は **OffscreenCanvas** + **createImageBitmap** で Service Worker 内完結
- 使用 API: `chrome.tabs`, `chrome.scripting`, `chrome.downloads`, `chrome.storage`, `chrome.windows`

## 制限事項

### スキップされるページ

以下のページはキャプチャ対象外として自動スキップされます (ZIP 内の metadata.json にスキップ理由を記録):

- `edge://`, `chrome://` ページ (設定、拡張機能管理など)
- 拡張機能ページ (`chrome-extension://`)
- `about:`, `data:`, `blob:`, `file://`, `devtools://`, `view-source:`

### 全体キャプチャモードの制限

| 項目 | 内容 |
|------|------|
| fixed / sticky ヘッダー | 大きい要素は一時的に `position: absolute` に変更して対処。完全ではない |
| Canvas 高さ上限 | 65,535px を超える非常に長いページは途中で切り詰め |
| 動的コンテンツ | スクロール中にレイアウトが変わるページでは結合画像にズレが生じる場合がある |
| 無限スクロール | すべてのコンテンツを読み込みきれない場合がある |
| アニメーション | 撮影タイミングが意図しないフレームになることがある |
| iframe | cross-origin の iframe 内はキャプチャに含まれるが、スクロール制御の対象外 |

### その他の制限

- 処理中にタブを閉じたり追加すると予期しない動作になる場合がある
- 大量のタブ (数十個以上) では メモリ使用量が多くなる
- 高 DPI ディスプレイでは画像サイズが大きくなる

## テスト手順

### 基本テスト

1. 3〜5 個の Web ページタブを開く
2. 「表示範囲のみ」モードで実行
3. ZIP がダウンロードされ、中に画像 + metadata.json + summary.txt があることを確認

### 全体キャプチャテスト

1. スクロールが必要な長いページを含む複数タブを開く
2. 「全体キャプチャ」モードで実行
3. 長いページが 1 枚の画像に結合されていることを確認

### スキップテスト

1. `edge://settings` や `chrome://settings` を含む状態で実行
2. システムタブがスキップされ、結果に表示されることを確認

### デバッグ

問題が発生した場合:

1. `edge://extensions/` (または `chrome://extensions/`) を開く
2. 拡張機能の「Service Worker」リンクをクリック
3. Console タブで `[TabsScreenshot]` プレフィックスのログを確認

## ライセンス

MIT License
