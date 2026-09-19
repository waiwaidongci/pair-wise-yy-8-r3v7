// 请求入口模块：只负责 HTTP 解析、分发与响应；业务规则全部来自 rules.js。
import {
  HttpError,
  createBatch,
  addObservation,
  reviewBatch,
  summarize,
  overview
} from "./rules.js";
import { renderPage } from "./page.js";

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(400, "payload_too_large", "请求体过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "请求体不是合法 JSON");
  }
}

// 列表与统计同源：一个快照同时返回，保证两处始终一致（刷新后也一致）。
export function createApp(store) {
  return async function app(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const { pathname } = url;

      if (req.method === "GET" && pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(renderPage());
      }

      // 建档：缸位冲突/编号冲突 → 409，store 保证不落库
      if (req.method === "POST" && pathname === "/api/batches") {
        const input = await readJson(req);
        const item = await store.update(createBatch(input));
        return send(res, 201, summarize(item));
      }

      // 每日观察：缺项 → 400 不落库；异味/霉点转异常观察
      const obsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/observations$/);
      if (obsMatch && req.method === "POST") {
        const input = await readJson(req);
        const { item } = await store.update(addObservation(decodeURIComponent(obsMatch[1]), input));
        return send(res, 201, summarize(item));
      }

      // 异常复核：另一人填写处置
      const reviewMatch = pathname.match(/^\/api\/batches\/([^/]+)\/reviews$/);
      if (reviewMatch && req.method === "POST") {
        const input = await readJson(req);
        const { item } = await store.update(reviewBatch(decodeURIComponent(reviewMatch[1]), input));
        return send(res, 201, summarize(item));
      }

      // 列表 + 统计单一数据源
      if (req.method === "GET" && (pathname === "/api/batches" || pathname === "/api/items")) {
        const db = await store.read();
        return send(res, 200, db.items.map(summarize));
      }
      if (req.method === "GET" && pathname === "/api/overview") {
        return send(res, 200, overview(await store.read()));
      }
      if (req.method === "GET" && pathname === "/api/stats") {
        const db = await store.read();
        const { stats } = overview(db);
        return send(res, 200, stats);
      }

      return send(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof HttpError) {
        return send(res, error.status, {
          error: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        });
      }
      return send(res, 500, { error: "internal_error", message: error.message });
    }
  };
}
