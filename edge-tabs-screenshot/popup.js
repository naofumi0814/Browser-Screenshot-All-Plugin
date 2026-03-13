// popup.js - ポップアップUIの制御
// ポップアップはタブ切替時に閉じるため、結果は chrome.storage.local から取得する

(function () {
  "use strict";

  const settingsPanel = document.getElementById("settings-panel");
  const progressPanel = document.getElementById("progress-panel");
  const resultPanel = document.getElementById("result-panel");
  const btnStart = document.getElementById("btn-start");
  const btnReset = document.getElementById("btn-reset");
  const progressText = document.getElementById("progress-text");
  const progressBar = document.getElementById("progress-bar");
  const progressDetail = document.getElementById("progress-detail");
  const resultSummary = document.getElementById("result-summary");
  const skipErrorList = document.getElementById("skip-error-list");
  const jpegQualityGroup = document.getElementById("jpeg-quality-group");
  const jpegQualitySlider = document.getElementById("jpeg-quality");
  const qualityValueLabel = document.getElementById("quality-value");

  let pollTimer = null;

  // === 起動時: 前回の結果があるか、処理中かをチェック ===
  chrome.storage.local.get(["captureStatus", "captureResult", "captureProgress"], (data) => {
    if (data.captureStatus === "running") {
      // 処理中 → 進捗画面を表示してポーリング開始
      showProgressPanel();
      if (data.captureProgress) {
        updateProgressFromStorage(data.captureProgress);
      }
      startPolling();
    } else if (data.captureStatus === "done" && data.captureResult) {
      // 前回の結果がある → 結果表示
      showResultFromData(data.captureResult);
      // 表示したらクリア
      chrome.storage.local.remove(["captureStatus", "captureResult", "captureProgress"]);
    }
  });

  // === 画像形式切り替え ===
  document.querySelectorAll('input[name="imageFormat"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      jpegQualityGroup.style.display = e.target.value === "jpeg" ? "block" : "none";
    });
  });

  // === JPEG品質スライダー ===
  jpegQualitySlider.addEventListener("input", () => {
    qualityValueLabel.textContent = jpegQualitySlider.value;
  });

  // === 保存済み設定の復元 ===
  chrome.storage.local.get(["captureMode", "imageFormat", "jpegQuality", "preScroll"], (data) => {
    if (data.captureMode) {
      const radio = document.querySelector(`input[name="captureMode"][value="${data.captureMode}"]`);
      if (radio) radio.checked = true;
    }
    if (data.imageFormat) {
      const radio = document.querySelector(`input[name="imageFormat"][value="${data.imageFormat}"]`);
      if (radio) {
        radio.checked = true;
        jpegQualityGroup.style.display = data.imageFormat === "jpeg" ? "block" : "none";
      }
    }
    if (data.jpegQuality !== undefined) {
      jpegQualitySlider.value = data.jpegQuality;
      qualityValueLabel.textContent = data.jpegQuality;
    }
    if (data.preScroll !== undefined) {
      document.getElementById("preScroll").checked = data.preScroll;
    }
  });

  // === 設定取得 ===
  function getSettings() {
    const captureMode = document.querySelector('input[name="captureMode"]:checked').value;
    const imageFormat = document.querySelector('input[name="imageFormat"]:checked').value;
    const jpegQuality = parseInt(jpegQualitySlider.value, 10);
    const preScroll = document.getElementById("preScroll").checked;
    chrome.storage.local.set({ captureMode, imageFormat, jpegQuality, preScroll });
    return { captureMode, imageFormat, jpegQuality, preScroll };
  }

  // === 実行ボタン ===
  btnStart.addEventListener("click", () => {
    const settings = getSettings();
    showProgressPanel();

    chrome.runtime.sendMessage({ action: "startCapture", settings }, (response) => {
      if (chrome.runtime.lastError) {
        showError("バックグラウンド処理の開始に失敗: " + chrome.runtime.lastError.message);
        return;
      }
      if (response && response.error) {
        showError(response.error);
        return;
      }
      // 送信成功 → ポーリング開始 (ポップアップが開いてる間)
      startPolling();
    });
  });

  // === background.jsからの直接メッセージ受信 (ポップアップが開いてる場合) ===
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "progress") {
      updateProgress(message);
    } else if (message.type === "complete") {
      stopPolling();
      showResultFromData(message);
      chrome.storage.local.remove(["captureStatus", "captureResult", "captureProgress"]);
    } else if (message.type === "error") {
      stopPolling();
      showError(message.error);
    }
  });

  // === ストレージポーリング (ポップアップが再度開かれた時用) ===
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      chrome.storage.local.get(["captureStatus", "captureProgress", "captureResult"], (data) => {
        if (data.captureStatus === "done") {
          stopPolling();
          if (data.captureResult) {
            if (data.captureResult.fatalError) {
              showError(data.captureResult.fatalError);
            } else {
              showResultFromData(data.captureResult);
            }
            chrome.storage.local.remove(["captureStatus", "captureResult", "captureProgress"]);
          }
        } else if (data.captureProgress) {
          updateProgressFromStorage(data.captureProgress);
        }
      });
    }, 500);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // === UI操作 ===

  function showProgressPanel() {
    settingsPanel.style.display = "none";
    progressPanel.style.display = "block";
    resultPanel.style.display = "none";
    progressText.textContent = "処理中...";
    progressBar.style.width = "0%";
    progressDetail.textContent = "";
  }

  function updateProgress(data) {
    const { current, total, tabTitle, status } = data;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = pct + "%";
    progressText.textContent = `処理中... (${current} / ${total})`;

    const line = document.createElement("div");
    const label = status === "success" ? "[OK]" : status === "skipped" ? "[スキップ]" : "[エラー]";
    line.textContent = `${label} ${tabTitle}`;
    if (status !== "success") {
      line.style.color = status === "skipped" ? "#e65100" : "#c62828";
    }
    progressDetail.appendChild(line);
    progressDetail.scrollTop = progressDetail.scrollHeight;
  }

  function updateProgressFromStorage(data) {
    const { current, total } = data;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = pct + "%";
    progressText.textContent = `処理中... (${current} / ${total})`;
  }

  function showResultFromData(data) {
    progressPanel.style.display = "none";
    resultPanel.style.display = "block";

    const { successCount, skipCount, errorCount, results } = data;
    const hasIssues = skipCount > 0 || errorCount > 0;

    resultSummary.className = "result-summary" + (hasIssues ? " has-errors" : "");
    resultSummary.innerHTML =
      `<strong>完了!</strong><br>` +
      `成功: ${successCount} 件<br>` +
      `スキップ: ${skipCount} 件<br>` +
      `エラー: ${errorCount} 件`;

    skipErrorList.innerHTML = "";
    if (results && results.length > 0) {
      results.forEach((r) => {
        if (r.status === "skipped" || r.status === "error") {
          const div = document.createElement("div");
          div.className = r.status === "skipped" ? "item-skip" : "item-error";
          const label = r.status === "skipped" ? "[スキップ]" : "[エラー]";
          div.textContent = `${label} ${r.title || r.url} - ${r.errorMessage || ""}`;
          skipErrorList.appendChild(div);
        }
      });
    }
  }

  function showError(errorMsg) {
    stopPolling();
    progressPanel.style.display = "none";
    resultPanel.style.display = "block";
    resultSummary.className = "result-summary has-errors";
    resultSummary.innerHTML = `<strong>エラー</strong><br>${errorMsg}`;
    skipErrorList.innerHTML = "";
  }

  // === リセットボタン ===
  btnReset.addEventListener("click", () => {
    stopPolling();
    resultPanel.style.display = "none";
    settingsPanel.style.display = "block";
    chrome.storage.local.remove(["captureStatus", "captureResult", "captureProgress"]);
  });
})();
