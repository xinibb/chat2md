/*
 * 抓取层：会话列表收集、虚拟滚动全量加载、消息抽取、会话切换
 * 依赖：src/adapters/index.js（AIEXP.adapters.qs/qsa/heuristicRole/genericCollect）
 */
(function () {
  window.AIEXP = window.AIEXP || {};
  if (window.AIEXP.scraper) return;

  var A = window.AIEXP.adapters;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitFor(fn, timeout, interval) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function poll() {
        var ok = false;
        try { ok = fn(); } catch (e) { ok = false; }
        if (ok) return resolve(true);
        if (Date.now() - start >= (timeout || 8000)) return resolve(false);
        setTimeout(poll, interval || 150);
      })();
    });
  }

  /** 找最近的滚动容器 */
  function findScrollable(el) {
    if (!el) return null;
    var node = el;
    while (node && node !== document.body) {
      var style = getComputedStyle(node);
      if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 50) {
        return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement;
  }

  /**
   * 反复滚动直到内容数量稳定（虚拟滚动全量加载）
   * direction: 'up' 向上加载历史 / 'down' 向下加载
   */
  function scrollLoad(scrollEl, getCount, opts) {
    opts = opts || {};
    var timeout = opts.timeout || 12000;
    var interval = opts.interval || 280;
    var stableNeeded = opts.stableNeeded || 3;
    var direction = opts.direction || 'up';
    return new Promise(function (resolve) {
      if (!scrollEl || scrollEl.scrollHeight <= scrollEl.clientHeight + 20) {
        return resolve(getCount());
      }
      var last = getCount();
      var stable = 0;
      var start = Date.now();
      (function step() {
        if (Date.now() - start > timeout) return resolve(getCount());
        try {
          scrollEl.scrollTop = direction === 'up' ? 0 : scrollEl.scrollHeight;
        } catch (e) { /* ignore */ }
        setTimeout(function () {
          var c = getCount();
          if (c === last && c > 0) { stable++; } else { stable = 0; last = c; }
          if (stable >= stableNeeded) return resolve(c);
          step();
        }, interval);
      })();
    });
  }

  // ---------- 会话列表（DOM 路径） ----------
  function collectConversationsDOM(adapter) {
    var sel = adapter.selectors;
    var sidebar = A.qs(document, sel.sidebar) || document;
    var items = A.qsa(sidebar, sel.convItem);
    var out = [];
    var seen = new Set();
    items.forEach(function (el) {
      var titleEl = sel.convTitle ? A.qs(el, sel.convTitle) : null;
      var title = (titleEl ? titleEl.textContent : el.textContent || '').trim().replace(/\s+/g, ' ');
      if (!title || title.length > 200) return;
      var key = title + '|' + Array.prototype.indexOf.call(el.parentNode.children, el);
      if (seen.has(key)) return;
      seen.add(key);
      var link = el.tagName === 'A' ? el : A.qs(el, 'a[href]');
      out.push({
        id: link && link.getAttribute('href') ? link.getAttribute('href') : key,
        title: title,
        el: el,
        url: link && link.href ? link.href : null
      });
    });
    return out;
  }

  // ---------- 消息抽取（DOM 路径） ----------
  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return 'h' + (h >>> 0);
  }

  function cleanContentHtml(el) {
    var clone = el.cloneNode(true);
    // 去掉操作按钮等非内容元素（保留 svg，mermaid 图表依赖它）
    var junk = clone.querySelectorAll('button, [role="button"], [class*="copy-i"], [class*="action-bar"]');
    for (var i = 0; i < junk.length; i++) junk[i].remove();
    return clone.innerHTML;
  }

  function matchesAny(el, selectorList) {
    if (!el || !el.matches || !selectorList) return false;
    var list = Array.isArray(selectorList) ? selectorList : [selectorList];
    for (var i = 0; i < list.length; i++) {
      try { if (el.matches(list[i])) return true; } catch (e) { /* ignore */ }
    }
    return false;
  }

  /** 分层角色判定：adapter.parseRole → 自身/祖先选择器 → 后代选择器 → 启发式 */
  function roleOf(adapter, el, container) {
    if (typeof adapter.parseRole === 'function') {
      var r0 = adapter.parseRole(el);
      if (r0) return r0;
    }
    var sel = adapter.selectors;
    if (matchesAny(el, sel.userMsg)) return 'user';
    if (matchesAny(el, sel.asstMsg)) return 'assistant';
    var p = el;
    while (p && p !== document.body) {
      if (matchesAny(p, sel.userMsg)) return 'user';
      if (matchesAny(p, sel.asstMsg)) return 'assistant';
      p = p.parentElement;
    }
    // 后代含角色标记（消息行包裹内容区的结构）
    if (sel.userMsg && A.qs(el, sel.userMsg)) return 'user';
    if (sel.asstMsg && A.qs(el, sel.asstMsg)) return 'assistant';
    return A.heuristicRole(el, container);
  }

  function extractTurn(adapter, el, role, container) {
    var sel = adapter.selectors;
    var contentEl = null;
    if (role === 'user' && sel.userContent) contentEl = A.qs(el, sel.userContent);
    if (role === 'assistant' && sel.asstContent) contentEl = A.qs(el, sel.asstContent);
    if (!contentEl && sel.msgContent) contentEl = A.qs(el, sel.msgContent);
    contentEl = contentEl || el;

    var text = contentEl.textContent || '';
    if (!text.trim()) return null;

    var time = '';
    if (typeof adapter.parseTime === 'function') time = adapter.parseTime(el) || '';
    else if (sel.time) {
      var tEl = A.qs(el, sel.time);
      if (tEl) time = (tEl.getAttribute('datetime') || tEl.textContent || '').trim();
    }
    return {
      role: role,
      html: cleanContentHtml(contentEl),
      text: text.trim(),
      time: time
    };
  }

  function collectTurnsDOM(adapter) {
    var sel = adapter.selectors;
    var container = A.qs(document, sel.scrollArea) || document.body;
    var turns = [];
    var seen = new Set();

    function push(el, role) {
      var t = extractTurn(adapter, el, role, container);
      if (!t) return;
      var norm = t.text.replace(/\s+/g, '');
      var key = t.role + ':' + hashStr(norm.slice(0, 500));
      if (seen.has(key)) return;
      // 包含关系去重：同角色消息文本互为子串时（嵌套容器），保留更长的
      if (norm.length >= 8) {
        for (var i = 0; i < turns.length; i++) {
          var e = turns[i];
          if (e.role !== t.role) continue;
          var eNorm = e.norm;
          if (eNorm.length >= 8 && eNorm.indexOf(norm) >= 0 && norm.length < eNorm.length) return;
          if (eNorm.length >= 8 && norm.indexOf(eNorm) >= 0 && norm.length > eNorm.length) {
            turns.splice(i, 1);
            i--;
          }
        }
      }
      seen.add(key);
      t.norm = norm;
      turns.push(t);
    }

    // 路径 A：平台自定义收集器
    if (typeof adapter.collectMessages === 'function') {
      try {
        adapter.collectMessages().forEach(function (it) {
          if (it && it.el) push(it.el, it.role || roleOf(adapter, it.el, container));
        });
      } catch (e) {
        console.warn('[AIEXP] collectMessages 失败：', e);
      }
      if (turns.length) { turns.forEach(function (t) { delete t.norm; }); return turns; }
    }

    // 路径 B：选择器 + 分层角色判定
    var msgs = A.qsa(container, sel.msg);
    msgs.forEach(function (el) {
      var role = roleOf(adapter, el, container);
      if (role) push(el, role);
    });

    // 路径 C：通用兜底（选择器完全失灵时）
    if (!turns.length) {
      A.genericCollect().forEach(function (it) { push(it.el, it.role); });
    }

    turns.forEach(function (t) { delete t.norm; });
    return turns;
  }

  // ---------- 会话切换 ----------
  function currentCount(adapter) {
    var sel = adapter.selectors;
    var container = A.qs(document, sel.scrollArea) || document;
    return A.qsa(container, sel.msg).length;
  }

  function firstMsgText(adapter) {
    var sel = adapter.selectors;
    var container = A.qs(document, sel.scrollArea) || document;
    var el = A.qs(container, sel.msg);
    return el ? (el.textContent || '').slice(0, 200) : '';
  }

  async function activateConversation(adapter, conv) {
    var beforeHref = location.href;
    var beforeText = firstMsgText(adapter);
    var el = conv.el;
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
    await sleep(120);
    el.click();
    var ok = await waitFor(function () {
      return location.href !== beforeHref || firstMsgText(adapter) !== beforeText;
    }, 10000, 150);
    // 等消息数量稳定
    var last = -1, stable = 0;
    var start = Date.now();
    while (Date.now() - start < 6000) {
      await sleep(250);
      var c = currentCount(adapter);
      if (c === last && c > 0) { if (++stable >= 2) break; } else { stable = 0; last = c; }
    }
    return ok;
  }

  /** 滚动加载当前会话全部消息后抽取 */
  async function loadTurnsDOM(adapter) {
    var sel = adapter.selectors;
    var container = A.qs(document, sel.scrollArea) || document.body;
    var scrollEl = findScrollable(container);
    var count = function () { return currentCount(adapter); };

    await scrollLoad(scrollEl, count, { direction: 'up', timeout: 15000 });
    try { scrollEl.scrollTop = scrollEl.scrollHeight; } catch (e) { /* ignore */ }
    await sleep(400);
    await scrollLoad(scrollEl, count, { direction: 'down', timeout: 6000, stableNeeded: 2 });

    return collectTurnsDOM(adapter);
  }

  /**
   * 统一入口：加载某个会话的全部问答
   * 返回 [{role:'user'|'assistant', md:string, time:string}]
   */
  async function loadTurns(adapter, conv) {
    if (adapter.api && adapter.api.detail) {
      try {
        var turns = await adapter.api.detail(conv);
        if (turns && turns.length) return turns;
      } catch (e) {
        console.warn('[AIEXP] API 抓取失败，降级 DOM：', e);
      }
    }
    if (conv.el) await activateConversation(adapter, conv);
    var domTurns = await loadTurnsDOM(adapter);
    domTurns.forEach(function (t) {
      t.md = window.AIEXP.md.convert(t.html);
      delete t.html;
      delete t.text;
    });
    return domTurns;
  }

  /** 统一入口：收集会话列表 */
  async function listConversations(adapter) {
    if (adapter.api && adapter.api.list) {
      try {
        var list = await adapter.api.list();
        if (list && list.length) return list;
      } catch (e) {
        console.warn('[AIEXP] API 列表失败，降级 DOM：', e);
      }
    }
    var sel = adapter.selectors;
    var sidebar = A.qs(document, sel.sidebar);
    if (sidebar) {
      var scrollEl = findScrollable(sidebar);
      await scrollLoad(scrollEl, function () {
        return A.qsa(sidebar, sel.convItem).length;
      }, { direction: 'down', timeout: 8000 });
    }
    return collectConversationsDOM(adapter);
  }

  window.AIEXP.scraper = {
    sleep: sleep,
    waitFor: waitFor,
    findScrollable: findScrollable,
    scrollLoad: scrollLoad,
    collectConversationsDOM: collectConversationsDOM,
    collectTurnsDOM: collectTurnsDOM,
    activateConversation: activateConversation,
    loadTurnsDOM: loadTurnsDOM,
    loadTurns: loadTurns,
    listConversations: listConversations,
    currentCount: currentCount
  };
})();
