/*
 * Markdown 转换引擎
 * - Turndown + GFM 插件
 * - 自定义规则：代码块（多源语言识别）、KaTeX / MathJax 公式还原 LaTeX、
 *   思考过程块、图片（懒加载/DataURI）
 */
(function () {
  window.AIEXP = window.AIEXP || {};
  if (window.AIEXP.md) return;

  // ---------- 工具 ----------
  function yamlSafe(s) {
    return String(s == null ? '' : s).replace(/"/g, '\\"').replace(/\n/g, ' ');
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function formatTime(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // 代码块语言识别：data-extracted-lang（预处理提取）/ code class / pre data-lang / pre class / 头部语言标签
  function codeBlockScope(pre) {
    var scope = null;
    try {
      scope = pre.closest('code-block, [class*="code-block"],[class*="codeBlock"],[class*="code_block"]');
    } catch (e) { /* ignore */ }
    return scope || null;
  }

  /** 找代码块的头部/语言栏元素（仅在代码块容器内或 pre 前一个兄弟，避免误删正文） */
  function findHeaderEl(pre) {
    var scope = codeBlockScope(pre);
    if (scope) {
      return scope.querySelector('[class*="lang"]') || scope.querySelector('[class*="header"]');
    }
    var sib = pre.previousElementSibling;
    if (sib && !sib.querySelector('pre')) {
      var cls = (sib.className || '').toString();
      if (/lang|header/i.test(cls)) return sib;
    }
    return null;
  }

  function extractLang(pre) {
    if (pre.dataset && pre.dataset.extractedLang) return pre.dataset.extractedLang;
    var code = pre.querySelector('code');
    if (code) {
      var m = (code.className || '').toString().match(/language-([\w+#.\-]+)/);
      if (m) return m[1].toLowerCase();
      m = (code.className || '').toString().match(/hljs\s+(\w+)/);
      if (m) return m[1].toLowerCase();
    }
    if (pre.dataset && pre.dataset.lang) return pre.dataset.lang.toLowerCase();
    var m2 = (pre.className || '').toString().match(/language-([\w+#.\-]+)/);
    if (m2) return m2[1].toLowerCase();
    // 代码块头部/语言标签（DeepSeek、Gemini 等）：允许 "Go 1.22" 形式，取首个语言词
    var header = findHeaderEl(pre);
    if (header) {
      var t = (header.textContent || '').trim();
      var tok = t.split(/\s+/)[0] || '';
      if (tok && tok.length <= 16 && /^[a-z0-9#+.\-]+$/i.test(tok)) return tok.toLowerCase();
    }
    return '';
  }

  /** 移除代码块头部语言栏（防止作为正文泄漏），返回识别到的语言 */
  function stripCodeHeader(pre) {
    var lang = extractLang(pre);
    try { pre.setAttribute('data-extracted-lang', lang || ''); } catch (e) { /* ignore */ }
    var scope = codeBlockScope(pre);
    var header = null;
    if (scope) header = scope.querySelector('[class*="lang"]') || scope.querySelector('[class*="header"]');
    else {
      var sib = pre.previousElementSibling;
      if (sib && !sib.querySelector('pre')) {
        var cls = (sib.className || '').toString();
        if (/lang|header/i.test(cls)) header = sib;
      }
    }
    if (!header || header === pre || header.contains(pre) || header.querySelector('pre')) return;
    var t = (header.textContent || '').trim();
    // 仅移除纯语言名头部（如 "Python"、"Go 1.22"），避免误删正文
    if (t.length && t.length <= 30 && /^[A-Za-z][A-Za-z0-9#+.\- ]*$/.test(t)) header.remove();
  }

  // ---------- Turndown 实例 ----------
  var service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined'
  });
  if (window.turndownPluginGfm && window.turndownPluginGfm.gfm) {
    service.use(window.turndownPluginGfm.gfm);
  }

  // 注意：turndown 的 addRule 是 unshift（后注册的先生效），
  // 因此 inline 规则先注册、display 规则后注册，保证 display 先匹配。

  // —— KaTeX 行内公式（.katex，排除 display 容器内的）——
  service.addRule('katexInline', {
    filter: function (node) {
      return node.nodeName === 'SPAN' &&
        /(^|\s)katex(\s|$)/.test(node.className || '') &&
        !node.closest('.katex-display');
    },
    replacement: function (content, node) {
      var ann = node.querySelector('annotation[encoding="application/x-tex"]');
      var tex = ann ? ann.textContent.trim() : '';
      return tex ? '$' + tex + '$' : content;
    }
  });

  // —— KaTeX 块级公式（.katex-display）——
  service.addRule('katexDisplay', {
    filter: function (node) {
      return node.nodeName === 'SPAN' && /(^|\s)katex-display(\s|$)/.test(node.className || '');
    },
    replacement: function (content, node) {
      var ann = node.querySelector('annotation[encoding="application/x-tex"]');
      var tex = ann ? ann.textContent.trim() : '';
      return tex ? '\n\n$$\n' + tex + '\n$$\n\n' : content;
    }
  });

  // —— MathJax v3 行内（mjx-container，注意浏览器中自定义元素 tagName 为小写）——
  service.addRule('mathjaxInline', {
    filter: function (node) {
      return node.nodeName.toUpperCase() === 'MJX-CONTAINER' && node.getAttribute('display') !== 'true';
    },
    replacement: function (content, node) {
      var ann = node.querySelector('annotation[encoding="application/x-tex"]');
      var tex = ann ? ann.textContent.trim() : '';
      return tex ? '$' + tex + '$' : content;
    }
  });

  // —— MathJax v3 块级 ——
  service.addRule('mathjaxDisplay', {
    filter: function (node) {
      return node.nodeName.toUpperCase() === 'MJX-CONTAINER' && node.getAttribute('display') === 'true';
    },
    replacement: function (content, node) {
      var ann = node.querySelector('annotation[encoding="application/x-tex"]');
      var tex = ann ? ann.textContent.trim() : '';
      return tex ? '\n\n$$\n' + tex + '\n$$\n\n' : content;
    }
  });

  // —— 源生 math/tex script（部分平台保留公式源码）——
  service.addRule('mathTexSpan', {
    filter: function (node) {
      return node.nodeName === 'SPAN' && node.hasAttribute('data-math-tex');
    },
    replacement: function (content, node) {
      var tex = node.getAttribute('data-math-tex') || '';
      return node.getAttribute('data-math-display')
        ? '\n\n$$\n' + tex + '\n$$\n\n'
        : '$' + tex + '$';
    }
  });

  // —— 代码块：统一处理语言识别（覆盖 GFM 默认规则）——
  service.addRule('codeBlock', {
    filter: function (node) { return node.nodeName === 'PRE'; },
    replacement: function (content, node) {
      var code = node.querySelector('code') || node;
      var lang = extractLang(node).replace(/[^\w+#.\-]/g, '');
      var text = (code.textContent || '').replace(/\n$/, '');
      return '\n\n```' + lang + '\n' + text + '\n```\n\n';
    }
  });

  // —— 思考过程块（DeepSeek R1 / Claude thinking）→ 引用块 ——
  service.addRule('thinkingBlock', {
    filter: function (node) {
      if (node.nodeName !== 'DIV' && node.nodeName !== 'DETAILS' && node.nodeName !== 'SECTION') return false;
      var cls = (node.className || '').toString();
      return /think|reason|thought/i.test(cls);
    },
    replacement: function (content, node) {
      if (!content || !content.trim()) return '';
      var quoted = content.trim().split('\n').map(function (l) { return '> ' + l; }).join('\n');
      return '\n\n> 🧠 **思考过程**\n>\n' + quoted + '\n\n';
    }
  });

  // —— 图片：兼容懒加载 data-src / srcset，保留 DataURI ——
  service.addRule('image', {
    filter: 'img',
    replacement: function (content, node) {
      var src = node.getAttribute('src') || node.getAttribute('data-src') || '';
      if (!src && node.getAttribute('srcset')) {
        src = node.getAttribute('srcset').split(/\s+/)[0];
      }
      if (!src) return '';
      var alt = (node.getAttribute('alt') || '').replace(/[[\]]/g, '');
      return '![' + alt + '](' + src + ')';
    }
  });

  // ---------- 预处理 ----------
  // math/tex 的 script 标签文本会被 turndown 丢弃，先转成带属性的 span
  // （必须同时设置 textContent，否则空节点会被 turndown 当 blank 跳过）
  function preprocess(root) {
    var scripts = root.querySelectorAll('script[type^="math/tex"]');
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      var type = s.getAttribute('type') || '';
      var tex = (s.textContent || '').trim();
      if (!tex) { s.remove(); continue; }
      var span = document.createElement('span');
      span.setAttribute('data-math-tex', tex);
      span.textContent = tex;
      if (/display/.test(type)) span.setAttribute('data-math-display', '1');
      s.parentNode && s.parentNode.replaceChild(span, s);
    }
    // 代码块：提取语言 + 移除头部语言栏
    var pres = root.querySelectorAll('pre');
    for (var j = 0; j < pres.length; j++) stripCodeHeader(pres[j]);
  }

  // 围栏代码块感知的空白清理（避免破坏代码块内空行）
  // 注意：不能去行尾空格——turndown 的 br 规则输出 "  \n" 硬换行，聊天多行消息依赖它
  function cleanup(md) {
    var parts = md.split(/(^```[^\n]*\n[\s\S]*?^```)/gm);
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        parts[i] = parts[i]
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          // 规范化列表标记间距（turndown 默认输出 "-   x"）
          .replace(/^(\s*)([-*+]|\d+\.)[ \t]{2,}/gm, '$1$2 ');
      }
    }
    return parts.join('').replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
  }

  // ---------- 对外 API ----------
  function convert(html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    preprocess(div);
    return cleanup(service.turndown(div));
  }

  /**
   * 组装最终 Markdown 文档
   * 单会话：opts = {title, url, turns:[{role, md, time}]}
   * 多会话合并：opts = {title, groups:[{title, url, turns:[...]}]}
   * turns: [{role:'user'|'assistant', md:'...', time:'2026-10-10 14:23'}]
   */
  function buildDoc(opts) {
    var now = new Date();
    var groups = opts.groups;
    var totalTurns = 0;
    if (groups) {
      groups.forEach(function (g) { totalTurns += (g.turns || []).length; });
    } else {
      totalTurns = (opts.turns || []).length;
    }

    var lines = [];
    lines.push('---');
    lines.push('title: "' + yamlSafe(opts.title) + '"');
    lines.push('source: "' + yamlSafe(opts.platformName) + '"');
    lines.push('exported_at: "' + now.toISOString() + '"');
    lines.push('turns: ' + totalTurns);
    if (groups) lines.push('conversations: ' + groups.length);
    if (opts.url) lines.push('url: "' + yamlSafe(opts.url) + '"');
    lines.push('---');
    lines.push('');
    lines.push('# ' + (opts.title || '未命名会话'));
    lines.push('');
    var srcLine = '> 📥 来源平台：' + (opts.platformName || '');
    if (opts.url) srcLine += ' · [原始对话链接](' + opts.url + ')';
    lines.push(srcLine);
    lines.push('> 🕒 导出时间：' + formatTime(now) + ' · 共 ' + totalTurns + ' 条问答' +
      (groups ? ' · ' + groups.length + ' 个会话' : ''));
    lines.push('');

    function emitTurns(turns) {
      var userIdx = 0, asstIdx = 0;
      turns.forEach(function (t, i) {
        var label, icon;
        if (t.role === 'user') { userIdx++; label = '提问 ' + userIdx; icon = '🧑'; }
        else { asstIdx++; label = '回答 ' + asstIdx; icon = '🤖'; }
        lines.push('## ' + icon + ' ' + label + (t.time ? ' · ' + t.time : ''));
        lines.push('');
        lines.push((t.md || '').trim());
        lines.push('');
        if (i < turns.length - 1) lines.push('---', '');
      });
    }

    if (groups) {
      groups.forEach(function (g, gi) {
        lines.push('## 🗂 会话 ' + (gi + 1) + '：' + (g.title || '未命名会话') +
          (g.url ? ' · [链接](' + g.url + ')' : ''));
        lines.push('');
        emitTurns(g.turns || []);
        if (gi < groups.length - 1) lines.push('---', '');
      });
    } else {
      emitTurns(opts.turns || []);
    }
    return lines.join('\n');
  }

  function safeFilename(name) {
    return String(name || 'export')
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || 'export';
  }

  /** 下载 md 文件（blob + a.click，附 BOM 防 Windows 记事本乱码；失败回退 background dataURL） */
  function download(md, filename) {
    return new Promise(function (resolve, reject) {
      var fallback = function () {
        try {
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_MD',
            content: md,
            filename: filename,
            saveAs: false
          }, function (resp) {
            if (resp && resp.ok) resolve();
            else reject(new Error((resp && resp.error) || 'download failed'));
          });
        } catch (e2) { reject(e2); }
      };
      try {
        var blob = new Blob(['\uFEFF' + md], { type: 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        // 浏览器一般即刻开始下载；此处不等待完成事件，直接视为成功
        resolve();
      } catch (e) { fallback(); }
    });
  }

  window.AIEXP.md = {
    service: service,
    convert: convert,
    buildDoc: buildDoc,
    download: download,
    safeFilename: safeFilename,
    formatTime: formatTime,
    yamlSafe: yamlSafe
  };
})();
