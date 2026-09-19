// 记录存储模块：只负责 JSON 文件的读写，不包含任何业务规则。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.PULP_DB_PATH || join(__dirname, "..", "data", "paper-pulp-fermentation.json");

const seed = {
  items: [
    {
      id: "PF-001",
      code: "PF-001",
      source: "构树皮",
      vat: "三号缸",
      days: 0,
      owner: "林素",
      status: "入缸",
      normalStreak: 0,
      abnormalCase: null,
      logs: [
        { at: "2026-06-15T00:00:00.000Z", step: "建档", note: "创建纸浆批次（三号缸）" }
      ],
      observations: []
    }
  ]
};

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  db.items ||= [];
  return db;
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

// 单次请求内读取-修改-写回，保证列表与统计来自同一份数据。
async function mutate(fn) {
  const db = await loadDb();
  const result = await fn(db);
  await saveDb(db);
  return result;
}

async function readAll() {
  const db = await loadDb();
  return db.items;
}

export const store = { dbPath, loadDb, saveDb, mutate, readAll };
