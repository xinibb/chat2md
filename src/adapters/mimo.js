/*
 * 小米 MiMo
 * 域名：aistudio.xiaomimimo.com（实际对话界面，用户确认）+ mimo.mi.com（官网）
 * 对话界面需小米账号登录，结构未能匿名实测：
 * 宽松选择器 + 启发式角色判定 + 通用兜底收集。
 */
(function () {
  window.AIEXP = window.AIEXP || {};
  var A = window.AIEXP.adapters;

  A.register({
    id: 'mimo',
    name: '小米 MiMo',
    match: ['aistudio.xiaomimimo.com', 'mimo.mi.com'],
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
