/**
 * CF Workers + Resend 邮件通知 Webhook
 * 风格参考 Server酱 (ServerChan)
 *
 * 环境变量（在 Cloudflare Workers 设置中配置）：
 *   RESEND_API_KEY  - Resend API 密钥（必填，设为 Secret）
 *   FROM_EMAIL      - 发件人地址（必填，需在 Resend 中验证域名）
 *   TO_EMAIL        - 默认收件人地址（必填）
 *   REPLY_TO        - 回复地址（可选）
 *
 * 请求参数（POST body，支持 JSON / form-urlencoded）：
 *   title  - 邮件标题（必填）
 *   desp   - 邮件内容，支持纯文本 / Markdown（可选）
 *   to     - 收件人地址（可选，不传则使用 TO_EMAIL 环境变量）
 *
 * 响应格式（Server酱风格）：
 *   成功：{"code":0,"message":"success","data":{"id":"..."}}
 *   失败：{"code":<错误码>,"message":"<错误信息>","data":{}}
 */

// CORS 预检允许的来源，* 表示允许所有
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── Markdown → HTML 轻量转换 ───────────────────────────────
function markdownToHtml(md) {
  if (!md) return "";

  let html = md;

  // 转义 HTML 特殊字符（先处理代码块，避免被转义）
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      `<pre><code class="language-${lang}">${escHtml(code.trim())}</code></pre>`
    );
    return `\x00CODEBLOCK${idx}\x00`;
  });

  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escHtml(code)}</code>`);
    return `\x00INLINE${idx}\x00`;
  });

  // 转义剩余 HTML
  html = escHtml(html);

  // 标题
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // 粗体 & 斜体
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // 删除线
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // 链接 [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank">$1</a>'
  );

  // 图片 ![alt](url)
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" style="max-width:100%;" />'
  );

  // 无序列表
  html = html.replace(/(?:^|\n)((?:[-*+]\s+.+\n?)+)/g, (match) => {
    const items = match
      .trim()
      .split("\n")
      .map((l) => l.replace(/^[-*+]\s+/, ""))
      .map((l) => `  <li>${l}</li>`)
      .join("\n");
    return `\n<ul>\n${items}\n</ul>\n`;
  });

  // 有序列表
  html = html.replace(/(?:^|\n)((?:\d+\.\s+.+\n?)+)/g, (match) => {
    const items = match
      .trim()
      .split("\n")
      .map((l) => l.replace(/^\d+\.\s+/, ""))
      .map((l) => `  <li>${l}</li>`)
      .join("\n");
    return `\n<ol>\n${items}\n</ol>\n`;
  });

  // 引用
  html = html.replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>");

  // 分割线
  html = html.replace(/^---+$/gm, "<hr/>");

  // 段落 & 换行
  html = html
    .split(/\n\n+/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      // 如果块已经是块级元素，不再包 <p>
      if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|img|table)/.test(trimmed)) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");

  // 还原代码块
  codeBlocks.forEach((code, i) => {
    html = html.replace(`\x00CODEBLOCK${i}\x00`, code);
  });
  inlineCodes.forEach((code, i) => {
    html = html.replace(`\x00INLINE${i}\x00`, code);
  });

  return html;
}

function escHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── 邮件 HTML 模板 ─────────────────────────────────────────
function buildEmailHtml(title, desp) {
  const body = desp ? markdownToHtml(desp) : "<p>（无内容）</p>";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif;
      background: #f5f5f5;
      padding: 24px;
      color: #333;
      line-height: 1.7;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #fff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      padding: 24px 28px;
    }
    .header h1 { font-size: 20px; font-weight: 600; }
    .body { padding: 28px; }
    .body h1,.body h2,.body h3,.body h4,.body h5,.body h6 {
      margin: 16px 0 8px;
      color: #1a1a2e;
    }
    .body p { margin: 8px 0; }
    .body ul,.body ol { margin: 8px 0 8px 20px; }
    .body li { margin: 4px 0; }
    .body blockquote {
      border-left: 4px solid #667eea;
      margin: 12px 0;
      padding: 8px 16px;
      background: #f8f9ff;
      color: #555;
    }
    .body pre {
      background: #1e1e2e;
      color: #cdd6f4;
      border-radius: 8px;
      padding: 16px;
      overflow-x: auto;
      font-size: 13px;
      line-height: 1.5;
      margin: 12px 0;
    }
    .body code {
      background: #e8eaf6;
      color: #3a3a5c;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    }
    .body pre code { background: none; color: inherit; padding: 0; }
    .body img { border-radius: 8px; margin: 8px 0; }
    .body a { color: #667eea; text-decoration: none; }
    .body a:hover { text-decoration: underline; }
    .body hr { border: none; border-top: 1px solid #e0e0e0; margin: 16px 0; }
    .body table {
      border-collapse: collapse;
      width: 100%;
      margin: 12px 0;
    }
    .body th,.body td {
      border: 1px solid #e0e0e0;
      padding: 8px 12px;
      text-align: left;
    }
    .body th { background: #f5f5f5; font-weight: 600; }
    .footer {
      padding: 16px 28px;
      text-align: center;
      font-size: 12px;
      color: #aaa;
    }
    .footer a { color: #aaa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${escHtml(title)}</h1>
    </div>
    <div class="body">
      ${body}
    </div>
    <div class="footer">
      Powered by <a href="https://resend.com">Resend</a> &amp; <a href="https://workers.cloudflare.com">Cloudflare Workers</a>
    </div>
  </div>
</body>
</html>`;
}

