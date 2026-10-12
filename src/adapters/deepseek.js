/*
 * DeepSeek (chat.deepseek.com)
 * DOM 抓取。助手正文以 ds-markdown 渲染；R1 思考过程类名含 think。
 * 选择器含多组 fallback；全部失效时自动走通用兜底收集 + 启发式角色判定。
 */
(function () {
  window.AIEXP = window.AIEXP || {};
  var A = window.AIEXP.adapters;

  A.register({
    id: 'deepseek',
    name: 'DeepSeek',
    match: ['chat.deepseek.com', 'chat.deepseek.org'],
    selectors: {
      sidebar: '[class*="session-list"], [class*="sidebar"], nav',
      convItem: 'a[href*="/a/chat"], [class*="session-item"], [class*="history-item"], [class*="conversation-item"]',
      convTitle: '[class*="title"], span, div',
      scrollArea: '[class*="chat-list"], [class*="message-list"], main, [class*="scroll"]',
      // 注意：不设 msgContent —— 助手消息行同时含思考块与正文，需整体转换
      msg: '[class*="ds-markdown"], [class*="ds-message"], [class*="user-message"], [class*="userMessage"], [class*="message-item"], [class*="chat-item"]',
      userMsg: '[class*="user-message"], [class*="userMessage"], [class*="question"]',
      asstMsg: '[class*="ds-markdown"], [class*="assistant"], [class*="answer"]'
    }
  });
})();
