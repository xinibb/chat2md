/*
 * Content Script 入口：平台识别 → 挂载面板
 */
(function () {
  window.AIEXP = window.AIEXP || {};

  function boot() {
    var adapter = window.AIEXP.adapters.detect(location.hostname);
    if (!adapter) return; // 非支持平台，静默退出
    if (document.getElementById('aiexp-host')) return; // 防止重复注入
    try {
      window.AIEXP.panel.init(adapter);
      console.log('[AI对话导出助手] 已就绪：' + adapter.name);
    } catch (e) {
      console.error('[AI对话导出助手] 初始化失败：', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