// ─── 响应工具函数 ───────────────────────────────────────────
function jsonResponse(code, message, data = {}, status = 200) {
  const body = JSON.stringify({ code, message, data });
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

// ─── 解析请求参数 ───────────────────────────────────────────
async function parseParams(request) {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();

  // JSON
  if (contentType.includes("application/json")) {
    try {
      const body = await request.json();
      return { title: body.title, desp: body.desp ?? "", to: body.to || "" };
    } catch {
      return { error: "Invalid JSON body" };
    }
  }

  // form-urlencoded
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();
    return {
      title: formData.get("title"),
      desp: formData.get("desp") || "",
      to: formData.get("to") || "",
    };
  }

  // 纯文本
  if (contentType.includes("text/plain")) {
    const text = await request.text();
    return { title: text, desp: "", to: "" };
  }

  return { error: "Unsupported content type. Use JSON or form data." };
}

// ─── Worker 主入口 ─────────────────────────────────────────
export default {
  async fetch(request, env) {
    // CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 仅允许 POST
    if (request.method !== "POST") {
      return jsonResponse(
        405,
        "Method not allowed. This endpoint only accepts POST requests.",
        {},
        405
      );
    }

    // 解析参数
    const params = await parseParams(request);
    if (params.error) {
      return jsonResponse(400, params.error, {}, 400);
    }

    const { title, desp, to } = params;

    // 校验必填参数
    if (!title || !title.trim()) {
      return jsonResponse(
        400,
        "Missing required parameter: title",
        { required: ["title"], optional: ["desp", "to"] },
        400
      );
    }

    // 获取环境变量
    const RESEND_API_KEY = env.RESEND_API_KEY;
    const FROM_EMAIL = env.FROM_EMAIL;
    const DEFAULT_TO = env.TO_EMAIL || "";
    const REPLY_TO = env.REPLY_TO || "";

    if (!RESEND_API_KEY) {
      return jsonResponse(
        500,
        "Server misconfiguration: RESEND_API_KEY is not set.",
        {},
        500
      );
    }
    if (!FROM_EMAIL) {
      return jsonResponse(
        500,
        "Server misconfiguration: FROM_EMAIL is not set.",
        {},
        500
      );
    }

    // 确定收件人
    const recipient = (to && to.trim()) || DEFAULT_TO;
    if (!recipient) {
      return jsonResponse(
        400,
        "No recipient specified. Set TO_EMAIL env var or pass 'to' parameter.",
        {},
        400
      );
    }

    // 构建邮件内容
    const subject = String(title).slice(0, 500); // 限制标题长度
    const html = buildEmailHtml(String(title), String(desp || ""));

    // 调用 Resend API
    try {
      const emailPayload = {
        from: FROM_EMAIL,
        to: recipient.split(",").map((e) => e.trim()).filter(Boolean),
        subject,
        html,
      };

      if (REPLY_TO) {
        emailPayload.reply_to = REPLY_TO;
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      const data = await res.json();

      if (res.ok) {
        // Server酱风格成功响应
        return jsonResponse(
          0,
          "success",
          {
            id: data.id,
            to: recipient,
            from: FROM_EMAIL,
            subject,
          }
        );
      } else {
        // Resend 返回错误
        return jsonResponse(
          data.statusCode || 500,
          data.message || "Resend API error",
          { resend_error: data }
        );
      }
    } catch (err) {
      return jsonResponse(500, `Internal error: ${err.message}`, {});
    }
  },
};
