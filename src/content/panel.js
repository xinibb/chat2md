/*
 * 导出面板：Shadow DOM 悬浮球 + 面板
 * 视图：list（会话列表）/ chat（问答勾选）/ diag（结构诊断）
 * 支持：单会话多选导出、导出篮跨会话合并、当前会话直接导出
 */
(function () {
  window.AIEXP = window.AIEXP || {};
  if (window.AIEXP.panel) return;

  var A = window.AIEXP.adapters;
  var S = window.AIEXP.scraper;
  var M = window.AIEXP.md;

  var adapter = null;
  var host = null;
  var root = null;
  var ball = null;
  var panelEl = null;

  var state = {
    view: 'list',            // list | chat | diag
    open: false,
    loading: false,
    status: '',
    conversations: [],
    current: null,           // {id,title,el,url}
    turns: [],               // [{role, md, time}]
    selected: new Set(),
    expanded: new Set(),
    basket: [],              // [{title, url, turns}]
    diag: null
  };

  // ---------- 工具 ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function toast(msg) {
    var t = el('div', 'toast', esc(msg));
    panelEl.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 300);
    }, 2200);
  }

  function setStatus(s) { state.status = s; renderStatus(); }

  function renderStatus() {
    var st = root.getElementById('st');
    if (st) st.textContent = state.status;
  }

  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || '已复制到剪贴板'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
    } else { legacyCopy(text); done(); }
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }

  // ---------- 标题/文件名 ----------
  function getCurrentTitle() {
    var t = (document.title || '').split(/\s+[-–—|·]\s+/)[0].trim();
    if (!t || t.length < 2 || /^(new chat|新聊天|新对话|google gemini|gemini|deepseek|通义千问|qianwen|mimo|chatgpt|claude)$/i.test(t)) {
      try {
        var turns = S.collectTurnsDOM(adapter);
        var first = null;
        for (var i = 0; i < turns.length; i++) {
          if (turns[i].role === 'user') { first = turns[i]; break; }
        }
        if (first && first.text) t = first.text.slice(0, 30);
      } catch (e) { /* ignore */ }
    }
    return t || '未命名会话';
  }

  function dateStamp() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function defaultName(title) {
    return adapter.id + '-' + (title || '会话') + '-' + dateStamp() + '.md';
  }

  // ---------- 数据加载 ----------
  async function refreshConversations() {
    state.loading = true;
    state.status = '正在读取会话列表…';
    render();
    try {
      state.conversations = await S.listConversations(adapter);
      state.status = state.conversations.length
        ? '共 ' + state.conversations.length + ' 个会话'
        : '未发现历史会话（可导出当前会话）';
    } catch (e) {
      state.status = '读取失败：' + e.message;
    }
    state.loading = false;
    render();
  }

  async function openConversation(conv) {
    state.loading = true;
    state.status = '正在加载「' + conv.title + '」…';
    state.view = 'chat';
    state.selected = new Set();
    state.expanded = new Set();
    render();
    try {
      state.current = conv;
      state.turns = await S.loadTurns(adapter, conv);
      state.turns.forEach(function (_, i) { state.selected.add(i); });
      state.status = '共 ' + state.turns.length + ' 条问答，默认全选';
    } catch (e) {
      state.status = '加载失败：' + e.message;
      state.turns = [];
    }
    state.loading = false;
    render();
  }

  function previewText(md) {
    var t = (md || '')
      .replace(/```[\s\S]*?```/g, ' [代码块] ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图片] ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*`~|_\-]/g, '')
      .replace(/\$\$?[^$]*\$\$?/g, ' [公式] ')
      .replace(/\s+/g, ' ')
      .trim();
    return t.slice(0, 160);
  }

  // ---------- 导出 ----------
  async function doExport(doc, filename) {
    await M.download(doc, M.safeFilename(filename));
  }

  async function exportSelection() {
    var idxs = Array.from(state.selected).sort(function (a, b) { return a - b; });
    if (!idxs.length) { toast('请先勾选要导出的问答'); return; }
    var turns = idxs.map(function (i) { return state.turns[i]; });
    setStatus('正在生成 Markdown…');
    var startUrl = location.href;
    try {
      var title = (state.current && state.current.title) || getCurrentTitle();
      var doc = M.buildDoc({
        platformName: adapter.name,
        title: title,
        url: (state.current && state.current.url) || location.href,
        turns: turns
      });
      var nameInput = root.getElementById('fname');
      var fname = (nameInput && nameInput.value.trim()) || defaultName(title);
      await doExport(doc, fname);
      setStatus('✔ 已导出：' + fname);
      toast('已导出 ' + turns.length + ' 条问答');
    } catch (e) {
      setStatus('导出失败：' + e.message);
      toast('导出失败：' + e.message);
    }
    if (location.href !== startUrl) location.href = startUrl;
  }

  function addToBasket() {
    var idxs = Array.from(state.selected).sort(function (a, b) { return a - b; });
    if (!idxs.length) { toast('请先勾选要加入的问答'); return; }
    state.basket.push({
      title: (state.current && state.current.title) || getCurrentTitle(),
      url: (state.current && state.current.url) || location.href,
      turns: idxs.map(function (i) { return state.turns[i]; })
    });
    var n = 0;
    state.basket.forEach(function (g) { n += g.turns.length; });
    toast('已加入导出篮（现有 ' + n + ' 条 / ' + state.basket.length + ' 个会话）');
    renderBasketBtn();
  }

  function basketCount() {
    var n = 0;
    state.basket.forEach(function (g) { n += g.turns.length; });
    return n;
  }

  async function exportBasket() {
    if (!state.basket.length) { toast('导出篮为空'); return; }
    setStatus('正在生成合并 Markdown…');
    try {
      var doc = M.buildDoc({
        platformName: adapter.name,
        title: '多会话合并导出（' + adapter.name + '）',
        groups: state.basket
      });
      var nameInput = root.getElementById('fname');
      var fname = (nameInput && nameInput.value.trim()) || (adapter.id + '-合并导出-' + dateStamp() + '.md');
      await doExport(doc, fname);
      setStatus('✔ 已导出合并文件：' + fname);
      toast('已导出 ' + basketCount() + ' 条问答');
      state.basket = [];
      renderBasketBtn();
    } catch (e) {
      setStatus('导出失败：' + e.message);
    }
  }

  function renderBasketBtn() {
    var b = root.getElementById('basket-btn');
    if (!b) return;
    var n = basketCount();
    b.textContent = '🧺 导出篮' + (n ? '（' + n + '）' : '');
    b.classList.toggle('has', n > 0);
  }

  /** 列表页一键导出整个会话 */
  async function quickExport(conv, ev) {
    if (ev) ev.stopPropagation();
    setStatus('正在加载并导出「' + conv.title + '」…');
    render();
    var startUrl = location.href;
    try {
      var turns = await S.loadTurns(adapter, conv);
      if (!turns.length) { setStatus('未抓到问答，请用「结构诊断」反馈'); return; }
      var doc = M.buildDoc({
        platformName: adapter.name, title: conv.title, url: conv.url || location.href, turns: turns
      });
      await doExport(doc, defaultName(conv.title));
      setStatus('✔ 已导出：' + conv.title);
      toast('已导出「' + conv.title + '」');
    } catch (e) {
      setStatus('导出失败：' + e.message);
    }
    if (location.href !== startUrl) location.href = startUrl;
  }

  /** 导出当前正在浏览的会话（不切换页面） */
  async function exportCurrent() {
    setStatus('正在抓取当前会话…');
    render();
    var startUrl = location.href;
    try {
      var conv = { title: getCurrentTitle(), url: location.href, el: null };
      var turns = await S.loadTurns(adapter, conv);
      if (!turns.length) { setStatus('当前视图未识别到问答，请用「结构诊断」反馈'); return; }
      var doc = M.buildDoc({
        platformName: adapter.name, title: conv.title, url: conv.url, turns: turns
      });
      await doExport(doc, defaultName(conv.title));
      setStatus('✔ 已导出当前会话（' + turns.length + ' 条）');
      toast('已导出当前会话');
    } catch (e) {
      setStatus('导出失败：' + e.message);
    }
    if (location.href !== startUrl) location.href = startUrl;
  }

  // ---------- 诊断 ----------
  function runDiagnose() {
    var sel = adapter.selectors;
    var sidebar = A.qs(document, sel.sidebar) || document;
    var info = {
      platform: adapter.name,
      adapterId: adapter.id,
      url: location.href,
      hasApi: !!(adapter.api && adapter.api.list),
      convItemsFound: A.qsa(sidebar, sel.convItem).length,
      msgsInView: S.currentCount(adapter),
      turnsDetected: 0,
      genericCollectWouldFind: 0
    };
    try { info.turnsDetected = S.collectTurnsDOM(adapter).length; } catch (e) { info.turnsDetected = 'err:' + e.message; }
    try { info.genericCollectWouldFind = A.genericCollect().length; } catch (e) { info.genericCollectWouldFind = 'err:' + e.message; }
    state.diag = info;
    state.view = 'diag';
    render();
  }

  function copyDiag() {
    var sel = adapter.selectors;
    var container = A.qs(document, sel.scrollArea) || document.body;
    var skeleton = (container.outerHTML || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/\s+/g, ' ')
      .slice(0, 6000);
    var text = JSON.stringify(state.diag, null, 2) +
      '\n\n===== 消息区 DOM 骨架（前6000字符）=====\n' + skeleton;
    copyText(text, '诊断信息已复制，可发给开发者校准选择器');
  }

  // ---------- 渲染 ----------
  var CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .ball {
      position: fixed; right: 18px; bottom: 18px; width: 48px; height: 48px;
      border-radius: 50%; cursor: pointer; z-index: 2147483646;
      background: linear-gradient(135deg, #2563eb, #1e40af);
      color: #fff; font: bold 15px/48px system-ui, -apple-system, "Segoe UI", sans-serif;
      text-align: center; box-shadow: 0 4px 14px rgba(37,99,235,.45);
      user-select: none; transition: transform .15s;
    }
    .ball:hover { transform: scale(1.08); }
    .ball .dot {
      position: absolute; top: -2px; right: -2px; min-width: 18px; height: 18px;
      border-radius: 9px; background: #ef4444; color: #fff;
      font: 600 11px/18px system-ui, sans-serif; padding: 0 4px; display: none;
    }
    .ball.has-basket .dot { display: block; }
    .panel {
      position: fixed; right: 18px; bottom: 78px; width: 440px; height: 640px;
      background: #fff; border-radius: 14px; z-index: 2147483647;
      box-shadow: 0 12px 40px rgba(0,0,0,.18); display: none;
      flex-direction: column; overflow: hidden;
      font: 13px/1.55 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #111827; border: 1px solid #e5e7eb;
    }
    .panel.open { display: flex; }
    .p-head {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px;
      background: #f9fafb; border-bottom: 1px solid #e5e7eb; flex: none;
    }
    .p-head .t { font-weight: 700; font-size: 14px; }
    .p-head .badge {
      font-size: 11px; background: #eff6ff; color: #1d4ed8;
      border: 1px solid #bfdbfe; border-radius: 20px; padding: 1px 8px; font-weight: 600;
    }
    .p-head .sp { flex: 1; }
    .icon-btn {
      border: none; background: transparent; cursor: pointer; font-size: 15px;
      padding: 4px 7px; border-radius: 6px; color: #6b7280;
    }
    .icon-btn:hover { background: #e5e7eb; color: #111827; }
    .p-body { flex: 1; overflow-y: auto; padding: 8px; }
    .p-foot { flex: none; border-top: 1px solid #e5e7eb; padding: 8px 12px; background: #f9fafb; }
    #st { font-size: 11px; color: #6b7280; min-height: 15px; margin-bottom: 6px; word-break: break-all; }
    .row {
      display: flex; align-items: center; gap: 8px; padding: 9px 10px;
      border-radius: 8px; cursor: pointer; margin-bottom: 2px;
    }
    .row:hover { background: #f3f4f6; }
    .row .rt { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row .rt .sub { font-size: 11px; color: #9ca3af; }
    .row .dl { border: none; background: #eff6ff; color: #1d4ed8; border-radius: 6px;
      padding: 3px 8px; font-size: 12px; cursor: pointer; flex: none; }
    .row .dl:hover { background: #dbeafe; }
    .empty { text-align: center; color: #9ca3af; padding: 40px 16px; font-size: 12px; }
    .toolbar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .tbtn {
      border: 1px solid #d1d5db; background: #fff; border-radius: 6px;
      padding: 4px 9px; font-size: 12px; cursor: pointer; color: #374151;
    }
    .tbtn:hover { background: #f3f4f6; }
    .tbtn.on { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; }
    .conv-title {
      font-size: 12px; font-weight: 700; color: #374151; padding: 4px 2px 8px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .turn { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 6px; overflow: hidden; }
    .turn.sel { border-color: #f59e0b; background: #fffbeb; }
    .turn .hd { display: flex; align-items: center; gap: 7px; padding: 7px 9px; cursor: pointer; }
    .turn .hd input[type=checkbox] { flex: none; width: 15px; height: 15px; accent-color: #2563eb; cursor: pointer; }
    .turn .role {
      flex: none; font-size: 11px; font-weight: 700; border-radius: 5px; padding: 1px 7px;
    }
    .turn .role.user { background: #eff6ff; color: #1d4ed8; }
    .turn .role.asst { background: #f0fdf4; color: #15803d; }
    .turn .time { flex: none; font-size: 11px; color: #9ca3af; }
    .turn .prev {
      flex: 1; font-size: 12px; color: #6b7280; overflow: hidden;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .turn .full {
      display: none; padding: 0 10px 10px; font-size: 12px; color: #374151;
      white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow-y: auto;
      border-top: 1px dashed #e5e7eb; margin-top: 2px; padding-top: 8px;
    }
    .turn.exp .full { display: block; }
    .foot-row { display: flex; gap: 6px; align-items: center; }
    .foot-row input[type=text] {
      flex: 1; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 8px;
      font-size: 12px; min-width: 0;
    }
    .btn {
      border: none; border-radius: 7px; padding: 7px 12px; font-size: 12px;
      cursor: pointer; font-weight: 600; white-space: nowrap;
    }
    .btn.primary { background: #2563eb; color: #fff; }
    .btn.primary:hover { background: #1d4ed8; }
    .btn.ghost { background: #e5e7eb; color: #374151; }
    .btn.ghost:hover { background: #d1d5db; }
    .btn.has { background: #f59e0b; color: #fff; }
    .chk { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #6b7280; white-space: nowrap; }
    .toast {
      position: absolute; left: 50%; top: 56px; transform: translate(-50%, -8px);
      background: #111827; color: #fff; font-size: 12px; border-radius: 8px;
      padding: 7px 14px; opacity: 0; transition: all .25s; pointer-events: none;
      max-width: 92%; z-index: 10;
    }
    .toast.show { opacity: .95; transform: translate(-50%, 0); }
    .diag-pre {
      background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px;
      padding: 10px; font: 11px/1.5 ui-monospace, Consolas, monospace;
      white-space: pre-wrap; word-break: break-all; max-height: 460px; overflow-y: auto;
    }
  `;

  function buildShell() {
    host = document.createElement('div');
    host.id = 'aiexp-host';
    root = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    ball = el('div', 'ball', 'MD');
    ball.title = 'AI 对话导出';
    var dot = el('div', 'dot');
    ball.appendChild(dot);
    ball.addEventListener('click', togglePanel);
    root.appendChild(ball);

    panelEl = el('div', 'panel');
    panelEl.id = 'panel';
    root.appendChild(panelEl);

    (document.body || document.documentElement).appendChild(host);
  }

  function togglePanel() {
    state.open = !state.open;
    panelEl.classList.toggle('open', state.open);
    if (state.open && state.view === 'list' && !state.conversations.length && !state.loading) {
      refreshConversations();
    }
  }

  function headHtml() {
    return '<span class="t">📄 AI 对话导出</span>' +
      '<span class="badge">' + esc(adapter.name) + '</span>' +
      '<span class="sp"></span>' +
      '<button class="icon-btn" id="btn-diag" title="结构诊断">🔧</button>' +
      '<button class="icon-btn" id="btn-close" title="收起">✕</button>';
  }

  function render() {
    if (!panelEl) return;
    var html = '<div class="p-head">' + headHtml() + '</div><div class="p-body">';

    if (state.loading) {
      html += '<div class="empty">⏳ ' + esc(state.status) + '</div>';
    } else if (state.view === 'diag') {
      html += '<div class="toolbar">' +
        '<button class="tbtn" id="d-back">← 返回</button>' +
        '<button class="tbtn" id="d-copy">📋 复制诊断信息</button></div>' +
        '<div class="diag-pre">' + esc(JSON.stringify(state.diag, null, 2)) + '</div>';
    } else if (state.view === 'list') {
      html += '<div class="toolbar">' +
        '<button class="tbtn" id="btn-current">⬇ 导出当前会话</button>' +
        '<button class="tbtn" id="btn-refresh">↻ 刷新列表</button>' +
        '<span style="flex:1"></span>' +
        '<button class="tbtn" id="basket-btn">🧺 导出篮</button></div>';
      if (!state.conversations.length) {
        html += '<div class="empty">未发现历史会话<br>请登录平台并产生过对话，或直接「导出当前会话」</div>';
      } else {
        state.conversations.forEach(function (c, i) {
          html += '<div class="row" data-i="' + i + '">' +
            '<span>💬</span>' +
            '<span class="rt">' + esc(c.title) + '<br><span class="sub">' + esc(c.id.slice(0, 40)) + '</span></span>' +
            '<button class="dl" data-q="' + i + '">导出</button></div>';
        });
      }
    } else if (state.view === 'chat') {
      var title = (state.current && state.current.title) || '当前会话';
      html += '<div class="toolbar">' +
        '<button class="tbtn" id="c-back">← 返回列表</button>' +
        '<button class="tbtn" id="c-all">全选</button>' +
        '<button class="tbtn" id="c-none">清空</button>' +
        '<button class="tbtn" id="c-inv">反选</button>' +
        '<button class="tbtn" id="c-user">仅用户</button>' +
        '<button class="tbtn" id="c-asst">仅助手</button>' +
        '<button class="tbtn" id="c-basket">🧺 加入导出篮</button></div>';
      html += '<div class="conv-title">🗂 ' + esc(title) + '</div>';
      if (!state.turns.length) {
        html += '<div class="empty">未识别到问答内容<br>请先用「🔧 结构诊断」确认页面结构</div>';
      } else {
        state.turns.forEach(function (t, i) {
          var sel = state.selected.has(i);
          var exp = state.expanded.has(i);
          html += '<div class="turn' + (sel ? ' sel' : '') + (exp ? ' exp' : '') + '" data-i="' + i + '">' +
            '<div class="hd" data-hd="' + i + '">' +
            '<input type="checkbox" data-cb="' + i + '"' + (sel ? ' checked' : '') + '>' +
            '<span class="role ' + (t.role === 'user' ? 'user' : 'asst') + '">' +
            (t.role === 'user' ? '🧑 提问' : '🤖 回答') + '</span>' +
            (t.time ? '<span class="time">' + esc(t.time) + '</span>' : '') +
            '<span class="prev">' + esc(previewText(t.md)) + '</span></div>' +
            '<div class="full">' + esc(t.md) + '</div></div>';
        });
      }
    }

    html += '</div>';

    // 底部
    html += '<div class="p-foot"><div id="st">' + esc(state.status) + '</div>';
    if (state.view === 'chat') {
      html += '<div class="foot-row">' +
        '<input type="text" id="fname" placeholder="文件名（默认自动生成）" value="' +
        esc(state.current ? defaultName(state.current.title) : '') + '">' +
        '<button class="btn primary" id="btn-export">导出所选</button></div>';
    } else if (state.view === 'list') {
      html += '<div class="foot-row">' +
        '<span class="chk">勾选会话可逐条选择问答；「导出」= 整篇导出</span></div>';
    } else {
      html += '<div class="foot-row"><span class="chk">诊断信息用于平台改版后校准选择器</span></div>';
    }
    html += '</div>';

    panelEl.innerHTML = html;
    bindEvents();
    renderBasketBtn();
    var dot = root.querySelector('.ball .dot');
    var n = basketCount();
    if (dot) dot.textContent = n > 99 ? '99+' : String(n);
    ball.classList.toggle('has-basket', n > 0);
  }

  function bindEvents() {
    var $ = function (id) { return root.getElementById(id); };

    var bc = $('btn-close'); if (bc) bc.onclick = togglePanel;
    var bd = $('btn-diag'); if (bd) bd.onclick = runDiagnose;
    var db = $('d-back'); if (db) db.onclick = function () { state.view = 'list'; render(); };
    var dc = $('d-copy'); if (dc) dc.onclick = copyDiag;

    var bcur = $('btn-current'); if (bcur) bcur.onclick = exportCurrent;
    var br = $('btn-refresh'); if (br) br.onclick = refreshConversations;
    var bb = $('basket-btn'); if (bb) bb.onclick = exportBasket;

    // 列表行
    Array.prototype.forEach.call(panelEl.querySelectorAll('.row'), function (row) {
      var i = +row.getAttribute('data-i');
      row.onclick = function () { openConversation(state.conversations[i]); };
    });
    Array.prototype.forEach.call(panelEl.querySelectorAll('.dl'), function (btn) {
      var i = +btn.getAttribute('data-q');
      btn.onclick = function (ev) { quickExport(state.conversations[i], ev); };
    });

    // chat 视图
    var cback = $('c-back'); if (cback) cback.onclick = function () { state.view = 'list'; render(); };
    var call = $('c-all'); if (call) call.onclick = function () { state.turns.forEach(function (_, i) { state.selected.add(i); }); render(); };
    var cn = $('c-none'); if (cn) cn.onclick = function () { state.selected.clear(); render(); };
    var ci = $('c-inv'); if (ci) ci.onclick = function () {
      state.turns.forEach(function (_, i) { state.selected.has(i) ? state.selected.delete(i) : state.selected.add(i); });
      render();
    };
    var cu = $('c-user'); if (cu) cu.onclick = function () {
      state.selected.clear();
      state.turns.forEach(function (t, i) { if (t.role === 'user') state.selected.add(i); });
      render();
    };
    var ca = $('c-asst'); if (ca) ca.onclick = function () {
      state.selected.clear();
      state.turns.forEach(function (t, i) { if (t.role === 'assistant') state.selected.add(i); });
      render();
    };
    var cbk = $('c-basket'); if (cbk) cbk.onclick = addToBasket;
    var be = $('btn-export'); if (be) be.onclick = exportSelection;

    // turn 行
    Array.prototype.forEach.call(panelEl.querySelectorAll('.turn'), function (turn) {
      var i = +turn.getAttribute('data-i');
      var hd = turn.querySelector('.hd');
      if (hd) hd.onclick = function (ev) {
        if (ev.target && ev.target.type === 'checkbox') return;
        state.expanded.has(i) ? state.expanded.delete(i) : state.expanded.add(i);
        turn.classList.toggle('exp');
      };
      var cb = turn.querySelector('input[type=checkbox]');
      if (cb) cb.onclick = function (ev) {
        ev.stopPropagation();
        state.selected.has(i) ? state.selected.delete(i) : state.selected.add(i);
        turn.classList.toggle('sel');
        setStatus('已选 ' + state.selected.size + ' / ' + state.turns.length + ' 条');
      };
    });
  }

  // ---------- 初始化 ----------
  function init(ad) {
    adapter = ad;
    buildShell();
    render();
  }

  window.AIEXP.panel = {
    init: init,
    state: state,
    refresh: refreshConversations
  };
})();
