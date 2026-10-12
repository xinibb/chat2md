/*
 * Gemini (gemini.google.com)
 * DOM 抓取。user-query / model-response 自定义元素 + MathJax 公式。
 * 注意：选择器基于公开结构信息编写，若平台改版失效会自动走通用兜底收集。
 */
(function () {
  window.AIEXP = window.AIEXP || {};
  var A = window.AIEXP.adapters;

  A.register({
    id: 'gemini',
    name: 'Gemini',
    match: ['gemini.google.com'],
    selectors: {
      sidebar: 'nav, [class*="history"], [class*="sidebar"]',
      convItem: 'a[href*="/app/"], [class*="conversation-title"], [role="option"]',
      convTitle: '[class*="title"], span',
      scrollArea: 'main, [class*="conversation-container"], [class*="chat"]',
      msg: 'user-query, model-response',
      userMsg: 'user-query',
      asstMsg: 'model-response',
      userContent: '.query-text, [class*="query-text"]',
      asstContent: '.markdown, .markdown-main-panel, [class*="markdown"]'
    }
  });
})();
