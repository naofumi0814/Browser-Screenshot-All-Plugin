// background.js - Service Worker: キャプチャ処理の制御

"use strict";

// JSZipをService Worker内で直接読み込む
importScripts("lib/jszip.min.js");

// === 処理中フラグ (二重実行防止) ===
let isRunning = false;

// === メッセージ受信 ===
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startCapture") {
    if (isRunning) {
      sendResponse({ error: "処理中です。完了までお待ちください。" });
      return true;
    }
    isRunning = true;
    sendResponse({ ok: true });
    startCapture(message.settings).finally(() => {
      isRunning = false;
    });
    return true;
  }
});

// === メインのキャプチャ処理 ===
async function startCapture(settings) {
  const { captureMode, imageFormat, jpegQuality, preScroll } = settings;
  const mimeType = imageFormat === "jpeg" ? "image/jpeg" : "image/png";
  const fileExt = imageFormat === "jpeg" ? ".jpg" : ".png";
  const quality = imageFormat === "jpeg" ? jpegQuality / 100 : undefined;

  try {
    // 現在のウィンドウの全タブを取得
    const currentWindow = await chrome.windows.getCurrent({ populate: true });
    const tabs = currentWindow.tabs;
    const totalTabs = tabs.length;

    // 元のアクティブタブを記憶
    const originalActiveTab = tabs.find((t) => t.active);

    const results = [];
    const capturedImages = []; // { filename, dataUrl, metadata }

    for (let i = 0; i < totalTabs; i++) {
      const tab = tabs[i];
      const tabIndex = i + 1;
      const hostname = getHostname(tab.url);
      const title = tab.title || "untitled";

      // スキップ判定
      if (shouldSkipTab(tab)) {
        const result = {
          tabIndex,
          title,
          url: tab.url,
          hostname,
          captureMode,
          status: "skipped",
          errorMessage: "システムページまたはアクセス不可のURL",
          capturedAt: new Date().toISOString(),
        };
        results.push(result);
        notifyProgress(tabIndex, totalTabs, title, "skipped");
        continue;
      }

      try {
        // タブをアクティブにする
        await chrome.tabs.update(tab.id, { active: true });

        // タブがアクティブになるのを確実に待つ
        await waitForTabActivation(tab.id);

        // タブの読み込み完了を待つ
        await waitForTabLoad(tab.id);

        // 描画安定化のため待機
        await sleep(600);

        let dataUrl;

        if (captureMode === "full") {
          // 全体キャプチャ
          dataUrl = await captureFullPage(tab.id, mimeType, quality, preScroll, imageFormat);
        } else {
          // 表示範囲のみキャプチャ
          // windowIdを都度取得して確実に現在のウィンドウをキャプチャ
          const win = await chrome.windows.getCurrent();
          dataUrl = await chrome.tabs.captureVisibleTab(win.id, {
            format: imageFormat,
            quality: imageFormat === "jpeg" ? jpegQuality : undefined,
          });
        }

        const safeTitle = sanitizeFilename(title);
        const safeHostname = sanitizeFilename(hostname);
        const paddedIndex = String(tabIndex).padStart(2, "0");
        const filename = `${paddedIndex}_${safeHostname}_${safeTitle}${fileExt}`;

        capturedImages.push({ filename, dataUrl });
        const result = {
          tabIndex,
          title,
          url: tab.url,
          hostname,
          captureMode,
          status: "success",
          errorMessage: null,
          capturedAt: new Date().toISOString(),
        };
        results.push(result);
        notifyProgress(tabIndex, totalTabs, title, "success");
      } catch (err) {
        const result = {
          tabIndex,
          title,
          url: tab.url,
          hostname,
          captureMode,
          status: "error",
          errorMessage: err.message || String(err),
          capturedAt: new Date().toISOString(),
        };
        results.push(result);
        notifyProgress(tabIndex, totalTabs, title, "error");
      }
    }

    // 元のタブに戻す
    if (originalActiveTab) {
      try {
        await chrome.tabs.update(originalActiveTab.id, { active: true });
      } catch (_) {
        // 元タブが閉じられていた場合は無視
      }
    }

    // ZIP作成＆ダウンロード
    if (capturedImages.length > 0) {
      await createAndDownloadZip(capturedImages, results, settings);
    }

    // 完了通知
    const successCount = results.filter((r) => r.status === "success").length;
    const skipCount = results.filter((r) => r.status === "skipped").length;
    const errorCount = results.filter((r) => r.status === "error").length;

    chrome.runtime.sendMessage({
      type: "complete",
      successCount,
      skipCount,
      errorCount,
      results,
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: "error",
      error: "致命的エラー: " + (err.message || String(err)),
    });
  }
}

