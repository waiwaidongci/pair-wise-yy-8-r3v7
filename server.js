// 请求入口模块：HTTP 路由与报文处理，业务规则见 src/rules.js，存储见 src/store.js。
import http from "node:http";
import { store } from "./src/store.js";
import {
  RuleError, STATUSES, summarize, computeStats,
  prepareCreate, createItem, addObservation, reviewAbnormal, addLog, patchItem
} from "./src/rules.js";
import { renderPage } from "./src/page.js";

const port = Number(process.env.PORT || 3039);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RuleError("bad_json", "请求体不是合法 JSON", { http: 400 });
  }
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    if (req.method === "GET" && p === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPage());
    }

    if (req.method === "GET" && p === "/api/statuses") {
      return send(res, 200, { statuses: STATUSES });
    }
    if (req.method === "GET" && p === "/api/items") {
      const items = await store.readAll();
      return send(res, 200, items.map(summarize));
    }
    if (req.method === "GET" && p === "/api/stats") {
      const items = await store.readAll();
      return send(res, 200, computeStats(items));
    }

    if (req.method === "POST" && p === "/api/items") {
      const input = await body(req);
      const item = await store.mutate(db => {
        const fields = prepareCreate(input, { genId: () => "PF-" + Date.now() });
        const created = createItem(db.items, fields);
        db.items.unshift(created);
        return created;
      });
      return send(res, 201, summarize(item));
    }

    const obs = p.match(/^\/api\/items\/([^/]+)\/observations$/);
    if (obs && req.method === "POST") {
      const input = await body(req);
      const item = await store.mutate(db => addObservation(db.items, decodeURIComponent(obs[1]), input));
      return send(res, 201, summarize(item));
    }
    const review = p.match(/^\/api\/items\/([^/]+)\/review$/);
    if (review && req.method === "POST") {
      const input = await body(req);
      const item = await store.mutate(db => reviewAbnormal(db.items, decodeURIComponent(review[1]), input));
      return send(res, 201, summarize(item));
    }
    const logs = p.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (logs && req.method === "POST") {
      const input = await body(req);
      const item = await store.mutate(db => addLog(db.items, decodeURIComponent(logs[1]), input));
      return send(res, 201, summarize(item));
    }
    const one = p.match(/^\/api\/items\/([^/]+)$/);
    if (one && req.method === "PATCH") {
      const input = await body(req);
      const item = await store.mutate(db => patchItem(db.items, decodeURIComponent(one[1]), input));
      return send(res, 200, summarize(item));
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof RuleError) {
      return send(res, error.http || 400, { error: error.code, code: error.code, message: error.message });
    }
    return send(res, 500, { error: "internal_error", message: error.message });
  }
});

server.listen(port, () => console.log("古法纸浆发酵记录 listening on http://localhost:" + port));
