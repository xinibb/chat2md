/*
 * 平台适配器注册表 + 通用兜底工具
 * 新增平台只需：新建一个 adapter 文件调用 AIEXP.adapters.register({...})，
 * 并在 manifest.json 的 content_scripts.matches / host_permissions 中加入域名。
 */
(function () {
  window.AIEXP = window.AIEXP || {};

  var registry = [];

  function register(adapter) {
    // 基础校验，缺字段直接抛错，避免静默失败
    if (!adapter || !adapter.id || !adapter.name || !Array.isArray(adapter.match)) {
      throw new Error('[adapter] 注册失败：缺少 id/name/match 字段');
    }
    if (!adapter.selectors) adapter.selectors = {};
    registry.push(adapter);
  }

  /** 按 hostname 匹配当前平台 */
  function detect(hostname) {
    for (var i = 0; i < registry.length; i++) {
      var a = registry[i];
      for (var j = 0; j < a.match.length; j++) {
        var h = a.match[j];
        if (hostname === h || hostname.slice(-(h.length + 1)) === '.' + h) return a;
      }
    }
    return null;
  }

  /** 多组 fallback 选择器取第一个匹配元素 */
  function qs(root, selectorList) {
    if (!selectorList) return null;
    var list = Array.isArray(selectorList) ? selectorList : [selectorList];
    for (var i = 0; i < list.length; i++) {
      try {
        var el = root.querySelector(list[i]);
        if (el) return el;
      } catch (e) { /* 非法选择器跳过 */ }
    }
    return null;
  }

  /** 多组 fallback 选择器取全部匹配元素（并集去重） */
  function qsa(root, selectorList) {
    if (!selectorList) return [];
    var list = Array.isArray(selectorList) ? selectorList : [selectorList];
    var seen = new Set();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var els;
      try {
        els = root.querySelectorAll(list[i]);
      } catch (e) { continue; }
      for (var j = 0; j < els.length; j++) {
        if (!seen.has(els[j])) { seen.add(els[j]); out.push(els[j]); }
      }
    }
    return out;
  }

  function clsOf(el) {
    var c = el.className;
    if (!c) return '';
    return typeof c === 'string' ? c : (c.baseVal || '');
  }

  var USER_KW = ['user', 'human', 'question', 'query', 'ask', 'prompt', 'mine', 'me'];
  var ASST_KW = ['assistant', 'answer', 'response', 'reply', 'model', 'markdown', 'bot', 'robot', 'ai', 'gpt', 'claude', 'aibot'];

  /** 带边界的关键词匹配：避免 email 误配 ai、task 误配 ask */
  function kwMatch(cls, kws) {
    cls = String(cls || '').toLowerCase();
    for (var k = 0; k < kws.length; k++) {
      var kw = kws[k];
      var i = cls.indexOf(kw);
      while (i >= 0) {
        var before = i === 0 ? '-' : cls[i - 1];
        var after = i + kw.length >= cls.length ? '-' : cls[i + kw.length];
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
        i = cls.indexOf(kw, i + 1);
      }
    }
    return false;
  }

  /**
   * 启发式角色判定（选择器失灵时的兜底）：
   * 1. 祖先链 class 关键词  2. 自定义元素标签名  3. 布局（右对齐气泡 → 用户）
   */
  function heuristicRole(el, container) {
    var chain = [];
    var p = el;
    while (p && p !== document.body) { chain.push(p); p = p.parentElement; }
    var allCls = chain.map(clsOf).join(' ');
    if (kwMatch(allCls, USER_KW)) return 'user';
    if (kwMatch(allCls, ASST_KW)) return 'assistant';
    var tag = el.tagName.toLowerCase();
    if (/^(user-query|user|prompt|query)/.test(tag)) return 'user';
    if (/^(model-response|response|assistant|answer|bot)/.test(tag)) return 'assistant';
    try {
      var r = el.getBoundingClientRect();
      var cr = container.getBoundingClientRect();
      if (r.width > 0 && cr.width > 0) {
        if (r.right > cr.left + cr.width * 0.62) return 'user';
        if (r.left < cr.left + cr.width * 0.35) return 'assistant';
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * 通用消息收集器（结构完全未知的平台，如 MiMo）：
   * 找主滚动容器 → 收集含实质文本的块 → 去重 → 启发式分类
   */
  function genericCollect() {
    // 1. 找主滚动容器（文本量最大的可滚动元素）
    var best = null, bestScore = 0;
    var all = document.querySelectorAll('div, main, section, article');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var style = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
      if (el.scrollHeight <= el.clientHeight + 80) continue;
      var score = el.scrollHeight * (el.querySelectorAll('*').length + 1);
      if (score > bestScore) { bestScore = score; best = el; }
    }
    var container = best || document.body;

    // 2. 收集候选块（向下钻取，避免整轮对话被当成一个块）
    var candidates = [];
    var walk = function (node, depth) {
      for (var i = 0; i < node.children.length; i++) {
        var ch = node.children[i];
        if (ch.tagName === 'SCRIPT' || ch.tagName === 'STYLE') continue;
        var text = (ch.textContent || '').trim();
        var hasMedia = !!ch.querySelector('pre, img, table, mjx-container, .katex');
        if (text.length > 12 || hasMedia) {
          if (depth < 4 && ch.children.length > 1) {
            var sum = 0;
            for (var k = 0; k < ch.children.length; k++) {
              sum += (ch.children[k].textContent || '').trim().length;
            }
            if (sum > text.length * 0.72) { walk(ch, depth + 1); continue; }
          }
          candidates.push(ch);
        } else if (depth < 4) {
          walk(ch, depth + 1);
        }
      }
    };
    walk(container, 0);

    // 3. 去掉被更大候选块包含的
    var filtered = candidates.filter(function (el) {
      return !candidates.some(function (other) {
        return other !== el && other.contains(el) &&
          (other.textContent || '').trim().length > (el.textContent || '').trim().length * 1.6;
      });
    });

    // 4. 分类
    return filtered.map(function (el) {
      return { el: el, role: heuristicRole(el, container) };
    }).filter(function (x) { return !!x.role; });
  }

  window.AIEXP.adapters = {
    register: register,
    detect: detect,
    all: registry,
    qs: qs,
    qsa: qsa,
    heuristicRole: heuristicRole,
    genericCollect: genericCollect
  };
})();
