// background.js - Service Worker: キャプチャ処理の全制御
// offscreen document は使わない。OffscreenCanvas + createImageBitmap で完結させる。

"use strict";

importScripts("lib/jszip.min.js");

// === 処理中フラグ ===
let isRunning = false;

// === メッセージ受信 ===
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startCapture") {
    if (isRunning) {
      sendResponse({ error: "処理中です。完了までお待ちください。" });
      return true;
    }
    isRunning = true;
    // 進捗をstorageに初期化
    chrome.storage.local.set({ captureStatus: "running", captureProgress: null, captureResult: null });
    sendResponse({ ok: true });
    startCapture(message.settings).finally(() => {
      isRunning = false;
    });
    return true;
  }

  if (message.action === "getStatus") {
    sendResponse({ isRunning });
    return false;
  }
});

// === 安全なメッセージ送信 (popupが閉じていてもクラッシュしない) ===
function safeSendMessage(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch (_) {}
}

// === 進捗をstorageに保存 + popupへも送信(届かなくてもOK) ===
function reportProgress(current, total, tabTitle, status) {
  const progress = { current, total, tabTitle, status };
  chrome.storage.local.set({ captureProgress: progress });
  safeSendMessage({ type: "progress", ...progress });
}

// === メインのキャプチャ処理 ===
async function startCapture(settings) {
  const { captureMode, imageFormat, jpegQuality, preScroll } = settings;
  const mimeType = imageFormat === "jpeg" ? "image/jpeg" : "image/png";
  const fileExt = imageFormat === "jpeg" ? ".jpg" : ".png";

  try {
    // 現在のウィンドウの全タブを取得 (windowIdを保持)
    const currentWindow = await chrome.windows.getCurrent({ populate: true });
    const windowId = currentWindow.id;
    const tabs = currentWindow.tabs;
    const totalTabs = tabs.length;
    const originalActiveTab = tabs.find((t) => t.active);

    console.log(`[TabsScreenshot] 開始: ${totalTabs}タブ, モード=${captureMode}, 形式=${imageFormat}`);

    const results = [];
    const capturedImages = [];

    for (let i = 0; i < totalTabs; i++) {
      const tab = tabs[i];
      const tabIndex = i + 1;
      const hostname = getHostname(tab.url);
      const title = tab.title || "untitled";

      // スキップ判定
      if (shouldSkipTab(tab)) {
        results.push({
          tabIndex, title, url: tab.url, hostname, captureMode,
          status: "skipped",
          errorMessage: "システムページまたはアクセス不可のURL",
          capturedAt: new Date().toISOString(),
        });
        reportProgress(tabIndex, totalTabs, title, "skipped");
        console.log(`[TabsScreenshot] Tab${tabIndex} スキップ: ${tab.url}`);
        continue;
      }

      try {
        // タブをアクティブにする
        await chrome.tabs.update(tab.id, { active: true });
        console.log(`[TabsScreenshot] Tab${tabIndex} アクティブ化: ${title}`);

        // タブがアクティブになるのを確実に待つ
        await waitForTabActivation(tab.id);

        // タブの読み込み完了を待つ
        await waitForTabLoad(tab.id);

        // 描画安定化のため待機
        await sleep(800);

        let dataUrl;

        if (captureMode === "full") {
          dataUrl = await captureFullPage(tab.id, windowId, mimeType, imageFormat, jpegQuality, preScroll);
        } else {
          dataUrl = await captureVisibleTabSafe(windowId, imageFormat, jpegQuality);
        }

        if (!dataUrl) {
          throw new Error("キャプチャ結果が空でした");
        }

        const safeTitle = sanitizeFilename(title);
        const safeHostname = sanitizeFilename(hostname);
        const paddedIndex = String(tabIndex).padStart(2, "0");
        const filename = `${paddedIndex}_${safeHostname}_${safeTitle}${fileExt}`;

        capturedImages.push({ filename, dataUrl });
        results.push({
          tabIndex, title, url: tab.url, hostname, captureMode,
          status: "success", errorMessage: null,
          capturedAt: new Date().toISOString(),
        });
        reportProgress(tabIndex, totalTabs, title, "success");
        console.log(`[TabsScreenshot] Tab${tabIndex} 成功: ${title}`);
      } catch (err) {
        results.push({
          tabIndex, title, url: tab.url, hostname, captureMode,
          status: "error",
          errorMessage: err.message || String(err),
          capturedAt: new Date().toISOString(),
        });
        reportProgress(tabIndex, totalTabs, title, "error");
        console.error(`[TabsScreenshot] Tab${tabIndex} エラー:`, err);
      }
    }

    // 元のタブに戻す
    if (originalActiveTab) {
      try {
        await chrome.tabs.update(originalActiveTab.id, { active: true });
      } catch (_) {}
    }

    // ZIP作成＆ダウンロード
    if (capturedImages.length > 0) {
      await createAndDownloadZip(capturedImages, results, settings);
    }

    // 完了結果をstorageに保存
    const successCount = results.filter((r) => r.status === "success").length;
    const skipCount = results.filter((r) => r.status === "skipped").length;
    const errorCount = results.filter((r) => r.status === "error").length;

    const captureResult = { successCount, skipCount, errorCount, results };
    chrome.storage.local.set({ captureStatus: "done", captureResult });
    safeSendMessage({ type: "complete", ...captureResult });

    console.log(`[TabsScreenshot] 完了: 成功=${successCount}, スキップ=${skipCount}, エラー=${errorCount}`);
  } catch (err) {
    console.error("[TabsScreenshot] 致命的エラー:", err);
    const errorMsg = "致命的エラー: " + (err.message || String(err));
    chrome.storage.local.set({
      captureStatus: "done",
      captureResult: { successCount: 0, skipCount: 0, errorCount: 1, results: [], fatalError: errorMsg },
    });
    safeSendMessage({ type: "error", error: errorMsg });
  }
}

