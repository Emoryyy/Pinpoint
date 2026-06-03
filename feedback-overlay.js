/**
 * Feedback Annotation Overlay
 * 獨立網站回饋標註系統 — 注入腳本
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

  /* ───────── 防止重複注入 ───────── */
  if (window.__feedbackOverlayLoaded) {
    window.__feedbackOverlay?.toggle?.();
    return;
  }
  window.__feedbackOverlayLoaded = true;

  /* ───────── 設定 ───────── */
  const CONFIG = {
    storageKey: 'feedbackAnnotations_v1',
    serverUrl: null, // 若有後端 API 填入 URL，例如 'https://api.example.com/feedback'
    projectId: window.location.hostname,
    badgeTypes: [
      { id: 'bug',     label: '錯誤 Bug',   color: '#E24B4A', bg: '#FCEBEB' },
      { id: 'ui',      label: '介面 UI',    color: '#7F77DD', bg: '#EEEDFE' },
      { id: 'copy',    label: '文案 Copy',  color: '#639922', bg: '#EAF3DE' },
      { id: 'feature', label: '需求 Feature', color: '#BA7517', bg: '#FAEEDA' },
    ],
  };

  /* ───────── 工具函式 ───────── */

  /** 取得 CSS Selector（精確） */
  function getCssSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return '#' + CSS.escape(el.id);

    const parts = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = '#' + CSS.escape(current.id);
        parts.unshift(selector);
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const classes = [...current.classList]
          .filter(c => !c.startsWith('fb-overlay'))
          .slice(0, 2)
          .map(c => '.' + CSS.escape(c))
          .join('');
        if (classes) selector += classes;
      }
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter(s => s.tagName === current.tagName)
        : [];
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${idx})`;
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  /** 取得 XPath */
  function getXPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter(s => s.tagName === current.tagName)
        : [];
      const idx = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : '';
      parts.unshift(tag + idx);
      current = current.parentElement;
    }
    return '/' + parts.join('/');
  }

  /** 取得元素在頁面上的絕對位置 */
  function getAbsoluteRect(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  /** 取得有意義的文字節錄（前 60 字元） */
  function getTextSnippet(el) {
    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.slice(0, 60) + (t.length > 60 ? '…' : '');
  }

  /** 取得元素的 data attributes（方便定位） */
  function getDataAttributes(el) {
    const result = {};
    [...el.attributes].forEach(attr => {
      if (attr.name.startsWith('data-') || attr.name === 'aria-label' || attr.name === 'name') {
        result[attr.name] = attr.value;
      }
    });
    return result;
  }

  /** 產生唯一 ID */
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ───────── 資料管理 ───────── */

  function loadAnnotations() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.storageKey) || '[]');
    } catch { return []; }
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
    } catch (e) {
      console.warn('[FeedbackOverlay] Server sync failed:', e.message);
    }
  }

  function exportJSON() {
    const list = loadAnnotations();
    const blob = new Blob([JSON.stringify({ projectId: CONFIG.projectId, pageUrl: location.href, exportedAt: new Date().toISOString(), annotations: list }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `feedback-${CONFIG.projectId}-${Date.now()}.json`;
    a.click();
  }

  /* ───────── UI 建構 ───────── */

  const STYLE = `
    .fb-overlay-root *, .fb-overlay-root *::before, .fb-overlay-root *::after {
      box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .fb-overlay-root { position: fixed; z-index: 2147483647; }

    /* 工具列 */
    #fb-toolbar {
      bottom: 24px; right: 24px;
      background: #1a1a2e; border-radius: 14px;
      padding: 10px 14px; display: flex; align-items: center; gap: 10px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.35); color: white; user-select: none;
    }
    #fb-toolbar .fb-logo { font-size: 13px; font-weight: 700; letter-spacing: -0.3px; }
    #fb-toolbar .fb-logo span { color: #7F77DD; }
    .fb-tb-btn {
      padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 500; cursor: pointer;
      border: none; transition: all 0.15s; color: white; background: transparent;
    }
    .fb-tb-btn:hover { background: rgba(255,255,255,0.1); }
    .fb-tb-btn.active { background: #7F77DD; }
    .fb-tb-btn.danger { background: #E24B4A; }
    .fb-badge-count {
      background: #7F77DD; color: white; border-radius: 99px;
      padding: 2px 7px; font-size: 11px; font-weight: 700; min-width: 22px; text-align: center;
    }
    .fb-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.15); }

    /* 選取游標模式 */
    body.fb-selecting { cursor: crosshair !important; }
    body.fb-selecting * { cursor: crosshair !important; }
    .fb-hover-outline {
      position: absolute; pointer-events: none; z-index: 2147483646;
      border: 2px dashed #7F77DD; background: rgba(127,119,221,0.08); border-radius: 3px;
      transition: all 0.08s;
    }

    /* 標記圓點 */
    .fb-pin {
      position: absolute; z-index: 2147483640;
      width: 26px; height: 26px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; color: white;
      border: 2.5px solid white; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transform: translate(-50%, -50%);
      transition: transform 0.15s;
    }
    .fb-pin:hover { transform: translate(-50%, -50%) scale(1.2); }

    /* 留言表單 */
    #fb-comment-form {
      position: fixed; z-index: 2147483647;
      background: white; border-radius: 12px;
      padding: 16px; width: 300px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      border: 0.5px solid #e5e5e5;
    }
    #fb-comment-form .fb-cf-title { font-size: 13px; font-weight: 600; color: #1a1a2e; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
    #fb-comment-form .fb-cf-close { cursor: pointer; color: #999; font-size: 16px; line-height: 1; }
    #fb-comment-form .fb-cf-close:hover { color: #333; }
    .fb-type-row { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
    .fb-type-chip {
      padding: 4px 10px; border-radius: 99px; font-size: 11px; cursor: pointer;
      border: 1.5px solid transparent; transition: all 0.15s; font-weight: 500;
    }
    .fb-type-chip.selected { border-color: currentColor; }
    .fb-cf-el-info {
      background: #f5f5f5; border-radius: 6px; padding: 8px; margin-bottom: 10px;
      font-size: 10px; font-family: monospace; color: #555; line-height: 1.6;
      max-height: 52px; overflow: hidden;
    }
    .fb-cf-textarea {
      width: 100%; border: 1px solid #ddd; border-radius: 8px; padding: 8px;
      font-size: 12px; line-height: 1.5; resize: vertical; min-height: 70px;
      outline: none; color: #1a1a2e;
    }
    .fb-cf-textarea:focus { border-color: #7F77DD; }
    .fb-cf-author { width: 100%; border: 1px solid #ddd; border-radius: 8px; padding: 7px 8px; font-size: 12px; outline: none; color: #1a1a2e; margin: 6px 0; }
    .fb-cf-author:focus { border-color: #7F77DD; }
    .fb-cf-actions { display: flex; gap: 8px; margin-top: 10px; }
    .fb-cf-cancel { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 8px; font-size: 12px; cursor: pointer; background: white; color: #555; }
    .fb-cf-submit { flex: 2; padding: 8px; border: none; border-radius: 8px; font-size: 12px; cursor: pointer; background: #7F77DD; color: white; font-weight: 600; }
    .fb-cf-submit:hover { background: #534AB7; }

    /* 詳情彈窗 */
    #fb-detail-popup {
      position: fixed; z-index: 2147483647;
      background: white; border-radius: 12px;
      padding: 16px; width: 320px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      border: 0.5px solid #e5e5e5;
    }
    #fb-detail-popup.hidden { display: none; }
    .fb-dp-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .fb-dp-badge { padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; }
    .fb-dp-id { font-size: 12px; color: #999; }
    .fb-dp-close { margin-left: auto; cursor: pointer; color: #999; font-size: 16px; }
    .fb-dp-close:hover { color: #333; }
    .fb-dp-comment { font-size: 13px; color: #1a1a2e; line-height: 1.6; margin-bottom: 12px; }
    .fb-dp-author { font-size: 11px; color: #888; margin-bottom: 12px; }
    .fb-dp-section { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .fb-dp-code { background: #f5f5f5; border-radius: 6px; padding: 8px; font-family: monospace; font-size: 10px; color: #333; line-height: 1.7; margin-bottom: 10px; word-break: break-all; }
    .fb-dp-actions { display: flex; gap: 6px; }
    .fb-dp-btn { flex: 1; padding: 7px; border: 1px solid #ddd; border-radius: 8px; font-size: 11px; cursor: pointer; background: white; color: #555; text-align: center; }
    .fb-dp-btn:hover { background: #f5f5f5; }
    .fb-dp-btn.resolve { border-color: #639922; color: #3B6D11; background: #EAF3DE; }
    .fb-dp-btn.resolve:hover { background: #C0DD97; }
    .fb-dp-btn.del { border-color: #E24B4A; color: #A32D2D; }
    .fb-dp-btn.del:hover { background: #FCEBEB; }

    /* 面板 */
    #fb-panel {
      top: 0; right: 0; width: 340px; height: 100vh;
      background: white; border-left: 0.5px solid #e5e5e5;
      display: flex; flex-direction: column;
      box-shadow: -4px 0 24px rgba(0,0,0,0.1);
    }
    #fb-panel.hidden { display: none; }
    .fb-panel-header { padding: 16px; border-bottom: 0.5px solid #eee; display: flex; align-items: center; gap: 10px; }
    .fb-panel-header h2 { font-size: 15px; font-weight: 700; color: #1a1a2e; flex: 1; margin: 0; }
    .fb-panel-close { cursor: pointer; color: #999; font-size: 18px; }
    .fb-panel-close:hover { color: #333; }
    .fb-panel-filter { padding: 10px 16px; border-bottom: 0.5px solid #eee; display: flex; gap: 6px; flex-wrap: wrap; background: #fafafa; }
    .fb-filter-chip { padding: 4px 10px; border-radius: 99px; font-size: 11px; cursor: pointer; border: 1px solid #e5e5e5; background: white; color: #555; transition: all 0.15s; }
    .fb-filter-chip.active { border-color: #7F77DD; background: #EEEDFE; color: #3C3489; font-weight: 500; }
    .fb-panel-list { flex: 1; overflow-y: auto; padding: 8px; }
    .fb-panel-item { padding: 12px 14px; border: 0.5px solid #e5e5e5; border-radius: 10px; margin-bottom: 6px; cursor: pointer; transition: all 0.15s; }
    .fb-panel-item:hover { border-color: #ccc; background: #fafafa; }
    .fb-panel-item.resolved { opacity: 0.5; }
    .fb-pi-top { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .fb-pi-text { font-size: 12px; color: #333; line-height: 1.5; }
    .fb-pi-meta { font-size: 10px; color: #aaa; margin-top: 5px; }
    .fb-pi-sel { font-family: monospace; font-size: 10px; color: #888; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fb-panel-footer { padding: 12px 16px; border-top: 0.5px solid #eee; display: flex; gap: 8px; }
    .fb-panel-footer button { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 8px; font-size: 12px; cursor: pointer; background: white; color: #555; }
    .fb-panel-footer button:hover { background: #f5f5f5; }
    .fb-panel-footer .fb-export-btn { border-color: #7F77DD; color: #534AB7; background: #EEEDFE; }
    .fb-panel-footer .fb-export-btn:hover { background: #CEC8F4; }
  `;

  function injectStyles() {
    if (document.getElementById('fb-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'fb-overlay-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  /* ───────── 狀態 ───────── */
  const state = {
    isSelecting: false,
    annotations: loadAnnotations(),
    nextNum: 0,
    currentTarget: null,
    currentType: 'bug',
    filterType: 'all',
    hoverEl: null,
  };

  state.nextNum = state.annotations.length
    ? Math.max(...state.annotations.map(a => a.num)) + 1
    : 1;

  /* ───────── DOM 建構 ───────── */
  let root, toolbar, hoverOutline, commentForm, detailPopup, panel;

  function buildDOM() {
    root = document.createElement('div');
    root.className = 'fb-overlay-root';
    document.body.appendChild(root);

    /* 懸停輪廓 */
    hoverOutline = document.createElement('div');
    hoverOutline.className = 'fb-hover-outline';
    hoverOutline.style.display = 'none';
    document.body.appendChild(hoverOutline);

    /* 工具列 */
    toolbar = document.createElement('div');
    toolbar.id = 'fb-toolbar';
    toolbar.className = 'fb-overlay-root';
    toolbar.innerHTML = `
      <div class="fb-logo">Feed<span>mark</span></div>
      <div class="fb-divider"></div>
      <button class="fb-tb-btn" id="fb-btn-annotate">＋ 標註</button>
      <button class="fb-tb-btn" id="fb-btn-panel">清單 <span class="fb-badge-count" id="fb-count">0</span></button>
      <div class="fb-divider"></div>
      <button class="fb-tb-btn" id="fb-btn-toggle-pins">📍 顯示</button>
      <button class="fb-tb-btn" id="fb-btn-close" title="關閉系統">✕</button>
    `;
    document.body.appendChild(toolbar);

    /* 留言表單 */
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

    /* 詳情彈窗 */
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
      <div class="fb-dp-section">XPath</div>
      <div class="fb-dp-code" id="dp-xpath"></div>
      <div class="fb-dp-section">位置 (x, y, 寬, 高) / 文字節錄</div>
      <div class="fb-dp-code" id="dp-meta"></div>
      <div class="fb-dp-actions">
        <button class="fb-dp-btn" id="dp-copy">複製定位</button>
        <button class="fb-dp-btn resolve" id="dp-resolve">✓ 完成</button>
        <button class="fb-dp-btn del" id="dp-del">刪除</button>
      </div>
    `;
    document.body.appendChild(detailPopup);

    /* 面板 */
    panel = document.createElement('div');
    panel.id = 'fb-panel';
    panel.className = 'fb-overlay-root hidden';
    panel.innerHTML = `
      <div class="fb-panel-header">
        <h2>回饋清單</h2>
        <span class="fb-panel-close" id="fb-panel-close">✕</span>
      </div>
      <div class="fb-panel-filter" id="fb-panel-filter">
        <span class="fb-filter-chip active" data-type="all">全部</span>
      </div>
      <div class="fb-panel-list" id="fb-panel-list"></div>
      <div class="fb-panel-footer">
        <button id="fb-clear-resolved">清除已完成</button>
        <button class="fb-export-btn" id="fb-export">匯出 JSON</button>
      </div>
    `;
    document.body.appendChild(panel);

    buildTypeChips();
    buildFilterChips();
    updateCount();
    renderPins();
    renderPanelList();
    bindEvents();
  }

  function buildTypeChips() {
    const row = document.getElementById('fb-type-row');
    row.innerHTML = CONFIG.badgeTypes.map(t => `
      <span class="fb-type-chip ${t.id === state.currentType ? 'selected' : ''}"
        data-type="${t.id}" style="color:${t.color}; background:${t.bg}">
        ${t.label}
      </span>
    `).join('');
    row.querySelectorAll('.fb-type-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        state.currentType = chip.dataset.type;
        row.querySelectorAll('.fb-type-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      });
    });
  }

  function buildFilterChips() {
    const row = document.getElementById('fb-panel-filter');
    const extra = CONFIG.badgeTypes.map(t =>
      `<span class="fb-filter-chip" data-type="${t.id}" style="--c:${t.color}">${t.label.split(' ')[0]}</span>`
    ).join('');
    row.innerHTML = `<span class="fb-filter-chip active" data-type="all">全部</span>` + extra +
      `<span class="fb-filter-chip" data-type="unresolved">未完成</span>`;
    row.querySelectorAll('.fb-filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        state.filterType = chip.dataset.type;
        row.querySelectorAll('.fb-filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderPanelList();
      });
    });
  }

  function updateCount() {
    const el = document.getElementById('fb-count');
    if (el) el.textContent = state.annotations.filter(a => !a.resolved).length;
  }

  /* ───────── 標記圓點 ───────── */
  let pinsContainer = null;

  function renderPins() {
    if (pinsContainer) pinsContainer.remove();
    pinsContainer = document.createElement('div');
    pinsContainer.id = 'fb-pins';
    document.body.appendChild(pinsContainer);

    state.annotations.forEach(a => {
      if (a.resolved) return;
      const typeInfo = CONFIG.badgeTypes.find(t => t.id === a.type) || CONFIG.badgeTypes[0];
      const pin = document.createElement('div');
      pin.className = 'fb-pin';
      pin.dataset.id = a.id;
      pin.textContent = a.num;
      pin.style.cssText = `
        left:${a.pos.x + a.pos.width * 0.1 + window.scrollX}px;
        top:${a.pos.y + window.scrollY}px;
        background:${typeInfo.color};
        position:absolute;
      `;
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        showDetail(a.id, e);
      });
      pinsContainer.appendChild(pin);
    });
  }

  /* ───────── 面板清單 ───────── */
  function renderPanelList() {
    const list = document.getElementById('fb-panel-list');
    let items = state.annotations;
    if (state.filterType !== 'all') {
      if (state.filterType === 'unresolved') items = items.filter(a => !a.resolved);
      else items = items.filter(a => a.type === state.filterType);
    }
    if (!items.length) {
      list.innerHTML = `<div style="text-align:center;color:#aaa;padding:40px 16px;font-size:13px;">尚無標註</div>`;
      return;
    }
    list.innerHTML = items.map(a => {
      const typeInfo = CONFIG.badgeTypes.find(t => t.id === a.type) || CONFIG.badgeTypes[0];
      return `
        <div class="fb-panel-item ${a.resolved ? 'resolved' : ''}" data-id="${a.id}">
          <div class="fb-pi-top">
            <span class="fb-dp-badge" style="background:${typeInfo.bg};color:${typeInfo.color};padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600">${typeInfo.label}</span>
            <span style="font-size:10px;color:#aaa">#${a.num}</span>
            ${a.resolved ? '<span style="font-size:10px;color:#639922;margin-left:auto">✓ 完成</span>' : ''}
          </div>
          <div class="fb-pi-text">${escHtml(a.comment)}</div>
          <div class="fb-pi-sel">${escHtml(a.selector)}</div>
          <div class="fb-pi-meta">${a.author ? escHtml(a.author) + '・' : ''}${new Date(a.createdAt).toLocaleString('zh-TW')}</div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.fb-panel-item').forEach(item => {
      item.addEventListener('click', (e) => {
        showDetail(item.dataset.id, e);
      });
    });
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ───────── 詳情彈窗 ───────── */
  let currentDetailId = null;

  function showDetail(id, event) {
    const a = state.annotations.find(x => x.id === id);
    if (!a) return;
    currentDetailId = id;

    const typeInfo = CONFIG.badgeTypes.find(t => t.id === a.type) || CONFIG.badgeTypes[0];
    document.getElementById('dp-badge').textContent = typeInfo.label;
    document.getElementById('dp-badge').style.cssText = `background:${typeInfo.bg};color:${typeInfo.color};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600`;
    document.getElementById('dp-id').textContent = `#${a.num}`;
    document.getElementById('dp-comment').textContent = a.comment;
    document.getElementById('dp-author').textContent = a.author
      ? `👤 ${a.author} ・ ${new Date(a.createdAt).toLocaleString('zh-TW')}`
      : `${new Date(a.createdAt).toLocaleString('zh-TW')}`;
    document.getElementById('dp-selector').textContent = a.selector;
    document.getElementById('dp-xpath').textContent = a.xpath;
    document.getElementById('dp-meta').textContent =
      `x:${a.pos.x}, y:${a.pos.y}, w:${a.pos.width}, h:${a.pos.height}\n` +
      (a.textSnippet ? `文字: "${a.textSnippet}"` : '') +
      (Object.keys(a.dataAttrs || {}).length ? `\n${JSON.stringify(a.dataAttrs)}` : '');

    const popup = detailPopup;
    popup.classList.remove('hidden');

    // 定位彈窗避免超出視窗
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min((event?.clientX || vw / 2) + 12, vw - 340);
    let top = Math.min((event?.clientY || vh / 2) - 20, vh - 460);
    popup.style.left = Math.max(8, left) + 'px';
    popup.style.top = Math.max(8, top) + 'px';
  }

  function closeDetail() {
    detailPopup.classList.add('hidden');
    currentDetailId = null;
  }

  /* ───────── 選取流程 ───────── */
  function startSelecting() {
    state.isSelecting = true;
    document.body.classList.add('fb-selecting');
    document.getElementById('fb-btn-annotate').classList.add('active');
    document.getElementById('fb-btn-annotate').textContent = '取消選取';
    closeDetail();
  }

  function stopSelecting() {
    state.isSelecting = false;
    document.body.classList.remove('fb-selecting');
    hoverOutline.style.display = 'none';
    document.getElementById('fb-btn-annotate').classList.remove('active');
    document.getElementById('fb-btn-annotate').textContent = '＋ 標註';
  }

  function isOverlayEl(el) {
    return el.closest('#fb-toolbar, #fb-comment-form, #fb-detail-popup, #fb-panel, #fb-pins, .fb-hover-outline');
  }

  /* ───────── 事件綁定 ───────── */
  function bindEvents() {
    /* 工具列按鈕 */
    document.getElementById('fb-btn-annotate').addEventListener('click', () => {
      if (state.isSelecting) stopSelecting();
      else startSelecting();
    });

    document.getElementById('fb-btn-panel').addEventListener('click', () => {
      panel.classList.toggle('hidden');
      renderPanelList();
    });

    document.getElementById('fb-panel-close').addEventListener('click', () => {
      panel.classList.add('hidden');
    });

    let pinsVisible = true;
    document.getElementById('fb-btn-toggle-pins').addEventListener('click', () => {
      pinsVisible = !pinsVisible;
      if (pinsContainer) pinsContainer.style.display = pinsVisible ? '' : 'none';
      document.getElementById('fb-btn-toggle-pins').textContent = pinsVisible ? '📍 顯示' : '👁 隱藏';
    });

    document.getElementById('fb-btn-close').addEventListener('click', destroy);

    /* 滑鼠移動 — 懸停輪廓 */
    document.addEventListener('mouseover', (e) => {
      if (!state.isSelecting || isOverlayEl(e.target)) return;
      state.hoverEl = e.target;
      const r = e.target.getBoundingClientRect();
      hoverOutline.style.cssText = `
        display:block; position:fixed;
        left:${r.left - 2}px; top:${r.top - 2}px;
        width:${r.width + 4}px; height:${r.height + 4}px;
        border:2px dashed #7F77DD; background:rgba(127,119,221,0.08);
        border-radius:3px; pointer-events:none; z-index:2147483646;
      `;
    });

    /* 點擊選取元素 */
    document.addEventListener('click', (e) => {
      if (!state.isSelecting) return;
      if (isOverlayEl(e.target)) return;
      e.preventDefault();
      e.stopPropagation();

      state.currentTarget = e.target;
      hoverOutline.style.display = 'none';
      stopSelecting();
      showCommentForm(e);
    }, true);

    /* 留言表單 */
    document.getElementById('fb-cf-close').addEventListener('click', hideCommentForm);
    document.getElementById('fb-cf-cancel').addEventListener('click', hideCommentForm);
    document.getElementById('fb-cf-submit').addEventListener('click', submitAnnotation);

    /* 詳情彈窗 */
    document.getElementById('dp-close').addEventListener('click', closeDetail);
    document.getElementById('dp-copy').addEventListener('click', () => {
      const a = state.annotations.find(x => x.id === currentDetailId);
      if (!a) return;
      const text = `CSS Selector: ${a.selector}\nXPath: ${a.xpath}\nPosition: x:${a.pos.x}, y:${a.pos.y}, w:${a.pos.width}, h:${a.pos.height}`;
      navigator.clipboard?.writeText(text).then(() => {
        document.getElementById('dp-copy').textContent = '已複製！';
        setTimeout(() => { document.getElementById('dp-copy').textContent = '複製定位'; }, 1500);
      });
    });

    document.getElementById('dp-resolve').addEventListener('click', () => {
      const a = state.annotations.find(x => x.id === currentDetailId);
      if (!a) return;
      a.resolved = !a.resolved;
      saveAnnotations(state.annotations);
      renderPins();
      renderPanelList();
      updateCount();
      closeDetail();
    });

    document.getElementById('dp-del').addEventListener('click', () => {
      if (!confirm('確定刪除此標註？')) return;
      state.annotations = state.annotations.filter(a => a.id !== currentDetailId);
      saveAnnotations(state.annotations);
      renderPins();
      renderPanelList();
      updateCount();
      closeDetail();
    });

    /* 面板按鈕 */
    document.getElementById('fb-export').addEventListener('click', exportJSON);
    document.getElementById('fb-clear-resolved').addEventListener('click', () => {
      if (!confirm('確定清除所有已完成的標註？')) return;
      state.annotations = state.annotations.filter(a => !a.resolved);
      saveAnnotations(state.annotations);
      renderPins();
      renderPanelList();
      updateCount();
    });

    /* ESC 取消 */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        stopSelecting();
        hideCommentForm();
        closeDetail();
      }
    });

    /* 點擊外部關閉彈窗 */
    document.addEventListener('click', (e) => {
      if (!detailPopup.classList.contains('hidden') &&
          !detailPopup.contains(e.target) &&
          !e.target.classList.contains('fb-pin') &&
          !e.target.closest('.fb-panel-item')) {
        closeDetail();
      }
    });
  }

  /* ───────── 留言表單邏輯 ───────── */
  function showCommentForm(e) {
    const el = state.currentTarget;
    if (!el) return;

    const selector = getCssSelector(el);
    const xpath = getXPath(el);
    const pos = getAbsoluteRect(el);
    const snippet = getTextSnippet(el);

    document.getElementById('fb-cf-el-info').textContent =
      `${el.tagName.toLowerCase()}  ${selector}\n${snippet ? `"${snippet}"` : ''}`;

    // 暫存到 form
    commentForm.dataset.selector = selector;
    commentForm.dataset.xpath = xpath;
    commentForm.dataset.pos = JSON.stringify(pos);
    commentForm.dataset.dataAttrs = JSON.stringify(getDataAttributes(el));
    commentForm.dataset.snippet = snippet;

    commentForm.style.display = 'block';
    document.getElementById('fb-cf-text').value = '';
    document.getElementById('fb-cf-text').focus();

    const vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min(e.clientX + 12, vw - 318);
    let top = Math.min(e.clientY - 10, vh - 360);
    commentForm.style.left = Math.max(8, left) + 'px';
    commentForm.style.top = Math.max(8, top) + 'px';
  }

  function hideCommentForm() {
    commentForm.style.display = 'none';
    state.currentTarget = null;
  }

  function submitAnnotation() {
    const text = document.getElementById('fb-cf-text').value.trim();
    if (!text) {
      document.getElementById('fb-cf-text').style.borderColor = '#E24B4A';
      return;
    }
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
    renderPins();
    renderPanelList();
    updateCount();

    // 短暫提示
    const tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;bottom:80px;right:24px;background:#1a1a2e;color:white;padding:8px 16px;border-radius:8px;font-size:12px;z-index:2147483647;opacity:1;transition:opacity 0.4s';
    tip.textContent = `標註 #${annotation.num} 已儲存`;
    document.body.appendChild(tip);
    setTimeout(() => { tip.style.opacity = '0'; setTimeout(() => tip.remove(), 400); }, 2000);
  }

  /* ───────── 開關 & 銷毀 ───────── */
  const overlay = {
    toggle() {
      toolbar.style.display = toolbar.style.display === 'none' ? 'flex' : 'none';
    }
  };

  function destroy() {
    stopSelecting();
    [root, toolbar, hoverOutline, commentForm, detailPopup, panel, pinsContainer].forEach(el => el?.remove());
    document.getElementById('fb-overlay-styles')?.remove();
    window.__feedbackOverlayLoaded = false;
    window.__feedbackOverlay = null;
  }

  /* ───────── 初始化 ───────── */
  injectStyles();
  buildDOM();
  window.__feedbackOverlay = overlay;

  console.log('%c[FeedbackOverlay] 已啟動 ✓', 'color:#7F77DD;font-weight:bold');
  console.log('已載入', state.annotations.length, '筆標註');
  console.log('使用 window.__feedbackOverlay.toggle() 顯示/隱藏工具列');

})();
