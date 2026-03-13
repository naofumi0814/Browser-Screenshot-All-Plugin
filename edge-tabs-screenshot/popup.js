// popup.js - ポップアップUIの制御

(function () {
  "use strict";

  // === DOM要素 ===
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

  // === 画像形式切り替え ===
  document.querySelectorAll('input[name="imageFormat"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      jpegQualityGroup.style.display =
        e.target.value === "jpeg" ? "block" : "none";
    });
  });

  // === JPEG品質スライダー ===
  jpegQualitySlider.addEventListener("input", () => {
    qualityValueLabel.textContent = jpegQualitySlider.value;
  });

  // === 保存済み設定の復元 ===
  chrome.storage.local.get(
    ["captureMode", "imageFormat", "jpegQuality", "preScroll"],
    (data) => {
      if (data.captureMode) {
        const radio = document.querySelector(
          `input[name="captureMode"][value="${data.captureMode}"]`
        );
        if (radio) radio.checked = true;
      }
      if (data.imageFormat) {
        const radio = document.querySelector(
          `input[name="imageFormat"][value="${data.imageFormat}"]`
        );
        if (radio) {
          radio.checked = true;
          jpegQualityGroup.style.display =
            data.imageFormat === "jpeg" ? "block" : "none";
        }
      }
      if (data.jpegQuality !== undefined) {
        jpegQualitySlider.value = data.jpegQuality;
        qualityValueLabel.textContent = data.jpegQuality;
      }
      if (data.preScroll !== undefined) {
        document.getElementById("preScroll").checked = data.preScroll;
      }
    }
  );

  // === 設定の取得 ===
  function getSettings() {
    const captureMode = document.querySelector(
      'input[name="captureMode"]:checked'
    ).value;
    const imageFormat = document.querySelector(
      'input[name="imageFormat"]:checked'
    ).value;
    const jpegQuality = parseInt(jpegQualitySlider.value, 10);
    const preScroll = document.getElementById("preScroll").checked;

    // 設定を保存
    chrome.storage.local.set({ captureMode, imageFormat, jpegQuality, preScroll });

    return { captureMode, imageFormat, jpegQuality, preScroll };
  }

  // === 実行ボタン ===
  btnStart.addEventListener("click", () => {
    const settings = getSettings();

    // UIを進捗パネルに切り替え
    settingsPanel.style.display = "none";
    progressPanel.style.display = "block";
    resultPanel.style.display = "none";
    progressText.textContent = "準備中...";
    progressBar.style.width = "0%";
    progressDetail.textContent = "";

    // background.jsへメッセージ送信
    chrome.runtime.sendMessage(
      { action: "startCapture", settings: settings },
      (response) => {
        if (chrome.runtime.lastError) {
          showError("バックグラウンド処理の開始に失敗しました: " + chrome.runtime.lastError.message);
          return;
        }
        if (response && response.error) {
          showError(response.error);
        }
      }
    );
  });

  // === background.jsからの進捗メッセージを受信 ===
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "progress") {
      updateProgress(message);
    } else if (message.type === "complete") {
      showResult(message);
    } else if (message.type === "error") {
      showError(message.error);
    }
  });

  // === 進捗更新 ===
  function updateProgress(data) {
    const { current, total, tabTitle, status } = data;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = pct + "%";
    progressText.textContent = `処理中... (${current} / ${total})`;

    // 詳細ログに追記
    const line = document.createElement("div");
    const statusLabel =
      status === "success"
        ? "[OK]"
        : status === "skipped"
        ? "[スキップ]"
        : "[エラー]";
    line.textContent = `${statusLabel} ${tabTitle}`;
    if (status === "skipped" || status === "error") {
      line.style.color = status === "skipped" ? "#e65100" : "#c62828";
    }
    progressDetail.appendChild(line);
    progressDetail.scrollTop = progressDetail.scrollHeight;
  }

  // === 結果表示 ===
  function showResult(data) {
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

    // スキップ・エラー一覧
    skipErrorList.innerHTML = "";
    if (results && results.length > 0) {
      results.forEach((r) => {
        if (r.status === "skipped" || r.status === "error") {
          const div = document.createElement("div");
          div.className =
            r.status === "skipped" ? "item-skip" : "item-error";
          const label = r.status === "skipped" ? "[スキップ]" : "[エラー]";
          div.textContent = `${label} ${r.title || r.url} - ${r.errorMessage || ""}`;
          skipErrorList.appendChild(div);
        }
      });
    }
  }

  // === エラー表示 ===
  function showError(errorMsg) {
    progressPanel.style.display = "none";
    resultPanel.style.display = "block";
    resultSummary.className = "result-summary has-errors";
    resultSummary.innerHTML = `<strong>エラー</strong><br>${errorMsg}`;
    skipErrorList.innerHTML = "";
  }

  // === リセットボタン ===
  btnReset.addEventListener("click", () => {
    resultPanel.style.display = "none";
    settingsPanel.style.display = "block";
  });
})();
