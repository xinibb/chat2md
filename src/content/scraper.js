/*
 * 抓取层：会话列表收集、虚拟滚动全量加载、消息抽取、会话切换
 * 依赖：src/adapters/index.js（AIEXP.adapters.qs/qsa/heuristicRole/genericCollect）
 *
 * 虚拟列表策略（DeepSeek 等平台的侧边栏/消息区会回收 DOM）：
 *   阶段1 反复跳滚到底/顶，直到无新内容（触发懒加载 + 到达边界）
 *   阶段2 回到起点小步向下滚，边滚边按文档顺序收集（应对 DOM 回收）
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

  function isScrollable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    var style;
    try { style = getComputedStyle(el); } catch (e) { return false; }
    return /(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 20;
  }

  /** 向上找滚动容器（消息区：滚动容器通常是消息区的祖先或自身） */
  function findScrollable(el) {
    if (!el) return null;
    var node = el;
    while (node && node !== document.body) {
      if (isScrollable(node)) return node;
      node = node.parentElement;
    }
    return isScrollable(document.scrollingElement) ? document.scrollingElement : null;
  }

  /** 向下找滚动容器（侧边栏：滚动的是列表容器自身） */
  function findScrollableInside(root) {
    if (!root) return null;
    if (isScrollable(root)) return root;
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (isScrollable(all[i])) return all[i];
    }
    return null;
  }

  /**
   * 反复滚动直到内容数量稳定
   * mode: 'jump-top' | 'jump-bottom' | 'step-down' | 'step-up'
   * getCount 返回「唯一内容数」（虚拟列表下 DOM 数量恒定，必须按内容计数）
   */
  function scrollLoad(scrollEl, getCount, opts) {
    opts = opts || {};
    var timeout = opts.timeout || 12000;
    var interval = opts.interval || 280;
    var stableNeeded = opts.stableNeeded || 3;
    var mode = opts.mode || 'jump-top';
    return new Promise(function (resolve) {
      if (!scrollEl || scrollEl.scrollHeight <= scrollEl.clientHeight + 20) {
        return resolve(getCount());
      }
      var last = getCount();
      var stable = 0;
      var start = Date.now();
      var stepPx = Math.max(200, scrollEl.clientHeight * 0.8);
      (function step() {
        if (Date.now() - start > timeout) return resolve(getCount());
        try {
          if (mode === 'jump-top') scrollEl.scrollTop = 0;
          else if (mode === 'jump-bottom') scrollEl.scrollTop = scrollEl.scrollHeight;
          else if (mode === 'step-down') scrollEl.scrollTop = Math.min(scrollEl.scrollHeight, scrollEl.scrollTop + stepPx);
          else if (mode === 'step-up') scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - stepPx);
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

  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return 'h' + (h >>> 0);
  }

  // ---------- 会话列表 ----------
  function itemTitle(el, sel) {
    var titleEl = sel.convTitle ? A.qs(el, sel.convTitle) : null;
    return (titleEl ? titleEl.textContent : el.textContent || '').trim().replace(/\s+/g, ' ');
  }

  /** 当前 DOM 窗口内的会话项（非虚拟列表可直接用） */
  function collectConversationsDOM(adapter) {
    var sel = adapter.selectors;
    var sidebar = A.qs(document, sel.sidebar) || document;
    var items = A.qsa(sidebar, sel.convItem);
    var out = [];
    var seen = new Set();
    items.forEach(function (el) {
      var title = itemTitle(el, sel);
      if (!title || title.length > 200) return;
      var link = el.tagName === 'A' ? el : A.qs(el, 'a[href]');
      var url = link && link.href ? link.href : null;
      var key = url || (title + '|' + Array.prototype.indexOf.call(el.parentNode.children, el));
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: key, title: title, el: el, url: url });
    });
    return out;
  }

  /** 侧边栏通用兜底：选择器全失效时，收集侧边栏内短文本可点击项 */
  function collectConversationsGeneric(sidebarRoot) {
    var out = [];
    var seen = new Set();
    var candidates = A.qsa(sidebarRoot, 'a[href], [role="button"], [class*="item"], li');
    candidates.forEach(function (el) {
      var t = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (!t || t.length < 2 || t.length > 120) return;
      // 过滤功能菜单项
      if (/^(新对话|新聊天|新建|设置|登录|退出登录|更多|首页|模型|价格|联系我们|研究|动态|中文|EN|升级|订阅|去订阅|立即创建|立即登录|解锁|开启|更新|返回|取消|确认|删除|重命名)/.test(t)) return;
      // 只保留最内层候选（祖孙文本相同）
      var hasInnerSame = Array.prototype.some.call(
        el.querySelectorAll('a[href], [role="button"], [class*="item"], li'),
        function (c) { return (c.textContent || '').trim().replace(/\s+/g, ' ') === t; }
      );
      if (hasInnerSame) return;
      var link = el.tagName === 'A' ? el : A.qs(el, 'a[href]');
      var url = link && link.href ? link.href : null;
      var key = url || t;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: key, title: t, url: url, el: null });
    });
    return out;
  }

  /**
   * 完整会话列表加载（虚拟列表安全）：
   * 阶段1 滚到底触发懒加载 → 阶段2 回顶部小步下滚按序收集
   */
  async function loadConversationList(adapter) {
    var sel = adapter.selectors;
    var sidebar = A.qs(document, sel.sidebar) || document;
    var scrollEl = findScrollableInside(sidebar);

    // 阶段1：反复滚到底，直到无新标题（触发懒加载 + 到达末尾）
    var seenTitles = new Set();
    var countTitles = function () {
      A.qsa(sidebar, sel.convItem).forEach(function (el) {
        var t = itemTitle(el, sel);
        if (t && t.length <= 200) seenTitles.add(t.slice(0, 80));
      });
      return seenTitles.size;
    };
    if (scrollEl) {
      await scrollLoad(scrollEl, countTitles, { mode: 'jump-bottom', timeout: 12000 });
    } else {
      countTitles();
    }

    // 阶段2：回顶部，小步下滚按序收集（DOM 回收安全）
    if (scrollEl) { try { scrollEl.scrollTop = 0; } catch (e) { /* ignore */ } }
    await sleep(400);
    var out = [];
    var outSeen = new Set();
    var collect = function () {
      A.qsa(sidebar, sel.convItem).forEach(function (el) {
        var title = itemTitle(el, sel);
        if (!title || title.length > 200) return;
        var link = el.tagName === 'A' ? el : A.qs(el, 'a[href]');
        var url = link && link.href ? link.href : null;
        var key = url || ('t:' + title);
        if (outSeen.has(key)) return;
        outSeen.add(key);
        out.push({ id: key, title: title, url: url, el: null });
      });
      return out.length;
    };
    collect();
    if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight + 20) {
      await scrollLoad(scrollEl, collect, { mode: 'step-down', timeout: 15000, interval: 300 });
    }

    // 阶段3：选择器完全失效 → 侧边栏通用兜底
    if (!out.length) {
      out = collectConversationsGeneric(sidebar);
    }
    return out;
  }

  // ---------- 消息抽取（DOM 路径） ----------
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
    return { role: role, html: cleanContentHtml(contentEl), text: text.trim(), time: time };
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

  /** 虚拟列表安全：按标题在侧边栏中定位会话元素（边滚边找） */
  async function findConvElement(adapter, conv) {
    var sel = adapter.selectors;
    var sidebar = A.qs(document, sel.sidebar) || document;
    var scrollEl = findScrollableInside(sidebar);
    var target = (conv.title || '').trim();
    var match = function (el) {
      var t = itemTitle(el, sel);
      if (!t || !target) return false;
      return t === target || (t.length > 3 && target.indexOf(t) >= 0) || (target.length > 3 && t.indexOf(target) >= 0);
    };
    if (scrollEl) { try { scrollEl.scrollTop = 0; } catch (e) { /* ignore */ } }
    await sleep(300);
    var deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      var items = A.qsa(sidebar, sel.convItem);
      for (var i = 0; i < items.length; i++) {
        if (match(items[i])) return items[i];
      }
      if (!scrollEl) break;
      var before = scrollEl.scrollTop;
      scrollEl.scrollTop = Math.min(scrollEl.scrollHeight, scrollEl.scrollTop + Math.max(200, scrollEl.clientHeight * 0.8));
      await sleep(250);
      if (scrollEl.scrollTop === before) break; // 已到底
    }
    return null;
  }

  async function activateConversation(adapter, conv) {
    var beforeHref = location.href;
    var beforeText = firstMsgText(adapter);
    var el = conv.el || await findConvElement(adapter, conv);
    if (!el && conv.url) {
      // 兜底：直接跳转会话 URL
      location.href = conv.url;
      await waitFor(function () {
        return location.href !== beforeHref || firstMsgText(adapter) !== beforeText;
      }, 10000, 150);
      await waitForCountStable(adapter);
      return true;
    }
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
    await sleep(120);
    el.click();
    var ok = await waitFor(function () {
      return location.href !== beforeHref || firstMsgText(adapter) !== beforeText;
    }, 10000, 150);
    await waitForCountStable(adapter);
    return ok;
  }

  async function waitForCountStable(adapter) {
    var last = -1, stable = 0;
    var start = Date.now();
    while (Date.now() - start < 6000) {
      await sleep(250);
      var c = currentCount(adapter);
      if (c === last && c > 0) { if (++stable >= 2) break; } else { stable = 0; last = c; }
    }
  }

  /**
   * 滚动加载当前会话全部消息（虚拟列表安全）：
   * 阶段1 向上滚到顶（加载全部历史）→ 阶段2 自上而下按序收集
   */
  async function loadTurnsDOM(adapter) {
    var sel = adapter.selectors;
    var container = A.qs(document, sel.scrollArea) || document.body;
    var scrollEl = findScrollable(container);

    var acc = [];
    var accSeen = new Set();
    var collectInto = function () {
      collectTurnsDOM(adapter).forEach(function (t) {
        var key = t.role + ':' + hashStr((t.text || '').replace(/\s+/g, '').slice(0, 300));
        if (!accSeen.has(key)) { accSeen.add(key); acc.push(t); }
      });
      return acc.length;
    };

    // 阶段1：向上滚到顶，直到无新内容（触发历史懒加载）
    if (scrollEl) {
      await scrollLoad(scrollEl, collectInto, { mode: 'jump-top', timeout: 20000 });
    } else {
      collectInto();
    }

    // 阶段2：丢弃阶段1的无序收集，自顶向下按文档顺序重新收集
    acc.length = 0;
    accSeen.clear();
    collectInto();
    if (scrollEl) {
      await scrollLoad(scrollEl, collectInto, { mode: 'step-down', timeout: 30000, interval: 300 });
      // 滚到底，确保最后几条渲染
      try { scrollEl.scrollTop = scrollEl.scrollHeight; } catch (e) { /* ignore */ }
      await sleep(400);
      collectInto();
    }
    return acc;
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
    if (conv.el || conv.url || conv.title) await activateConversation(adapter, conv);
    var domTurns = await loadTurnsDOM(adapter);
    domTurns.forEach(function (t) {
      t.md = window.AIEXP.md.convert(t.html);
      delete t.html;
      delete t.text;
      delete t.norm;
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
    return loadConversationList(adapter);
  }

  window.AIEXP.scraper = {
    sleep: sleep,
    waitFor: waitFor,
    isScrollable: isScrollable,
    findScrollable: findScrollable,
    findScrollableInside: findScrollableInside,
    scrollLoad: scrollLoad,
    collectConversationsDOM: collectConversationsDOM,
    collectConversationsGeneric: collectConversationsGeneric,
    loadConversationList: loadConversationList,
    collectTurnsDOM: collectTurnsDOM,
    findConvElement: findConvElement,
    activateConversation: activateConversation,
    loadTurnsDOM: loadTurnsDOM,
    loadTurns: loadTurns,
    listConversations: listConversations,
    currentCount: currentCount
  };
})();
