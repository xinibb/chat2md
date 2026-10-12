/*
 * 通义千问 (www.tongyi.com → www.qianwen.com)
 * DOM 抓取。选择器经真实浏览器实测校准（2026-10，匿名会话）：
 * - 滚动容器 #message-list-scroller
 * - 用户消息 [class*="message-select-wrapper-question"] → .question-text-card
 * - 助手消息 [class*="message-select-wrapper-answer"] → .answer-common-card
 * 注意：class 后缀为构建哈希，用前缀匹配；改版失效时自动走通用兜底。
 */
(function () {
  window.AIEXP = window.AIEXP || {};
  var A = window.AIEXP.adapters;

  A.register({
    id: 'qwen',
    name: '通义千问',
    match: ['tongyi.aliyun.com', 'www.tongyi.com', 'qianwen.com', 'www.qianwen.com'],
    selectors: {
      sidebar: '#qianwen-left-panel, #qianwen-layout-left-panel, [class*="sidebar"]',
      convItem: 'a[href*="/chat"], a[href*="session"], [class*="history-item"], [class*="session-item"], [class*="conversation-item"], [class*="recent-item"]',
      convTitle: '[class*="title"], span, div',
      scrollArea: '#message-list-scroller, .message-list-scroll-container, [class*="message-list"]',
      // 一轮含问+答两个 wrapper，msg 只匹配这两个，避免整轮被当成一条
      msg: '[class*="message-select-wrapper-question"], [class*="message-select-wrapper-answer"]',
      userMsg: '[class*="message-select-wrapper-question"], .message-card-wrap.question, [class*="chat-question"]',
      asstMsg: '[class*="message-select-wrapper-answer"], .answer-common-card, [class*="chat-answers"]',
      userContent: '.question-text-card, [class*="chat-question-card-wrap"]',
      asstContent: '.answer-common-card, [class*="chat-answers-card-wrap"]'
    }
  });
})();
