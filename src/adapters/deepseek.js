/*
 * DeepSeek (chat.deepseek.com)
 * DOM 抓取。助手正文以 ds-markdown / ds-markdown--block 渲染；R1 思考过程类名含 think。
 *
 * 选择器来源（2026-10 调研公开抓取项目 + 语义化兜底）：
 * - 侧边栏面板 .b8812f16，虚拟列表容器 ._77cdc67._8a693f3，会话项 ._546d736
 *   （hash class 随部署变化，故同时保留语义化 fallback）
 * - 历史会话链接 .chat-history-item a / [data-testid="chat-history"] a
 * - 用户消息 .user-message / [data-author="user"]；助手消息 .ds-message
 * - 消息滚动容器 .dad65929
 * 全部失效时自动走通用兜底收集 + 启发式角色判定。
 */
(function () {
  window.AIEXP = window.AIEXP || {};
  var A = window.AIEXP.adapters;

  A.register({
    id: 'deepseek',
    name: 'DeepSeek',
    match: ['chat.deepseek.com', 'chat.deepseek.org'],
    selectors: {
      sidebar: '.b8812f16, ._3586175, ._6d215eb, [class*="session-list"], [class*="sidebar"], nav',
      convItem: '._546d736, .chat-history-item, [data-testid="chat-history"] a, .chat-history-item a, a[href*="/a/chat"], [class*="session-item"], [class*="conversation-item"]',
      convTitle: '.title, .chat-title, [class*="title"], span, div',
      scrollArea: '.dad65929, [class*="chat-list"], [class*="message-list"], main',
      // 注意：不设 msgContent —— 助手消息行同时含思考块与正文，需整体转换
      msg: '.ds-message, .user-message, [data-author="user"], [class*="ds-message"], [class*="user-message"], [class*="message-item"]',
      userMsg: '.user-message, [data-author="user"], ._9663006, [class*="user-message"]',
      asstMsg: '[class*="ds-markdown"], ._4f9bf79, ._43c05b5, [class*="assistant"], [class*="answer"]'
    }
  });
})();
