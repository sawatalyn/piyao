# 反代公共片段：保留真实来源、隐藏上游指纹
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Connection        "";
proxy_set_header Referrer-Policy   "strict-origin-when-cross-origin";

# 不把内部错误细节透给客户端
proxy_intercept_errors on;
proxy_hide_header X-Powered-By;
proxy_hide_header Server;

proxy_connect_timeout 5s;
proxy_send_timeout    30s;
proxy_read_timeout    30s;
proxy_buffering       on;
proxy_buffers         8 16k;
