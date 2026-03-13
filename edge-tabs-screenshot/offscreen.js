// offscreen.js - Offscreen Document: 画像結合 (Canvas) と ZIP作成 (JSZip)

"use strict";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "stitchImages") {
    stitchImages(message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (message.action === "createZip") {
    createZip(message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }
});

// === 画像結合 ===
async function stitchImages(data) {
  const { captures, totalHeight, viewportWidth, viewportHeight, mimeType, quality } = data;

  // Canvasを作成
  const canvas = document.createElement("canvas");
  canvas.width = viewportWidth * window.devicePixelRatio || viewportWidth;

  // 実際のキャプチャ画像サイズに基づいてcanvasサイズを決定
  // まず最初の画像を読み込んでスケールを確認
  const firstImg = await loadImage(captures[0].dataUrl);
  const scale = firstImg.width / viewportWidth;

  canvas.width = Math.round(viewportWidth * scale);
  canvas.height = Math.round(totalHeight * scale);

  const ctx = canvas.getContext("2d");

  // 各キャプチャを正しい位置に描画
  for (let i = 0; i < captures.length; i++) {
    const capture = captures[i];
    const img = i === 0 ? firstImg : await loadImage(capture.dataUrl);

    const drawY = Math.round(capture.scrollY * scale);

    // 最後のキャプチャの場合、残りの領域を描画
    if (i === captures.length - 1) {
      // 最後のキャプチャは下端に合わせる
      const lastDrawY = canvas.height - img.height;
      if (lastDrawY > drawY) {
        // 通常の位置に描画
        ctx.drawImage(img, 0, drawY);
      } else {
        // 重複を避けて下端に合わせる
        ctx.drawImage(img, 0, lastDrawY);
      }
    } else {
      ctx.drawImage(img, 0, drawY);
    }
  }

  // Canvasの高さが大きすぎる場合の対策（最大65535px制限）
  if (canvas.height > 65535) {
    // Canvas高さを制限
    const limitedCanvas = document.createElement("canvas");
    limitedCanvas.width = canvas.width;
    limitedCanvas.height = 65535;
    const limitedCtx = limitedCanvas.getContext("2d");
    limitedCtx.drawImage(canvas, 0, 0);
    return { dataUrl: limitedCanvas.toDataURL(mimeType, quality) };
  }

  return { dataUrl: canvas.toDataURL(mimeType, quality) };
}

// === 画像読み込みヘルパー ===
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    img.src = dataUrl;
  });
}

// === ZIP作成 ===
async function createZip(data) {
  const { images, metadata, summary, zipFilename } = data;

  const zip = new JSZip();

  // 画像を追加
  for (const img of images) {
    // dataURLからbase64データを抽出
    const base64Data = img.dataUrl.split(",")[1];
    zip.file(img.filename, base64Data, { base64: true });
  }

  // metadata.jsonを追加
  zip.file("metadata.json", metadata);

  // summary.txtを追加
  zip.file("summary.txt", summary);

  // ZIP生成
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  // Blob URLを作成
  const blobUrl = URL.createObjectURL(blob);

  return { blobUrl };
}