// === 全体キャプチャ ===
async function captureFullPage(tabId, mimeType, quality, preScroll, imageFormat) {
  // content scriptを注入
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });

  // ページ情報を取得
  const pageInfoResults = await chrome.tabs.sendMessage(tabId, {
    action: "getPageInfo",
  });
  const pageInfo = pageInfoResults;

  const { scrollWidth, scrollHeight, viewportWidth, viewportHeight } = pageInfo;

  // スクロールが不要な場合（ページがビューポートに収まっている場合）
  if (scrollHeight <= viewportHeight + 5) {
    const currentWindow = await chrome.windows.getCurrent();
    return await chrome.tabs.captureVisibleTab(currentWindow.id, {
      format: imageFormat,
      quality: imageFormat === "jpeg" ? (quality ? quality * 100 : 85) : undefined,
    });
  }

  // Lazy load対策: 一度最下部までスクロールしてから戻す
  if (preScroll) {
    await chrome.tabs.sendMessage(tabId, { action: "preScrollForLazyLoad" });
    await sleep(500);
  }

  // fixedヘッダー等の検出
  await chrome.tabs.sendMessage(tabId, { action: "hideFixedElements" });

  // 分割キャプチャ
  const captures = [];
  let currentY = 0;
  const stepHeight = viewportHeight;

  while (currentY < scrollHeight) {
    // 実際にスクロール可能な最大値を考慮
    const scrollTo = Math.min(currentY, scrollHeight - viewportHeight);

    await chrome.tabs.sendMessage(tabId, {
      action: "scrollTo",
      y: scrollTo,
    });

    // スクロール後の描画待機
    await sleep(250);

    const currentWindow = await chrome.windows.getCurrent();
    const dataUrl = await chrome.tabs.captureVisibleTab(currentWindow.id, {
      format: imageFormat,
      quality: imageFormat === "jpeg" ? (quality ? quality * 100 : 85) : undefined,
    });

    // 実際のスクロール位置を取得
    const actualScrollResults = await chrome.tabs.sendMessage(tabId, {
      action: "getScrollPosition",
    });
    const actualScrollY = actualScrollResults.scrollY;

    captures.push({
      dataUrl,
      scrollY: actualScrollY,
      viewportHeight,
    });

    currentY += stepHeight;

    // 最後のキャプチャで末端に到達した場合は終了
    if (scrollTo >= scrollHeight - viewportHeight) {
      break;
    }
  }

  // fixed要素を復元
  await chrome.tabs.sendMessage(tabId, { action: "restoreFixedElements" });

  // スクロール位置を元に戻す
  await chrome.tabs.sendMessage(tabId, { action: "scrollTo", y: 0 });

  // キャプチャが1枚だけならそのまま返す
  if (captures.length === 1) {
    return captures[0].dataUrl;
  }

  // offscreenで画像を結合
  const stitchedDataUrl = await stitchImagesViaOffscreen(
    captures,
    scrollHeight,
    viewportWidth,
    viewportHeight,
    mimeType,
    quality
  );

  return stitchedDataUrl;
}

// === offscreen documentで画像結合 ===
async function stitchImagesViaOffscreen(captures, totalHeight, viewportWidth, viewportHeight, mimeType, quality) {
  // offscreen documentを作成
  await ensureOffscreenDocument();

  // キャプチャデータを1枚ずつoffscreenに送信して蓄積させる
  // 一括送信すると大きすぎてメッセージが失われるため分割する
  for (let i = 0; i < captures.length; i++) {
    await sendMessageToOffscreen({
      action: "addCaptureChunk",
      index: i,
      dataUrl: captures[i].dataUrl,
      scrollY: captures[i].scrollY,
      viewportHeight: captures[i].viewportHeight,
    });
  }

  // 全チャンクを送り終えたら結合実行を指示
  const response = await sendMessageToOffscreen({
    action: "stitchAccumulatedImages",
    totalCaptures: captures.length,
    totalHeight,
    viewportWidth,
    viewportHeight,
    mimeType,
    quality,
  });

  // offscreen documentを閉じる
  try {
    await chrome.offscreen.closeDocument();
  } catch (_) {}

  if (response && response.error) {
    throw new Error(response.error);
  }

  return response.dataUrl;
}

