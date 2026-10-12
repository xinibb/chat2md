// 后台 Service Worker：负责代理下载（data: URL 方式）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'DOWNLOAD_MD') {
    const url = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(msg.content);
    chrome.downloads.download(
      {
        url,
        filename: msg.filename,
        saveAs: !!msg.saveAs,
        conflictAction: 'uniquify'
      },
      (id) => {
        const err = chrome.runtime.lastError;
        sendResponse(err ? { ok: false, error: err.message } : { ok: true, id });
      }
    );
    return true; // 异步 sendResponse
  }
  if (msg && msg.type === 'GET_ADAPTERS') {
    sendResponse({ ok: true });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[AI对话导出助手] 已安装');
});
