import http from "node:http";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./src/store.js";
import { createApp } from "./src/routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3039);
const dbPath = process.env.DB_PATH || join(__dirname, "data", "paper-pulp-fermentation.json");

// 记录存储（store.js）独立于请求入口（routes.js）与状态规则（rules.js）。
const store = createStore(dbPath);
const server = http.createServer(createApp(store));

server.listen(port, () => console.log("古法纸浆发酵记录 listening on http://localhost:" + port));