// === offscreen documentの存在を保証 ===
async function ensureOffscreenDocument() {
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["CANVAS"],
      justification: "画像の結合処理にCanvasを使用",
    });
  } catch (e) {
    if (!e.message.includes("Only a single offscreen")) {
      throw e;
    }
  }
}

// === offscreenへのメッセージ送信 (sendMessageとの競合を避ける) ===
function sendMessageToOffscreen(msg) {
  return new Promise((resolve, reject) => {
    // offscreenドキュメントにはruntime.sendMessageで送るが、
    // targetをoffscreenに限定するためフラグを付与
    msg._targetOffscreen = true;
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// === ZIP作成＆ダウンロード ===
// Service Worker内で直接JSZipを使ってZIP作成する
// offscreenへの大量データ送信を避けることで、全タブ確実に保存できる
async function createAndDownloadZip(capturedImages, results, settings) {
  const now = new Date();
  const timestamp = formatTimestamp(now);
  const zipFilename = `edge_tabs_capture_${timestamp}.zip`;

  // metadata.json作成
  const metadata = results.map((r) => ({
    tabIndex: r.tabIndex,
    title: r.title,
    url: r.url,
    hostname: r.hostname,
    captureMode: r.captureMode,
    status: r.status,
    errorMessage: r.errorMessage,
    capturedAt: r.capturedAt,
  }));

  // summary.txt作成
  const successCount = results.filter((r) => r.status === "success").length;
  const skipCount = results.filter((r) => r.status === "skipped").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  const summaryText = [
    `Edge Tabs Screenshot - Summary`,
    `================================`,
    `処理日時: ${now.toLocaleString("ja-JP")}`,
    `撮影モード: ${settings.captureMode === "full" ? "全体キャプチャ" : "表示範囲のみ"}`,
    `画像形式: ${settings.imageFormat.toUpperCase()}`,
    `対象タブ数: ${results.length}`,
    `成功: ${successCount}`,
    `スキップ: ${skipCount}`,
    `エラー: ${errorCount}`,
    ``,
    `--- 詳細 ---`,
    ...results.map(
      (r) =>
        `[${r.status.toUpperCase()}] Tab${r.tabIndex}: ${r.title} (${r.url})${r.errorMessage ? " - " + r.errorMessage : ""}`
    ),
  ].join("\n");

  // Service Worker内で直接ZIPを生成
  const zip = new JSZip();

  // 画像を追加
  for (const img of capturedImages) {
    const base64Data = img.dataUrl.split(",")[1];
    zip.file(img.filename, base64Data, { base64: true });
  }

  // metadata.jsonを追加
  zip.file("metadata.json", JSON.stringify(metadata, null, 2));

  // summary.txtを追加
  zip.file("summary.txt", summaryText);

  // ZIPをbase64で生成
  const zipBase64 = await zip.generateAsync({
    type: "base64",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  // data URLとしてダウンロード
  const dataUrl = "data:application/zip;base64," + zipBase64;
  await chrome.downloads.download({
    url: dataUrl,
    filename: zipFilename,
    saveAs: true,
  });
}

// === ユーティリティ関数 ===

function shouldSkipTab(tab) {
  const url = tab.url || "";
  if (!url) return true;
  if (
    url.startsWith("edge://") ||
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("extension://") ||
    url.startsWith("about:") ||
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("file://") ||
    url.startsWith("devtools://") ||
    url.startsWith("view-source:")
  ) {
    return true;
  }
  return false;
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function sanitizeFilename(name) {
  // ファイル名に使えない文字を除去し、長さを制限
  return name
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[\r\n\t]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 80);
}

function formatTimestamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}_${h}${min}${s}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabLoad(tabId, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await sleep(200);
  }
}

// タブが実際にアクティブになるのを待つ
async function waitForTabActivation(tabId, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.active) return;
    await sleep(100);
  }
}

function notifyProgress(current, total, tabTitle, status) {
  chrome.runtime.sendMessage({
    type: "progress",
    current,
    total,
    tabTitle,
    status,
  });
}
