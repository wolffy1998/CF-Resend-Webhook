# CF Workers + Resend 邮件通知 Webhook

基于 **Cloudflare Workers** 和 **[Resend](https://resend.com)** 邮件服务构建的通知 Webhook。

API 设计参考 [Server酱（ServerChan）](https://sct.ftqq.com/) 的请求/响应风格，客户端只需携带 Token 发送 `title` 和 `desp` 即可触发邮件通知——Resend API Key 安全地存储在 Cloudflare Secret 中，客户端无需接触。

## 特性

- **Token 鉴权**：请求头 / URL 路径 / URL 查询参数三种方式携带 Token（Server酱风格），未授权请求返回 401
- **Server酱风格**：熟悉的 `title` / `desp` 参数、`<TOKEN>.send` 路径、`code` / `message` / `data` 响应
- **Markdown 支持**：邮件正文支持 Markdown 语法，自动转为精美 HTML 模板
- **多格式兼容**：GET 查询参数 / `application/json` / `application/x-www-form-urlencoded` / `text/plain`
- **CORS 友好**：支持浏览器跨域调用
- **免费部署**：CF Workers 免费额度 10 万次/天 + Resend 免费额度 3000 封/月

## 快速开始

### 1. 获取 Resend API Key

1. 注册 [Resend](https://resend.com) 账号
2. 进入 Dashboard → API Keys → Create API Key
3. 复制 API Key（格式：`re_xxxxxxxxxx`）
4. （可选）在 Resend 中验证你的自定义域名，否则只能使用 `onboarding@resend.dev` 发件

### 2. 部署到 Cloudflare Workers

1. Fork 或将本仓库推送到你的 GitHub
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
3. 进入 **Workers & Pages** → **Create** → **Import a repository**
4. 授权 Cloudflare 访问你的 GitHub 仓库
5. 选择本仓库，配置如下：

   | 配置项 | 值 |
   |---|---|
   | Project name | `resend-email-webhook` |
   | Production branch | `main` |
   | Build command | `npm install` |
   | Deploy command | `npx wrangler deploy` |

6. 点击 **Save and Deploy**
7. Cloudflare Dashboard 中配置环境变量（**重要，请先阅读下文"变量配置说明"**）：

   | 变量名 | 类型 | 配置位置 | 说明 |
   |---|---|---|---|
   | `RESEND_API_KEY` | Secret | Dashboard → Settings → Secrets | Resend API 密钥 |
   | `WEBHOOK_TOKEN` | Secret | Dashboard → Settings → Secrets | 访问令牌（必填，支持逗号分隔多个） |
   | `FROM_EMAIL` | Plain | Dashboard → Settings → Variables | 发件人地址（测试期用 `onboarding@resend.dev`，正式用已验证域名） |
   | `TO_EMAIL` | Plain | Dashboard → Settings → Variables | 默认收件人地址（测试期填 Resend 注册邮箱） |
   | `REPLY_TO` | Plain | 可选，Dashboard → Settings → Variables | 回复地址 |

8. 保存后自动重新部署，即可使用

## API 文档

### 请求

```
GET  https://resend-email-webhook.<你的子域>.workers.dev/<TOKEN>.send?title=xxx&desp=yyy
POST https://resend-email-webhook.<你的子域>.workers.dev/<TOKEN>.send
```

- **GET**：参数放在 URL 查询字符串（`title` / `desp` / `to`），与 Server酱的浏览器直接测试方式一致，适合简单场景
- **POST**：参数放在请求体（推荐），适合长内容，无 URL 长度限制

#### Token 鉴权（必带）

所有请求必须携带访问令牌 `WEBHOOK_TOKEN`（在 Dashboard → Settings → Secrets 中配置）。三种携带方式任选其一，与 Server酱风格一致：

| 方式 | 示例 |
|---|---|
| ① URL 路径（与 Server酱相同） | `https://xxx.workers.dev/<TOKEN>.send?title=...` |
| ② URL 查询参数 | `https://xxx.workers.dev/?token=<TOKEN>&title=...` |
| ③ 请求头（标准 Bearer） | `Authorization: Bearer <TOKEN>` |

> 💡 推荐方式 ①：和 Server酱的 `https://sctapi.ftqq.com/<SENDKEY>.send` 用法完全一致，GET/POST 通用，浏览器地址栏可直接测试。
> `WEBHOOK_TOKEN` 支持逗号分隔多个（如 `token1,token2`），可给不同客户端分配独立 Token。
> 未携带或 Token 错误时返回 `{"code":401,"message":"Unauthorized: invalid or missing token","data":{}}`。

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 是 | 邮件标题 |
| `desp` | string | 否 | 邮件正文，支持 Markdown |
| `to` | string | 否 | 收件人地址（多个用逗号分隔），不传则使用默认收件人 |

#### Content-Type 支持（POST）

- `application/json`
- `application/x-www-form-urlencoded`
- `multipart/form-data`
- `text/plain`（整段文本作为 title）

### 响应

#### 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "0a2b3c4d-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "to": "you@example.com",
    "from": "noreply@yourdomain.com",
    "subject": "测试邮件标题"
  }
}
```

#### 失败响应

```json
{
  "code": 400,
  "message": "Missing required parameter: title",
  "data": {
    "required": ["title"],
    "optional": ["desp", "to"]
  }
}
```

### 错误码说明

| code | HTTP Status | 说明 |
|---|---|---|
| 0 | 200 | 发送成功 |
| 401 | 401 | Token 缺失或错误（未携带 WEBHOOK_TOKEN / Token 不匹配） |
| 400 | 400 | 请求参数错误（缺少 title、收件人为空等） |
| 405 | 405 | 请求方法不允许（仅支持 GET 和 POST） |
| 500 | 500 | 服务端错误（密钥未配置、Resend API 异常等） |

## 使用示例

### cURL

```bash
# 方式①：路径式 GET（与 Server酱相同，浏览器地址栏也可直接访问）
curl "https://your-worker.workers.dev/<TOKEN>.send?title=测试&desp=Hello%20World"

# 方式③：请求头 + JSON（推荐，POST）
curl -X POST https://your-worker.workers.dev \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title":"服务器告警","desp":"CPU 使用率超过 **90%**\n\n- 主机: web-01\n- 时间: 2025-01-01 12:00:00"}'

# Form 格式
curl -X POST https://your-worker.workers.dev/<TOKEN>.send \
  -d 'title=构建完成' \
  -d 'desp=项目已成功部署到生产环境 ✅'

# 指定收件人
curl -X POST https://your-worker.workers.dev \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title":"测试","desp":"Hello","to":"another@example.com"}'
```

### Python

```python
import requests
import os

TOKEN = os.environ["WEBHOOK_TOKEN"]

resp = requests.post(
    "https://your-worker.workers.dev",
    headers={"Authorization": f"Bearer {TOKEN}"},
    json={
        "title": "构建完成通知",
        "desp": "## 部署详情\n\n- **项目**: my-app\n- **环境**: production\n- **状态**: ✅ 成功\n\n[查看日志](https://example.com/logs)"
    }
)
print(resp.json())
```

### JavaScript / Node.js

```javascript
const TOKEN = process.env.WEBHOOK_TOKEN;

fetch("https://your-worker.workers.dev", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    title: "新订单提醒",
    desp: "收到一笔新订单，金额 **¥999**\n\n请尽快处理。"
  })
})
.then(r => r.json())
.then(console.log);
```

### Shell 脚本（配合 cron 定时）

```bash
#!/bin/bash
# 每日日报提醒（Token 存入脚本环境变量）
curl -s -X POST https://your-worker.workers.dev \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"日报提醒\",\"desp\":\"请记得提交今日工作日报 📝\"}"
```

### GitHub Actions（CI/CD 通知）

```yaml
- name: Notify deploy result
  run: |
    curl -s -X POST https://your-worker.workers.dev \
      -H "Authorization: Bearer ${{ secrets.WEBHOOK_TOKEN }}" \
      -H "Content-Type: application/json" \
      -d "{\"title\":\"Deploy ${{ job.status }}\",\"desp\":\"Repo: ${{ github.repository }}\nCommit: ${{ github.sha }}\"}"
