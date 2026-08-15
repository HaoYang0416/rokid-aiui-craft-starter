import wx from 'wx';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}
function parseResponseData(data) {
  if (typeof data !== 'string') {
    return data;
  }
  try {
    return JSON.parse(data);
  } catch (_) {
    return { message: data };
  }
}

export function saveEchoCapsule(options) {
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  if (!baseUrl) {
    return Promise.reject(new Error('尚未配置 Echo 保存服务地址'));
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}/api/echoes`,
      method: 'POST',
      timeout: options.timeout || 120000,
      dataType: 'json',
      responseType: 'text',
      header: {
        'content-type': 'application/json',
      },
      data: options.payload,
      success(response) {
        const body = parseResponseData(response.data);
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(body);
          return;
        }
        reject(new Error((body && body.error) || `保存服务返回 ${response.statusCode}`));
      },
      fail(error) {
        reject(new Error((error && error.errMsg) || '无法连接 Echo 保存服务'));
      },
    });
  });
}
