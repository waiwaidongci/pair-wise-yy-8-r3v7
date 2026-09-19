// 记录存储模块：负责纸浆发酵记录的加载、串行化修改与 JSON 持久化。
// 所有写操作经 update() 串行执行，保证缸位排他校验不会并发漏判。
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const WATER_TRUE = new Set(["是", "true", "1", "yes"]);

function seed() {
  return {
    items: [
      {
        id: randomUUID(),
        code: "PF-001",
        source: "构树皮",
        vat: "三号缸",
        days: 5,
        owner: "林素",
        status: "发酵中",
        reviewState: "none",
        recoveryStreak: 0,
        observations: [],
        reviews: [],
        logs: [
          { at: "2026-06-15", step: "建档", note: "林素登记入缸，缸位：三号缸" },
          { at: "2026-06-15", step: "观察", note: "温度24.6，气味微酸，纤维开始松散" }
        ]
      }
    ]
  };
}

// 兼容历史数据：补齐复核闭环所需字段。
function migrate(db) {
  let changed = false;
  for (const item of db.items || []) {
    if (!item.id) { item.id = randomUUID(); changed = true; }
    if (!item.reviewState) {
      item.reviewState = item.status === "异常观察" ? "pending" : "none";
      changed = true;
    }
    if (typeof item.recoveryStreak !== "number") { item.recoveryStreak = 0; changed = true; }
    for (const key of ["observations", "reviews", "logs"]) {
      if (!Array.isArray(item[key])) { item[key] = []; changed = true; }
    }
    for (const obs of item.observations) {
      if (typeof obs.changedWater !== "boolean") {
        obs.changedWater = WATER_TRUE.has(String(obs.changedWater ?? "").trim().toLowerCase());
        changed = true;
      }
      if (typeof obs.abnormal !== "boolean") {
        obs.abnormal = obs.abnormal === true || ["是", "有", "true", "1"].includes(String(obs.abnormal).trim().toLowerCase());
        changed = true;
      }
    }
  }
  return changed;
}

export function createStore(file, seedData = null) {
  let db = null;
  let chain = Promise.resolve();

  async function ensure() {
    if (db) return db;
    if (existsSync(file)) {
      db = JSON.parse(await readFile(file, "utf8"));
    } else {
      db = seedData ? JSON.parse(JSON.stringify(seedData)) : seed();
    }
    if (migrate(db)) await flush();
    return db;
  }

  async function flush() {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2));
    await rename(tmp, file);
  }

  return {
    path: file,
    async read() {
      return ensure();
    },
    // mutator 必须是同步函数：在串行队列里直接改内存库，成功后才落盘；
    // mutator 抛错（如 409/400）时本次不写入文件。
    async update(mutator) {
      await ensure();
      const run = chain.then(async () => {
        const result = mutator(db);
        await flush();
        return result;
      });
      chain = run.then(() => {}, () => {});
      return run;
    }
  };
}