```

## Markdown 支持的语法

邮件正文（`desp` 参数）支持以下 Markdown 语法：

| 语法 | 效果 |
|---|---|
| `# 标题` ~ `###### 标题` | h1 ~ h6 |
| `**粗体**` | **粗体** |
| `*斜体*` | *斜体* |
| `~~删除线~~` | ~~删除线~~ |
| `` `行内代码` `` | `行内代码` |
| ` ```代码块``` ` | 代码块 |
| `[链接](url)` | 超链接 |
| `![图片](url)` | 图片 |
| `- 列表项` | 无序列表 |
| `1. 列表项` | 有序列表 |
| `> 引用` | 引用块 |
| `---` | 分割线 |

## 项目结构

```
CF-Resend-Webhook/
├── src/
│   └── index.js          # Worker 主代码
├── .dev.vars.example     # 本地测试环境变量模板
├── .gitignore
├── LICENSE               # MIT 许可证
├── package.json
├── wrangler.toml         # Cloudflare Workers 配置（keep_vars = true，变量在 Dashboard 配置）
└── README.md
```

## 安全说明

- **Token 鉴权**：所有请求必须携带 `WEBHOOK_TOKEN`（请求头 / URL 路径 / URL 查询参数三选一），未携带或错误返回 401。Token 存于 Cloudflare Secret，不出现在代码中。
- **多 Token 支持**：`WEBHOOK_TOKEN` 支持逗号分隔多个值，可给不同客户端分配独立 Token，便于单独吊销。
- **密钥安全**：Resend API Key 存储在 Cloudflare Workers 的 Secret 变量中，不会出现在代码或日志中。
- **Token 生成建议**：使用 `openssl rand -hex 32` 生成强随机 Token，并通过私密渠道分发给调用方。

## 免费额度

| 服务 | 免费额度 |
|---|---|
| Cloudflare Workers | 100,000 次请求/天 |
| Resend | 3,000 封邮件/月（100 封/天） |

## License

MIT License

