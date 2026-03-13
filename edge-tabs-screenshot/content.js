// content.js - コンテンツスクリプト: ページ情報取得、スクロール制御、fixed要素の制御

(function () {
  "use strict";

  // fixed/sticky要素の元のスタイルを保存
  let savedFixedElements = [];

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case "getPageInfo":
        sendResponse(getPageInfo());
        break;

      case "scrollTo":
        scrollTo(message.y).then(() => sendResponse({ ok: true }));
        return true; // 非同期応答

      case "getScrollPosition":
        sendResponse({
          scrollY: window.scrollY,
          scrollX: window.scrollX,
        });
        break;

      case "preScrollForLazyLoad":
        preScrollForLazyLoad().then(() => sendResponse({ ok: true }));
        return true;

      case "hideFixedElements":
        hideFixedElements();
        sendResponse({ ok: true });
        break;

      case "restoreFixedElements":
        restoreFixedElements();
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ error: "Unknown action: " + message.action });
    }
  });

  // === ページ情報を取得 ===
  function getPageInfo() {
    const body = document.body;
    const html = document.documentElement;

    // ページ全体のサイズ
    const scrollWidth = Math.max(
      body.scrollWidth || 0,
      html.scrollWidth || 0,
      body.offsetWidth || 0,
      html.offsetWidth || 0,
      body.clientWidth || 0,
      html.clientWidth || 0
    );

    const scrollHeight = Math.max(
      body.scrollHeight || 0,
      html.scrollHeight || 0,
      body.offsetHeight || 0,
      html.offsetHeight || 0,
      body.clientHeight || 0,
      html.clientHeight || 0
    );

    // ビューポートサイズ
    const viewportWidth = html.clientWidth;
    const viewportHeight = html.clientHeight;

    return {
      scrollWidth,
      scrollHeight,
      viewportWidth,
      viewportHeight,
    };
  }

  // === 指定位置にスクロール ===
  async function scrollTo(y) {
    window.scrollTo(0, y);
    // スクロール後の描画完了を待つ
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  }

  // === Lazy load対策: 一度最下部までスクロールして戻る ===
  async function preScrollForLazyLoad() {
    const totalHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    const viewportHeight = document.documentElement.clientHeight;
    const step = viewportHeight;

    // 下までスクロール
    let currentY = 0;
    while (currentY < totalHeight) {
      window.scrollTo(0, currentY);
      await sleep(150);
      currentY += step;
    }

    // 最下部まで確実にスクロール
    window.scrollTo(0, totalHeight);
    await sleep(300);

    // ページの高さが変わっている可能性があるので再チェック
    const newTotalHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    if (newTotalHeight > totalHeight + viewportHeight) {
      // 追加コンテンツが読み込まれた場合、もう一度最下部までスクロール
      let y = totalHeight;
      while (y < newTotalHeight) {
        window.scrollTo(0, y);
        await sleep(150);
        y += step;
      }
      window.scrollTo(0, newTotalHeight);
      await sleep(300);
    }

    // 先頭に戻す
    window.scrollTo(0, 0);
    await sleep(300);
  }

  // === fixed/sticky要素を非表示にする ===
  function hideFixedElements() {
    savedFixedElements = [];

    const allElements = document.querySelectorAll("*");
    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      if (style.position === "fixed" || style.position === "sticky") {
        // 大きすぎる要素のみ対象（小さなボタン等は除外）
        const rect = el.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 30) {
          savedFixedElements.push({
            element: el,
            originalPosition: el.style.position,
            originalVisibility: el.style.visibility,
          });
          // 非表示ではなく、absoluteに変更して元の位置を維持
          el.style.position = "absolute";
        }
      }
    }
  }

  // === fixed/sticky要素を復元する ===
  function restoreFixedElements() {
    for (const item of savedFixedElements) {
      item.element.style.position = item.originalPosition;
      item.element.style.visibility = item.originalVisibility;
    }
    savedFixedElements = [];
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
