/*
 * 小米 MiMo (mimo.mi.com)
 * DOM 结构较新且可能频繁改版：宽松选择器 + 启发式角色判定 + 通用兜底收集。
 */
(function () {
  window.AIEXP = window.AIEXP || {};
  var A = window.AIEXP.adapters;

  A.register({
    id: 'mimo',
    name: '小米 MiMo',
    match: ['mimo.mi.com'],
    selectors: {
      sidebar: '[class*="sidebar"], [class*="history"], nav, aside',
      convItem: 'a[href*="/chat"], [class*="session"], [class*="history-item"], [class*="conversation"]',
      convTitle: '[class*="title"], span, div',
      scrollArea: 'main, [class*="chat"], [class*="conversation"], [class*="message"]',
      msg: '[class*="message"], [class*="msg"], [class*="bubble"], [class*="chat-item"], [class*="turn"]',
      userMsg: '[class*="user"], [class*="question"], [class*="ask"]',
      asstMsg: '[class*="assistant"], [class*="answer"], [class*="reply"], [class*="bot"], [class*="response"]',
      msgContent: '[class*="content"], [class*="markdown"], [class*="text"]'
    }
  });
})();
