const CSRF = { token: '' };

export const setCsrf = (token) => {
  CSRF.token = token || '';
};

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.message || payload?.error || `HTTP ${status}`);
    this.status = status;
    this.code = payload?.error || 'error';
  }
}

async function request(method, url, body, { form } = {}) {
  const headers = {};
  if (CSRF.token && method !== 'GET') headers['x-bw-csrf'] = CSRF.token;
  let payload;
  if (form) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(url, {
    method,
    headers,
    body: payload,
    credentials: 'same-origin',
  });

  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    if (!res.ok) throw new ApiError(res.status, { error: 'bad-gateway' });
    return res.text();
  }
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, file) => {
    const form = new FormData();
    form.append('file', file);
    return request('POST', url, form, { form: true });
  },
};

export const describeError = (err) => {
  if (err instanceof ApiError) {
    if (err.status === 401) return '此操作需先登录';
    if (err.status === 403) return err.message || '操作不被允许';
    if (err.status === 429) return err.message || '请求过于频繁，请稍候';
    if (err.status === 413) return err.message || '内容超出体积限制';
    if (err.status >= 500) return '服务暂时不可用';
    return err.message;
  }
  return '网络异常，请检查连接后重试';
};