// === captureVisibleTab のラッパー (リトライ付き) ===
async function captureVisibleTabSafe(windowId, imageFormat, jpegQuality, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const options = { format: imageFormat };
      if (imageFormat === "jpeg") {
        options.quality = jpegQuality || 85;
      }
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, options);
      return dataUrl;
    } catch (err) {
      console.warn(`[TabsScreenshot] captureVisibleTab 試行${attempt}/${retries} 失敗:`, err.message);
      if (attempt === retries) throw err;
      await sleep(500 * attempt);
    }
  }
}

// === 全体キャプチャ ===
async function captureFullPage(tabId, windowId, mimeType, imageFormat, jpegQuality, preScroll) {
  // content scriptを注入
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  await sleep(100);

  // ページ情報を取得
  const pageInfo = await chrome.tabs.sendMessage(tabId, { action: "getPageInfo" });
  const { scrollHeight, viewportWidth, viewportHeight } = pageInfo;

  console.log(`[TabsScreenshot] ページ情報: scrollHeight=${scrollHeight}, viewportHeight=${viewportHeight}`);

  // スクロール不要
  if (scrollHeight <= viewportHeight + 5) {
    return await captureVisibleTabSafe(windowId, imageFormat, jpegQuality);
  }

  // Lazy load対策
  if (preScroll) {
    await chrome.tabs.sendMessage(tabId, { action: "preScrollForLazyLoad" });
    await sleep(500);
  }

  // fixed要素を一時的にabsoluteに変更
  await chrome.tabs.sendMessage(tabId, { action: "hideFixedElements" });

  // 分割キャプチャ
  const captures = [];
  let currentY = 0;

  while (currentY < scrollHeight) {
    const scrollTo = Math.min(currentY, Math.max(0, scrollHeight - viewportHeight));

    await chrome.tabs.sendMessage(tabId, { action: "scrollTo", y: scrollTo });
    await sleep(350);

    const dataUrl = await captureVisibleTabSafe(windowId, imageFormat, jpegQuality);

    const pos = await chrome.tabs.sendMessage(tabId, { action: "getScrollPosition" });

    captures.push({
      dataUrl,
      scrollY: pos.scrollY,
      viewportHeight,
    });

    currentY += viewportHeight;

    if (scrollTo >= scrollHeight - viewportHeight) break;
  }

  // fixed要素を復元 & スクロールを先頭に戻す
  try { await chrome.tabs.sendMessage(tabId, { action: "restoreFixedElements" }); } catch (_) {}
  try { await chrome.tabs.sendMessage(tabId, { action: "scrollTo", y: 0 }); } catch (_) {}

  if (captures.length === 1) {
    return captures[0].dataUrl;
  }

  // OffscreenCanvas で画像結合 (Service Worker内で完結)
  return await stitchImagesInWorker(captures, scrollHeight, viewportWidth, viewportHeight, mimeType);
}

