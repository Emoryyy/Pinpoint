/**
 * Feedback Annotation Overlay
 * 獨立網站回饋標註系統 — 書籤工具 v2
 *
 * 使用方式：
 *   1. Bookmarklet：貼到瀏覽器書籤的 URL 欄
 *   2. Script tag：<script src="feedback-overlay.js"></script>
 *   3. 開發者工具 Console：直接貼上執行
 *
 * 不需修改目標網站任何程式碼。
 */

(function () {
  'use strict';

  /* ───────── 防止重複載入 ───────── */
  if (window.__feedbackOverlayLoaded) {
    window.__feedbackOverlay?.toggle?.();
    return;
  }
  window.__feedbackOverlayLoaded = true;

  /* ───────── 設定 ───────── */
  const CONFIG = {
    storageKey: 'feedbackAnnotations_v1',
    serverUrl: null,
    projectId: window.location.hostname,
    badgeTypes: [
      { id: 'bug',     label: '錯誤 Bug',      color: '#E24B4A', bg: '#FCEBEB' },
      { id: 'ui',      label: '介面 UI',        color: '#7F77DD', bg: '#EEEDFE' },
      { id: 'copy',    label: '文案 Copy',      color: '#639922', bg: '#EAF3DE' },
      { id: 'feature', label: '需求 Feature',   color: '#BA7517', bg: '#FAEEDA' },
    ],
  };

  /* ───────── 工具函式 ───────── */

  function getCssSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) { parts.unshift('#' + CSS.escape(current.id)); break; }
      if (current.className && typeof current.className === 'string') {
        const classes = [...current.classList]
          .filter(c => !c.startsWith('fb-overlay') && !c.startsWith('fb-'))
          .slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
        if (classes) selector += classes;
      }
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter(s => s.tagName === current.tagName) : [];
      if (siblings.length > 1) selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function getXPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter(s => s.tagName === current.tagName) : [];
      parts.unshift(tag + (siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : ''));
      current = current.parentElement;
    }
    return '/' + parts.join('/');
  }

  function getAbsoluteRect(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  function getTextSnippet(el) {
    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.slice(0, 60) + (t.length > 60 ? '…' : '');
  }

  function getDataAttributes(el) {
    const result = {};
    [...el.attributes].forEach(attr => {
      if (attr.name.startsWith('data-') || attr.name === 'aria-label' || attr.name === 'name')
        result[attr.name] = attr.value;
    });
    return result;
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function typeInfo(type) {
    return CONFIG.badgeTypes.find(t => t.id === type) || CONFIG.badgeTypes[0];
  }

  /* ───────── 資料管理 ───────── */

  function loadAnnotations() {
    try { return JSON.parse(localStorage.getItem(CONFIG.storageKey) || '[]'); }
    catch { return []; }
  }

  function saveAnnotations(list) {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(list));
    if (CONFIG.serverUrl) syncToServer(list);
  }

  async function syncToServer(list) {
    try {
      await fetch(CONFIG.serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: CONFIG.projectId, pageUrl: location.href, annotations: list }),
      });
    } catch (e) { console.warn('[FeedbackOverlay] Server sync failed:', e.message); }
  }

  function exportJSON() {
    const list = state.annotations;
    const blob = new Blob([JSON.stringify({
      projectId: CONFIG.projectId,
      pageUrl: location.href,
      exportedAt: new Date().toISOString(),
      annotations: list,
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `feedback-${CONFIG.projectId}-${Date.now()}.json`;
    a.click();
  }

  function clearAll() {
    if (!confirm('確定清空所有標註資料？此動作無法還原。')) return;
    state.annotations = [];
    saveAnnotations([]);
    state.nextNum = 1;
    renderPins();
    renderPanelList();
    updateCount();
    showToast('已清空所有資料');
  }

  /* ───────── 樣式 ───────── */

  const STYLE = `
    .fb-overlay-root *, .fb-overlay-root *::before, .fb-overlay-root *::after {
      box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .fb-overlay-root { position: fixed; z-index: 2147483647; }

    #fb-toolbar {
      bottom: 24px; right: 24px;
      background: #1a1a2e; border-radius: 14px;
      padding: 10px 14px; display: flex; align-items: center; gap: 8px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.35); color: white; user-select: none;
    }
    #fb-toolbar .fb-logo { font-size: 13px; font-weight: 700; letter-spacing: -0.3px; white-space: nowrap; }
    #fb-toolbar .fb-logo span { color: #7F77DD; }
    .fb-tb-btn {
      padding: 6px 11px; border-radius: 8px; font-size: 12px; font-weight: 500; cursor: pointer;
      border: none; transition: all 0.15s; color: white; background: transparent; white-space: nowrap;
    }
    .fb-tb-btn:hover { background: rgba(255,255,255,0.1); }
    .fb-tb-btn.active { background: #7F77DD; }
    .fb-badge-count {
      background: #7F77DD; color: white; border-radius: 99px;
      padding: 2px 7px; font-size: 11px; font-weight: 700; min-width: 22px; text-align: center;
    }
    .fb-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.15); flex-shrink: 0; }

    body.fb-selecting { cursor: crosshair !important; }
    body.fb-selecting * { cursor: crosshair !important; }

    .fb-hover-outline {
      position: fixed; pointer-events: none; z-index: 2147483646;
      border: 2px dashed #7F77DD; background: rgba(127,119,221,0.08); border-radius: 3px;
    }

    .fb-pin {
      position: absolute; z-index: 2147483640;
      width: 28px; height: 28px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; color: white;
      border: 2.5px solid white; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transform: translate(-50%, -50%);
      transition: transform 0.15s;
    }
    .fb-pin:hover { transform: translate(-50%, -50%) scale(1.2); }
    .fb-pin.review-mode { box-shadow: 0 0 0 3px rgba(255,255,255,0.4), 0 2px 12px rgba(0,0,0,0.4); }

    /* 留言表單 */
    #fb-comment-form {
      position: fixed; z-index: 2147483647;
      background: white; border-radius: 12px;
      padding: 16px; width: 300px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18); border: 0.5px solid #e5e5e5;
    }
    .fb-cf-title { font-size: 13px; font-weight: 600; color: #1a1a2e; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
    .fb-cf-close { cursor: pointer; color: #999; font-size: 16px; line-height: 1; }
    .fb-cf-close:hover { color: #333; }
    .fb-type-row { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
    .fb-type-chip {
      padding: 4px 10px; border-radius: 99px; font-size: 11px; cursor: pointer;
      border: 1.5px solid transparent; transition: all 0.15s; font-weight: 500;
    }
    .fb-type-chip.selected { border-color: currentColor; }
    .fb-cf-el-info {
      background: #f5f5f5; border-radius: 6px; padding: 8px; margin-bottom: 10px;
      font-size: 10px; font-family: monospace; color: #555; line-height: 1.6;
      max-height: 52px; overflow: hidden; white-space: pre-wrap;
    }
    .fb-cf-textarea {
      width: 100%; border: 1px solid #ddd; border-radius: 8px; padding: 8px;
      font-size: 12px; line-height: 1.5; resize: vertical; min-height: 70px;
      outline: none; color: #1a1a2e;
    }
    .fb-cf-textarea:focus { border-color: #7F77DD; }
    .fb-cf-author {
      width: 100%; border: 1px solid #ddd; border-radius: 8px;
      padding: 7px 8px; font-size: 12px; outline: none; color: #1a1a2e; margin: 6px 0;
    }
    .fb-cf-author:focus { border-color: #7F77DD; }
    .fb-cf-actions { display: flex; gap: 8px; margin-top: 10px; }
    .fb-cf-cancel {
      flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 8px;
      font-size: 12px; cursor: pointer; background: white; color: #555;
    }
    .fb-cf-submit {
      flex: 2; padding: 8px; border: none; border-radius: 8px;
      font-size: 12px; cursor: pointer; background: #7F77DD; color: white; font-weight: 600;
    }
    .fb-cf-submit:hover { background: #534AB7; }

    /* 詳情彈窗 */
    #fb-detail-popup {
      position: fixed; z-index: 2147483647;
      background: white; border-radius: 12px;
      padding: 16px; width: 320px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18); border: 0.5px solid #e5e5e5;
    }
    #fb-detail-popup.hidden { display: none; }
    .fb-dp-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .fb-dp-badge { padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; }
    .fb-dp-id { font-size: 12px; color: #999; }
    .fb-dp-close { margin-left: auto; cursor: pointer; color: #999; font-size: 16px; }
    .fb-dp-close:hover { color: #333; }
    .fb-dp-comment { font-size: 13px; color: #1a1a2e; line-height: 1.6; margin-bottom: 8px; }
    .fb-dp-author { font-size: 11px; color: #888; margin-bottom: 12px; }
    .fb-dp-section { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .fb-dp-code {
      background: #f5f5f5; border-radius: 6px; padding: 8px;
      font-family: monospace; font-size: 10px; color: #333;
      line-height: 1.7; margin-bottom: 10px; word-break: break-all;
    }
    .fb-dp-actions { display: flex; gap: 6px; }
    .fb-dp-btn {
      flex: 1; padding: 7px; border: 1px solid #ddd; border-radius: 8px;
      font-size: 11px; cursor: pointer; background: white; color: #555; text-align: center;
    }
    .fb-dp-btn:hover { background: #f5f5f5; }
    .fb-dp-btn.resolve { border-color: #639922; color: #3B6D11; background: #EAF3DE; }
    .fb-dp-btn.resolve:hover { background: #C0DD97; }
    .fb-dp-btn.del { border-color: #E24B4A; color: #A32D2D; }
    .fb-dp-btn.del:hover { background: #FCEBEB; }

    /* 側邊面板 */
    #fb-panel {
      top: 0; right: 0; width: 320px; height: 100vh;
      background: white; border-left: 0.5px solid #e5e5e5;
      display: flex; flex-direction: column;
      box-shadow: -4px 0 24px rgba(0,0,0,0.1);
    }
    #fb-panel.hidden { display: none; }
    .fb-panel-header { padding: 14px 16px; border-bottom: 0.5px solid #eee; display: flex; align-items: center; gap: 8px; }
    .fb-panel-header h2 { font-size: 14px; font-weight: 700; color: #1a1a2e; flex: 1; margin: 0; }
    .fb-panel-mode { font-size: 10px; padding: 2px 8px; border-radius: 99px; font-weight: 600; }
    .fb-panel-mode.annotate { background: #EEEDFE; color: #3C3489; }
    .fb-panel-mode.review { background: #EAF3DE; color: #3B6D11; }
    .fb-panel-close { cursor: pointer; color: #999; font-size: 18px; }
    .fb-panel-close:hover { color: #333; }
    .fb-panel-list { flex: 1; overflow-y: auto; padding: 8px; }
    .fb-panel-item {
      padding: 10px 12px; border: 0.5px solid #eee; border-radius: 10px;
      margin-bottom: 6px; cursor: pointer; transition: all 0.15s; background: white;
    }
    .fb-panel-item:hover { border-color: #ccc; background: #fafafa; }
    .fb-panel-item.resolved { opacity: 0.45; }
    .fb-pi-top { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
    .fb-pi-text { font-size: 12px; color: #333; line-height: 1.5; }
    .fb-pi-sel { font-size: 10px; font-family: monospace; color: #999; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fb-pi-meta { font-size: 10px; color: #bbb; margin-top: 4px; }
    .fb-panel-footer { padding: 10px 12px; border-top: 0.5px solid #eee; display: flex; gap: 6px; flex-wrap: wrap; }
    .fb-pf-btn {
      flex: 1; padding: 7px 8px; border: 1px solid #ddd; border-radius: 8px;
      font-size: 11px; cursor: pointer; background: white; color: #555; text-align: center; white-space: nowrap;
    }
    .fb-pf-btn:hover { background: #f5f5f5; }
    .fb-pf-btn.accent { border-color: #7F77DD; color: #534AB7; background: #EEEDFE; }
    .fb-pf-btn.accent:hover { background: #CEC8F4; }
    .fb-pf-btn.danger { border-color: #E24B4A; color: #A32D2D; }
    .fb-pf-btn.danger:hover { background: #FCEBEB; }

    /* 載入回饋彈窗 */
    #fb-load-modal {
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
    }
    #fb-load-modal.hidden { display: none; }
    .fb-lm-box {
      background: white; border-radius: 16px; padding: 24px; width: 360px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.25);
    }
    .fb-lm-title { font-size: 15px; font-weight: 700; color: #1a1a2e; margin-bottom: 6px; }
    .fb-lm-sub { font-size: 12px; color: #888; margin-bottom: 16px; line-height: 1.6; }
    .fb-drop-zone {
      border: 2px dashed #ccc; border-radius: 10px; padding: 28px 20px;
      text-align: center; cursor: pointer; transition: all 0.15s; margin-bottom: 12px;
    }
    .fb-drop-zone:hover, .fb-drop-zone.dragover { border-color: #7F77DD; background: #EEEDFE; }
    .fb-drop-zone p { font-size: 13px; color: #888; margin-top: 6px; }
    .fb-drop-zone strong { font-size: 15px; color: #555; }
    .fb-lm-or { text-align: center; font-size: 11px; color: #bbb; margin-bottom: 12px; }
    .fb-lm-actions { display: flex; gap: 8px; }
    .fb-lm-cancel {
      flex: 1; padding: 9px; border: 1px solid #ddd; border-radius: 8px;
      font-size: 12px; cursor: pointer; background: white; color: #555;
    }
    .fb-lm-browse {
      flex: 2; padding: 9px; border: none; border-radius: 8px;
      font-size: 12px; cursor: pointer; background: #7F77DD; color: white; font-weight: 600;
    }
    .fb-lm-browse:hover { background: #534AB7; }

    /* Toast */
    #fb-toast {
      position: fixed; bottom: 80px; right: 24px; z-index: 2147483647;
      background: #1a1a2e; color: white; padding: 9px 16px;
      border-radius: 8px; font-size: 12px;
      opacity: 0; transition: opacity 0.3s; pointer-events: none;
    }
    #fb-toast.show { opacity: 1; }

    /* 審閱模式橫幅 */
    #fb-review-banner {
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483645;
      background: #1a1a2e; color: white;
      padding: 8px 16px; font-size: 12px;
      display: flex; align-items: center; gap: 12px;
    }
    #fb-review-banner.hidden { display: none; }
    #fb-review-banner span { color: #7F77DD; font-weight: 600; }
    .fb-rb-info { flex: 1; }
    .fb-rb-close { cursor: pointer; color: #aaa; font-size: 14px; }
    .fb-rb-close:hover { color: white; }
  `;

  /* ───────── 狀態 ───────── */
  const state = {
    mode: 'annotate',   // 'annotate' | 'review'
    isSelecting: false,
    annotations: loadAnnotations(),
    nextNum: 0,
    currentTarget: null,
    currentType: 'bug',
    hoverEl: null,
  };
  state.nextNum = state.annotations.length
    ? Math.max(...state.annotations.map(a => a.num)) + 1 : 1;

  /* ───────── DOM refs ───────── */
  let root, toolbar, hoverOutline, commentForm, detailPopup, panel;
  let loadModal, reviewBanner, pinsContainer, toastEl;
  let currentDetailId = null;
  let toastTimer = null;
  let fileInput = null;

  /* ───────── 樣式載入 ───────── */
  function injectStyles() {
    if (document.getElementById('fb-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'fb-overlay-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  /* ───────── Toast ───────── */
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
  }

  /* ───────── 建構 DOM ───────── */
  function buildDOM() {
    root = document.createElement('div');
    root.className = 'fb-overlay-root';
    document.body.appendChild(root);

    // 懸停框
    hoverOutline = document.createElement('div');
    hoverOutline.className = 'fb-hover-outline';
    hoverOutline.style.display = 'none';
    document.body.appendChild(hoverOutline);

    // 工具列
    toolbar = document.createElement('div');
    toolbar.id = 'fb-toolbar';
    toolbar.className = 'fb-overlay-root';
    toolbar.innerHTML = `
      <div class="fb-logo">Feed<span>mark</span></div>
      <div class="fb-divider"></div>
      <button class="fb-tb-btn" id="fb-btn-annotate">＋ 標註</button>
      <button class="fb-tb-btn" id="fb-btn-load">📂 載入回饋</button>
      <button class="fb-tb-btn" id="fb-btn-panel">清單 <span class="fb-badge-count" id="fb-count">0</span></button>
      <div class="fb-divider"></div>
      <button class="fb-tb-btn" id="fb-btn-toggle-pins">📍 顯示</button>
      <button class="fb-tb-btn" id="fb-btn-close" title="關閉">✕</button>
    `;
    document.body.appendChild(toolbar);

    // 留言表單
    commentForm = document.createElement('div');
    commentForm.id = 'fb-comment-form';
    commentForm.style.display = 'none';
    commentForm.innerHTML = `
      <div class="fb-cf-title">新增標註 <span class="fb-cf-close" id="fb-cf-close">✕</span></div>
      <div class="fb-type-row" id="fb-type-row"></div>
      <div class="fb-cf-el-info" id="fb-cf-el-info"></div>
      <textarea class="fb-cf-textarea" id="fb-cf-text" placeholder="描述問題或建議..."></textarea>
      <input class="fb-cf-author" id="fb-cf-author" placeholder="你的名字（選填）" />
      <div class="fb-cf-actions">
        <button class="fb-cf-cancel" id="fb-cf-cancel">取消</button>
        <button class="fb-cf-submit" id="fb-cf-submit">送出標註</button>
      </div>
    `;
    document.body.appendChild(commentForm);

    // 詳情彈窗
    detailPopup = document.createElement('div');
    detailPopup.id = 'fb-detail-popup';
    detailPopup.className = 'hidden';
    detailPopup.innerHTML = `
      <div class="fb-dp-header">
        <span class="fb-dp-badge" id="dp-badge"></span>
        <span class="fb-dp-id" id="dp-id"></span>
        <span class="fb-dp-close" id="dp-close">✕</span>
      </div>
      <div class="fb-dp-comment" id="dp-comment"></div>
      <div class="fb-dp-author" id="dp-author"></div>
      <div class="fb-dp-section">CSS Selector</div>
      <div class="fb-dp-code" id="dp-selector"></div>
      <div class="fb-dp-section">位置 (x, y, 寬, 高)</div>
      <div class="fb-dp-code" id="dp-meta"></div>
      <div class="fb-dp-actions" id="dp-actions"></div>
    `;
    document.body.appendChild(detailPopup);

    // 側邊面板
    panel = document.createElement('div');
    panel.id = 'fb-panel';
    panel.className = 'fb-overlay-root hidden';
    panel.innerHTML = `
      <div class="fb-panel-header">
        <h2>回饋清單</h2>
        <span class="fb-panel-mode annotate" id="fb-panel-mode">標註模式</span>
        <span class="fb-panel-close" id="fb-panel-close">✕</span>
      </div>
      <div class="fb-panel-list" id="fb-panel-list"></div>
      <div class="fb-panel-footer">
        <button class="fb-pf-btn accent" id="fp-export">匯出 JSON</button>
        <button class="fb-pf-btn" id="fp-clear-resolved">清除已完成</button>
        <button class="fb-pf-btn danger" id="fp-clear-all">清空全部</button>
      </div>
    `;
    document.body.appendChild(panel);

    // 載入回饋彈窗
    loadModal = document.createElement('div');
    loadModal.id = 'fb-load-modal';
    loadModal.className = 'hidden';
    loadModal.innerHTML = `
      <div class="fb-lm-box">
        <div class="fb-lm-title">📂 載入回饋 JSON</div>
        <div class="fb-lm-sub">將匯出的 JSON 檔案拖曳到下方，或點擊選擇檔案。<br>標記點會直接出現在這個頁面的正確位置。</div>
        <div class="fb-drop-zone" id="fb-drop-zone">
          <strong>📎 拖曳 JSON 到這裡</strong>
          <p>支援 feedback-*.json 格式</p>
        </div>
        <div class="fb-lm-or">— 或 —</div>
        <div class="fb-lm-actions">
          <button class="fb-lm-cancel" id="fb-lm-cancel">取消</button>
          <button class="fb-lm-browse" id="fb-lm-browse">選擇檔案</button>
        </div>
      </div>
    `;
    document.body.appendChild(loadModal);

    // 審閱模式橫幅
    reviewBanner = document.createElement('div');
    reviewBanner.id = 'fb-review-banner';
    reviewBanner.className = 'hidden';
    reviewBanner.innerHTML = `
      <div class="fb-rb-info">👁 <span>審閱模式</span> — 顯示載入的回饋標記，點擊圓點查看詳情</div>
      <span class="fb-rb-close" id="fb-rb-exit">退出審閱 ✕</span>
    `;
    document.body.appendChild(reviewBanner);

    // 隱藏 file input
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // Toast
    toastEl = document.createElement('div');
    toastEl.id = 'fb-toast';
    document.body.appendChild(toastEl);

    buildTypeChips();
    updateCount();
    renderPins();
    renderPanelList();
    bindEvents();
  }

  /* ───────── 類型選擇 ───────── */
  function buildTypeChips() {
    const row = document.getElementById('fb-type-row');
    row.innerHTML = CONFIG.badgeTypes.map(t =>
      `<span class="fb-type-chip ${t.id === state.currentType ? 'selected' : ''}"
        data-type="${t.id}" style="color:${t.color};background:${t.bg}">${t.label}</span>`
    ).join('');
    row.querySelectorAll('.fb-type-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        state.currentType = chip.dataset.type;
        row.querySelectorAll('.fb-type-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      });
    });
  }

  /* ───────── 更新計數 ───────── */
  function updateCount() {
    const el = document.getElementById('fb-count');
    if (el) el.textContent = state.annotations.filter(a => !a.resolved).length;
  }

  /* ───────── 標記圓點 ───────── */
  function renderPins() {
    if (pinsContainer) pinsContainer.remove();
    pinsContainer = document.createElement('div');
    pinsContainer.id = 'fb-pins';
    document.body.appendChild(pinsContainer);

    state.annotations.forEach(a => {
      if (a.resolved && state.mode === 'annotate') return;
      const ti = typeInfo(a.type);
      const pin = document.createElement('div');
      pin.className = 'fb-pin' + (state.mode === 'review' ? ' review-mode' : '');
      pin.dataset.id = a.id;
      pin.textContent = a.num;
      pin.style.cssText = `
        left:${a.pos.x + window.scrollX}px;
        top:${a.pos.y + window.scrollY}px;
        background:${ti.color};
        position:absolute;
      `;
      pin.addEventListener('click', (e) => { e.stopPropagation(); showDetail(a.id, e); });
      pinsContainer.appendChild(pin);
    });
  }

  /* ───────── 面板清單 ───────── */
  function renderPanelList() {
    const list = document.getElementById('fb-panel-list');
    const modeEl = document.getElementById('fb-panel-mode');
    if (modeEl) {
      modeEl.textContent = state.mode === 'review' ? '審閱模式' : '標註模式';
      modeEl.className = 'fb-panel-mode ' + state.mode;
    }

    const items = state.annotations;
    if (!items.length) {
      list.innerHTML = `<div style="text-align:center;color:#bbb;padding:40px 16px;font-size:13px;">
        ${state.mode === 'review' ? '載入的 JSON 中無標註' : '尚無標註，點「＋ 標註」開始'}
      </div>`;
      return;
    }
    list.innerHTML = items.map(a => {
      const ti = typeInfo(a.type);
      return `
        <div class="fb-panel-item ${a.resolved ? 'resolved' : ''}" data-id="${a.id}">
          <div class="fb-pi-top">
            <span style="background:${ti.bg};color:${ti.color};padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600">${ti.label}</span>
            <span style="font-size:10px;color:#bbb">#${a.num}</span>
            ${a.resolved ? '<span style="font-size:10px;color:#639922;margin-left:auto">✓ 完成</span>' : ''}
          </div>
          <div class="fb-pi-text">${esc(a.comment)}</div>
          <div class="fb-pi-sel">${esc(a.selector)}</div>
          <div class="fb-pi-meta">${a.author ? esc(a.author) + ' ・ ' : ''}${fmt(a.createdAt)}</div>
        </div>`;
    }).join('');

    list.querySelectorAll('.fb-panel-item').forEach(item => {
      item.addEventListener('click', (e) => showDetail(item.dataset.id, e));
    });
  }

  /* ───────── 詳情彈窗 ───────── */
  function showDetail(id, event) {
    const a = state.annotations.find(x => x.id === id);
    if (!a) return;
    currentDetailId = id;
    const ti = typeInfo(a.type);

    document.getElementById('dp-badge').textContent = ti.label;
    document.getElementById('dp-badge').style.cssText = `background:${ti.bg};color:${ti.color};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600`;
    document.getElementById('dp-id').textContent = `#${a.num}`;
    document.getElementById('dp-comment').textContent = a.comment;
    document.getElementById('dp-author').textContent =
      (a.author ? `👤 ${a.author} ・ ` : '') + fmt(a.createdAt);
    document.getElementById('dp-selector').textContent = a.selector;
    document.getElementById('dp-meta').textContent =
      `x:${a.pos.x}  y:${a.pos.y}  寬:${a.pos.width}  高:${a.pos.height}` +
      (a.textSnippet ? `\n"${a.textSnippet}"` : '');

    // 依模式顯示不同按鈕
    const actionsEl = document.getElementById('dp-actions');
    if (state.mode === 'review') {
      actionsEl.innerHTML = `
        <button class="fb-dp-btn" id="dp-copy">複製定位</button>
        <button class="fb-dp-btn resolve" id="dp-resolve">${a.resolved ? '取消完成' : '✓ 標記完成'}</button>
      `;
    } else {
      actionsEl.innerHTML = `
        <button class="fb-dp-btn" id="dp-copy">複製定位</button>
        <button class="fb-dp-btn resolve" id="dp-resolve">${a.resolved ? '取消完成' : '✓ 標記完成'}</button>
        <button class="fb-dp-btn del" id="dp-del">刪除</button>
      `;
      document.getElementById('dp-del').addEventListener('click', () => {
        if (!confirm('確定刪除此標註？')) return;
        state.annotations = state.annotations.filter(x => x.id !== currentDetailId);
        saveAnnotations(state.annotations);
        renderPins(); renderPanelList(); updateCount(); closeDetail();
      });
    }

    document.getElementById('dp-copy').addEventListener('click', () => {
      const text = `CSS Selector: ${a.selector}\nXPath: ${a.xpath}\nx:${a.pos.x}, y:${a.pos.y}, w:${a.pos.width}, h:${a.pos.height}`;
      navigator.clipboard?.writeText(text).then(() => {
        document.getElementById('dp-copy').textContent = '已複製！';
        setTimeout(() => { const b = document.getElementById('dp-copy'); if(b) b.textContent = '複製定位'; }, 1500);
      });
    });

    document.getElementById('dp-resolve').addEventListener('click', () => {
      const ann = state.annotations.find(x => x.id === currentDetailId);
      if (!ann) return;
      ann.resolved = !ann.resolved;
      if (state.mode === 'annotate') saveAnnotations(state.annotations);
      renderPins(); renderPanelList(); updateCount(); closeDetail();
    });

    detailPopup.classList.remove('hidden');
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = event?.clientX || vw / 2;
    const cy = event?.clientY || vh / 2;
    detailPopup.style.left = Math.max(8, Math.min(cx + 14, vw - 336)) + 'px';
    detailPopup.style.top  = Math.max(8, Math.min(cy - 20, vh - 420)) + 'px';
  }

  function closeDetail() {
    detailPopup.classList.add('hidden');
    currentDetailId = null;
  }

  /* ───────── 選取模式 ───────── */
  function startSelecting() {
    state.isSelecting = true;
    document.body.classList.add('fb-selecting');
    document.getElementById('fb-btn-annotate').classList.add('active');
    document.getElementById('fb-btn-annotate').textContent = '取消';
    closeDetail();
  }

  function stopSelecting() {
    state.isSelecting = false;
    document.body.classList.remove('fb-selecting');
    hoverOutline.style.display = 'none';
    const btn = document.getElementById('fb-btn-annotate');
    if (btn) { btn.classList.remove('active'); btn.textContent = '＋ 標註'; }
  }

  function isOverlayEl(el) {
    return el.closest('#fb-toolbar,#fb-comment-form,#fb-detail-popup,#fb-panel,#fb-pins,#fb-load-modal,#fb-review-banner,.fb-hover-outline');
  }

  /* ───────── 審閱模式 ───────── */
  function enterReviewMode(annotations) {
    state.mode = 'review';
    state.annotations = annotations;
    state.nextNum = annotations.length ? Math.max(...annotations.map(a => a.num)) + 1 : 1;

    reviewBanner.classList.remove('hidden');
    document.getElementById('fb-btn-annotate').style.display = 'none';

    const modeEl = document.getElementById('fb-panel-mode');
    if (modeEl) { modeEl.textContent = '審閱模式'; modeEl.className = 'fb-panel-mode review'; }

    renderPins();
    renderPanelList();
    updateCount();
    panel.classList.remove('hidden');
    showToast(`已載入 ${annotations.length} 筆回饋`);
  }

  function exitReviewMode() {
    state.mode = 'annotate';
    state.annotations = loadAnnotations();
    state.nextNum = state.annotations.length
      ? Math.max(...state.annotations.map(a => a.num)) + 1 : 1;

    reviewBanner.classList.add('hidden');
    document.getElementById('fb-btn-annotate').style.display = '';

    renderPins();
    renderPanelList();
    updateCount();
    showToast('已退出審閱模式');
  }

  /* ───────── 載入 JSON ───────── */
  function openLoadModal() {
    loadModal.classList.remove('hidden');
  }

  function closeLoadModal() {
    loadModal.classList.add('hidden');
  }

  function handleJSONFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        let annotations = Array.isArray(data) ? data : (data.annotations || []);
        if (!annotations.length) { showToast('JSON 中沒有標註資料'); return; }

        // 確認網址是否相符
        const srcUrl = data.pageUrl || '';
        const curHost = location.hostname;
        const srcHost = srcUrl ? new URL(srcUrl).hostname : '';
        if (srcHost && srcHost !== curHost) {
          if (!confirm(`這份回饋來自 ${srcHost}，目前頁面是 ${curHost}。\n\n座標可能不完全對應，仍要繼續載入嗎？`)) return;
        }

        closeLoadModal();
        enterReviewMode(annotations);
      } catch (err) {
        showToast('JSON 格式錯誤：' + err.message);
      }
    };
    reader.readAsText(file);
  }

  /* ───────── 事件綁定 ───────── */
  function bindEvents() {

    // 工具列
    document.getElementById('fb-btn-annotate').addEventListener('click', () => {
      if (state.isSelecting) stopSelecting(); else startSelecting();
    });

    document.getElementById('fb-btn-load').addEventListener('click', openLoadModal);

    document.getElementById('fb-btn-panel').addEventListener('click', () => {
      panel.classList.toggle('hidden');
      renderPanelList();
    });

    document.getElementById('fb-panel-close').addEventListener('click', () => panel.classList.add('hidden'));

    let pinsVisible = true;
    document.getElementById('fb-btn-toggle-pins').addEventListener('click', () => {
      pinsVisible = !pinsVisible;
      if (pinsContainer) pinsContainer.style.display = pinsVisible ? '' : 'none';
      document.getElementById('fb-btn-toggle-pins').textContent = pinsVisible ? '📍 顯示' : '👁 隱藏';
    });

    document.getElementById('fb-btn-close').addEventListener('click', destroy);

    // 面板底部
    document.getElementById('fp-export').addEventListener('click', exportJSON);
    document.getElementById('fp-clear-resolved').addEventListener('click', () => {
      if (!confirm('確定清除所有已完成的標註？')) return;
      state.annotations = state.annotations.filter(a => !a.resolved);
      saveAnnotations(state.annotations);
      renderPins(); renderPanelList(); updateCount();
    });
    document.getElementById('fp-clear-all').addEventListener('click', clearAll);

    // 載入彈窗
    document.getElementById('fb-lm-cancel').addEventListener('click', closeLoadModal);
    document.getElementById('fb-lm-browse').addEventListener('click', () => fileInput.click());

    const dropZone = document.getElementById('fb-drop-zone');
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      handleJSONFile(e.dataTransfer.files[0]);
    });
    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      handleJSONFile(fileInput.files[0]);
      fileInput.value = '';
    });

    // 審閱模式橫幅
    document.getElementById('fb-rb-exit').addEventListener('click', exitReviewMode);

    // 留言表單
    document.getElementById('fb-cf-close').addEventListener('click', hideCommentForm);
    document.getElementById('fb-cf-cancel').addEventListener('click', hideCommentForm);
    document.getElementById('fb-cf-submit').addEventListener('click', submitAnnotation);

    // 詳情彈窗
    document.getElementById('dp-close').addEventListener('click', closeDetail);

    // 滑鼠懸停框
    document.addEventListener('mouseover', (e) => {
      if (!state.isSelecting || isOverlayEl(e.target)) return;
      const r = e.target.getBoundingClientRect();
      hoverOutline.style.cssText = `display:block;position:fixed;left:${r.left-2}px;top:${r.top-2}px;width:${r.width+4}px;height:${r.height+4}px;`;
    });

    // 點擊選取元素
    document.addEventListener('click', (e) => {
      if (!state.isSelecting) return;
      if (isOverlayEl(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      state.currentTarget = e.target;
      hoverOutline.style.display = 'none';
      stopSelecting();
      showCommentForm(e);
    }, true);

    // ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { stopSelecting(); hideCommentForm(); closeDetail(); closeLoadModal(); }
    });

    // 點外部關閉彈窗
    document.addEventListener('click', (e) => {
      if (!detailPopup.classList.contains('hidden') &&
          !detailPopup.contains(e.target) &&
          !e.target.classList.contains('fb-pin') &&
          !e.target.closest('.fb-panel-item')) closeDetail();
      if (!loadModal.classList.contains('hidden') &&
          e.target === loadModal) closeLoadModal();
    });
  }

  /* ───────── 留言表單 ───────── */
  function showCommentForm(e) {
    const el = state.currentTarget;
    if (!el) return;
    const selector = getCssSelector(el);
    const snippet = getTextSnippet(el);

    document.getElementById('fb-cf-el-info').textContent =
      `${el.tagName.toLowerCase()}  ${selector}\n${snippet ? `"${snippet}"` : ''}`;

    commentForm.dataset.selector = selector;
    commentForm.dataset.xpath = getXPath(el);
    commentForm.dataset.pos = JSON.stringify(getAbsoluteRect(el));
    commentForm.dataset.dataAttrs = JSON.stringify(getDataAttributes(el));
    commentForm.dataset.snippet = snippet;

    commentForm.style.display = 'block';
    document.getElementById('fb-cf-text').value = '';
    document.getElementById('fb-cf-text').focus();

    const vw = window.innerWidth, vh = window.innerHeight;
    commentForm.style.left = Math.max(8, Math.min(e.clientX + 12, vw - 318)) + 'px';
    commentForm.style.top  = Math.max(8, Math.min(e.clientY - 10, vh - 360)) + 'px';
  }

  function hideCommentForm() {
    commentForm.style.display = 'none';
    state.currentTarget = null;
  }

  function submitAnnotation() {
    const text = document.getElementById('fb-cf-text').value.trim();
    if (!text) { document.getElementById('fb-cf-text').style.borderColor = '#E24B4A'; return; }
    document.getElementById('fb-cf-text').style.borderColor = '';

    const annotation = {
      id: genId(),
      num: state.nextNum++,
      type: state.currentType,
      comment: text,
      author: document.getElementById('fb-cf-author').value.trim(),
      selector: commentForm.dataset.selector,
      xpath: commentForm.dataset.xpath,
      pos: JSON.parse(commentForm.dataset.pos),
      textSnippet: commentForm.dataset.snippet,
      dataAttrs: JSON.parse(commentForm.dataset.dataAttrs || '{}'),
      pageUrl: location.href,
      pageTitle: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      userAgent: navigator.userAgent,
      createdAt: new Date().toISOString(),
      resolved: false,
    };

    state.annotations.push(annotation);
    saveAnnotations(state.annotations);
    hideCommentForm();
    renderPins(); renderPanelList(); updateCount();
    showToast(`標註 #${annotation.num} 已儲存`);
  }

  /* ───────── 工具 ───────── */
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function fmt(iso) {
    try { return new Date(iso).toLocaleString('zh-TW', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }); }
    catch { return iso || ''; }
  }

  /* ───────── 銷毀 ───────── */
  function destroy() {
    stopSelecting();
    [root, toolbar, hoverOutline, commentForm, detailPopup, panel,
     loadModal, reviewBanner, pinsContainer, toastEl, fileInput].forEach(el => el?.remove());
    document.getElementById('fb-overlay-styles')?.remove();
    window.__feedbackOverlayLoaded = false;
    window.__feedbackOverlay = null;
  }

  /* ───────── 初始化 ───────── */
  injectStyles();
  buildDOM();
  window.__feedbackOverlay = { toggle() { toolbar.style.display = toolbar.style.display === 'none' ? 'flex' : 'none'; } };

  console.log('%c[Feedmark] 已啟動 ✓', 'color:#7F77DD;font-weight:bold');

})();
