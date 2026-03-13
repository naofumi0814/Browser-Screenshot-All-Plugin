# Edge Tabs Screenshot All

開いている全タブのスクリーンショットを一括保存するブラウザ拡張機能です。
詳細は [リポジトリの README](../README.md) を参照してください。

## クイックインストール

### Edge

1. `edge://extensions/` → 開発者モード ON → 「展開して読み込み」 → このフォルダを選択

### Chrome

1. `chrome://extensions/` → デベロッパーモード ON → 「パッケージ化されていない拡張機能を読み込む」 → このフォルダを選択

## ファイル構成

```
manifest.json      Manifest V3 定義
background.js      Service Worker (キャプチャ制御・ZIP 生成)
content.js         コンテンツスクリプト (スクロール・ページ情報)
popup.html/css/js  ポップアップ UI
lib/jszip.min.js   JSZip 3.10.1
icons/             拡張機能アイコン
```