// === OffscreenCanvas で画像結合 (offscreen document 不要) ===
async function stitchImagesInWorker(captures, totalHeight, viewportWidth, viewportHeight, mimeType) {
  console.log(`[TabsScreenshot] 画像結合: ${captures.length}枚, totalHeight=${totalHeight}`);

  // 最初の画像を読み込んでスケールを確認
  const firstBlob = await (await fetch(captures[0].dataUrl)).blob();
  const firstBitmap = await createImageBitmap(firstBlob);
  const scale = firstBitmap.width / viewportWidth;

  const canvasWidth = Math.round(viewportWidth * scale);
  const canvasHeight = Math.min(Math.round(totalHeight * scale), 65535);

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");

  for (let i = 0; i < captures.length; i++) {
    let bitmap;
    if (i === 0) {
      bitmap = firstBitmap;
    } else {
      const blob = await (await fetch(captures[i].dataUrl)).blob();
      bitmap = await createImageBitmap(blob);
    }

    const drawY = Math.round(captures[i].scrollY * scale);

    if (i === captures.length - 1) {
      // 最後のキャプチャは下端に合わせる
      const bottomAlignY = canvasHeight - bitmap.height;
      ctx.drawImage(bitmap, 0, Math.max(drawY, bottomAlignY));
    } else {
      ctx.drawImage(bitmap, 0, drawY);
    }

    if (i !== 0) bitmap.close();
  }
  firstBitmap.close();

  // CanvasをBlobに変換 → base64 data URL にする
  const quality = mimeType === "image/jpeg" ? 0.85 : undefined;
  const resultBlob = await canvas.convertToBlob({ type: mimeType, quality });
  const arrayBuffer = await resultBlob.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);

  return `data:${mimeType};base64,${base64}`;
}

// === ArrayBufferをbase64に変換 ===
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, bytes.length);
    binary += String.fromCharCode.apply(null, bytes.subarray(i, end));
  }
  return btoa(binary);
}

// === ZIP作成＆ダウンロード ===
async function createAndDownloadZip(capturedImages, results, settings) {
  console.log(`[TabsScreenshot] ZIP作成: ${capturedImages.length}枚の画像`);

  const now = new Date();
  const timestamp = formatTimestamp(now);
  const zipFilename = `edge_tabs_capture_${timestamp}.zip`;

  const metadata = results.map((r) => ({
    tabIndex: r.tabIndex, title: r.title, url: r.url,
    hostname: r.hostname, captureMode: r.captureMode,
    status: r.status, errorMessage: r.errorMessage,
    capturedAt: r.capturedAt,
  }));

  const successCount = results.filter((r) => r.status === "success").length;
  const skipCount = results.filter((r) => r.status === "skipped").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  const summaryText = [
    "Edge Tabs Screenshot - Summary",
    "================================",
    `処理日時: ${now.toLocaleString("ja-JP")}`,
    `撮影モード: ${settings.captureMode === "full" ? "全体キャプチャ" : "表示範囲のみ"}`,
    `画像形式: ${settings.imageFormat.toUpperCase()}`,
    `対象タブ数: ${results.length}`,
    `成功: ${successCount}`,
    `スキップ: ${skipCount}`,
    `エラー: ${errorCount}`,
    "",
    "--- 詳細 ---",
    ...results.map(
      (r) => `[${r.status.toUpperCase()}] Tab${r.tabIndex}: ${r.title} (${r.url})${r.errorMessage ? " - " + r.errorMessage : ""}`
    ),
  ].join("\n");

  const zip = new JSZip();

  for (const img of capturedImages) {
    const base64Data = img.dataUrl.split(",")[1];
    zip.file(img.filename, base64Data, { base64: true });
  }

  zip.file("metadata.json", JSON.stringify(metadata, null, 2));
  zip.file("summary.txt", summaryText);

  const zipBase64 = await zip.generateAsync({
    type: "base64",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const dataUrl = "data:application/zip;base64," + zipBase64;
  await chrome.downloads.download({
    url: dataUrl,
    filename: zipFilename,
    saveAs: true,
  });

  console.log(`[TabsScreenshot] ZIP保存完了: ${zipFilename}`);
}

// === ユーティリティ ===

function shouldSkipTab(tab) {
  const url = tab.url || "";
  if (!url) return true;
  const skipPrefixes = [
    "edge://", "chrome://", "chrome-extension://", "extension://",
    "about:", "data:", "blob:", "file://", "devtools://", "view-source:",
  ];
  return skipPrefixes.some((prefix) => url.startsWith(prefix));
}

function getHostname(url) {
  try { return new URL(url).hostname; } catch { return "unknown"; }
}

function sanitizeFilename(name) {
  return name
    .replace(/[\\/:*?"<>|#{}%&~]/g, "")
    .replace(/[\r\n\t]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 80);
}

function formatTimestamp(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}${mo}${d}_${h}${mi}${s}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabLoad(tabId, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
    } catch { return; }
    await sleep(200);
  }
}

async function waitForTabActivation(tabId, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.active) return;
    } catch { return; }
    await sleep(100);
  }
}
