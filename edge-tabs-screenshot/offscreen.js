// offscreen.js - Offscreen Document: 画像結合 (Canvas)
// ZIP作成はbackground.jsで直接行うため、ここではCanvas結合のみ担当

"use strict";

// 分割送信されたキャプチャデータを蓄積するバッファ
let captureBuffer = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // offscreen宛のメッセージのみ処理
  if (!message._targetOffscreen) return false;

  if (message.action === "addCaptureChunk") {
    // キャプチャデータを1枚ずつ蓄積
    captureBuffer[message.index] = {
      dataUrl: message.dataUrl,
      scrollY: message.scrollY,
      viewportHeight: message.viewportHeight,
    };
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === "stitchAccumulatedImages") {
    // 蓄積されたデータから画像を結合
    const captures = [];
    for (let i = 0; i < message.totalCaptures; i++) {
      if (captureBuffer[i]) {
        captures.push(captureBuffer[i]);
      }
    }
    captureBuffer = {}; // バッファクリア

    stitchImages({
      captures,
      totalHeight: message.totalHeight,
      viewportWidth: message.viewportWidth,
      viewportHeight: message.viewportHeight,
      mimeType: message.mimeType,
      quality: message.quality,
    })
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true; // 非同期応答
  }
});

// === 画像結合 ===
async function stitchImages(data) {
  const { captures, totalHeight, viewportWidth, viewportHeight, mimeType, quality } = data;

  // まず最初の画像を読み込んでスケールを確認
  const firstImg = await loadImage(captures[0].dataUrl);
  const scale = firstImg.width / viewportWidth;

  // Canvasを作成
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewportWidth * scale);
  canvas.height = Math.min(Math.round(totalHeight * scale), 65535);

  const ctx = canvas.getContext("2d");

  // 各キャプチャを正しい位置に描画
  for (let i = 0; i < captures.length; i++) {
    const capture = captures[i];
    const img = i === 0 ? firstImg : await loadImage(capture.dataUrl);

    const drawY = Math.round(capture.scrollY * scale);

    if (i === captures.length - 1) {
      // 最後のキャプチャは下端に合わせる
      const lastDrawY = canvas.height - img.height;
      if (lastDrawY > drawY) {
        ctx.drawImage(img, 0, drawY);
      } else {
        ctx.drawImage(img, 0, lastDrawY);
      }
    } else {
      ctx.drawImage(img, 0, drawY);
    }
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
