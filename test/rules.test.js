import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { createStore } from "../src/store.js";
import {
  createBatch,
  addObservation,
  reviewBatch,
  overview,
  HttpError
} from "../src/rules.js";

function tempStore() {
  const file = join(tmpdir(), `pf-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  return { store: createStore(file, { items: [] }), file };
}

async function expectHttp(fn, status, code) {
  await assert.rejects(fn, err => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}

const validObs = (over = {}) => ({
  temperature: "25.0", smell: "微酸正常", fiber: "松散", changedWater: "是", observer: "林素", ...over
});

test("缸位排他：同缸第二批复 409 且不落库；可抄纸后缸位释放", async () => {
  const { store, file } = tempStore();
  try {
    await store.update(createBatch({ code: "PF-T1", source: "构树皮", vat: "一号缸", owner: "林素" }));
    await expectHttp(
      () => store.update(createBatch({ code: "PF-T2", source: "竹浆", vat: "一号缸", owner: "阿青" })),
      409, "vat_conflicted"
    );
    let db = await store.read();
    assert.equal(db.items.length, 1, "冲突批次不得落库");

    // 重复编号同样 409
    await expectHttp(
      () => store.update(createBatch({ code: "PF-T1", source: "x", vat: "二号缸", owner: "y" })),
      409, "code_exists"
    );

    // 满 7 天正常观察后变可抄纸，缸位释放，可再进新批次
    for (let i = 0; i < 7; i++) {
      await store.update(addObservation("PF-T1", validObs()));
    }
    db = await store.read();
    assert.equal(db.items[0].status, "可抄纸");
    await store.update(createBatch({ code: "PF-T3", source: "竹浆", vat: "一号缸", owner: "阿青" }));
    db = await store.read();
    assert.equal(db.items.length, 2);
  } finally {
    rmSync(file, { force: true });
  }
});

test("建档/观察缺项返回 400 且不落库", async () => {
  const { store, file } = tempStore();
  try {
    await expectHttp(
      () => store.update(createBatch({ code: "", source: "x", vat: "缸", owner: "o" })),
      400, "missing_fields"
    );
    await store.update(createBatch({ code: "PF-V1", source: "构树皮", vat: "二号缸", owner: "林素" }));

    await expectHttp(
      () => store.update(addObservation("PF-V1", { smell: "正常", fiber: "松散", changedWater: "是", observer: "林素" })),
      400, "missing_fields"
    );
    const db = await store.read();
    assert.equal(db.items[0].observations.length, 0, "缺项观察不得保存");
  } finally {
    rmSync(file, { force: true });
  }
});

test("异常观察必须另一人复核，连续两次正常且换水才恢复发酵", async () => {
  const { store, file } = tempStore();
  try {
    await store.update(createBatch({ code: "PF-A1", source: "构树皮", vat: "三号缸", owner: "林素" }));

    // 出现异味 → 异常观察·待复核（上报观察人是阿竹，不是负责人）
    let item = (await store.update(addObservation("PF-A1", validObs({ odor: "是", observer: "阿竹" })))).item;
    assert.equal(item.status, "异常观察");
    assert.equal(item.reviewState, "pending");

    // 待复核期间不能登记普通观察
    await expectHttp(() => store.update(addObservation("PF-A1", validObs())), 400, "review_pending");

    // 负责人本人不能复核
    await expectHttp(
      () => store.update(reviewBatch("PF-A1", { reviewer: "林素", disposal: "翻缸换水" })),
      400, "reviewer_conflict"
    );
    // 上报本次异常的观察人也不能复核
    await expectHttp(
      () => store.update(reviewBatch("PF-A1", { reviewer: "阿竹", disposal: "翻缸换水" })),
      400, "reviewer_conflict"
    );

    // 另一人复核
    item = (await store.update(reviewBatch("PF-A1", { reviewer: "周师傅", disposal: "翻缸换水、剔除霉斑" }))).item;
    assert.equal(item.reviewState, "recovering");

    // 第一次正常且换水：1/2，仍在异常观察
    item = (await store.update(addObservation("PF-A1", validObs({ observer: "林素" })))).item;
    assert.equal(item.status, "异常观察");
    assert.equal(item.recoveryStreak, 1);

    // 第二次未换水：计数清零
    item = (await store.update(addObservation("PF-A1", validObs({ observer: "林素", changedWater: "否" })))).item;
    assert.equal(item.recoveryStreak, 0);
    assert.equal(item.status, "异常观察");

    // 再连续两次正常且换水 → 恢复发酵
    await store.update(addObservation("PF-A1", validObs({ observer: "林素" })));
    item = (await store.update(addObservation("PF-A1", validObs({ observer: "林素" })))).item;
    assert.equal(item.status, "发酵中");
    assert.equal(item.reviewState, "none");

    // 恢复期间再次出现霉点：回到待复核
    await store.update(addObservation("PF-A1", validObs({ mold: "是" })));
    const db = await store.read();
    assert.equal(db.items[0].status, "异常观察");
    assert.equal(db.items[0].reviewState, "pending");
  } finally {
    rmSync(file, { force: true });
  }
});

test("待复核批次不计入可抄纸进度；列表与统计同源一致", async () => {
  const { store, file } = tempStore();
  try {
    await store.update(createBatch({ code: "PF-S1", source: "构树皮", vat: "四号缸", owner: "林素" }));
    await store.update(createBatch({ code: "PF-S2", source: "桑皮", vat: "五号缸", owner: "阿青" }));

    // S1 满 7 天 → 可抄纸
    for (let i = 0; i < 7; i++) await store.update(addObservation("PF-S1", validObs()));
    // S2 第一次观察即报霉点 → 待复核
    await store.update(addObservation("PF-S2", validObs({ observer: "阿青", mold: "是" })));

    const data = overview(await store.read());
    assert.equal(data.items.length, 2);
    assert.equal(data.stats["可抄纸进度"], 1);
    assert.equal(data.stats["可抄纸"], 1);
    assert.equal(data.stats["异常观察·待复核"], 1);
    assert.equal(data.stats["异常观察·复核中恢复"], 0);
  } finally {
    rmSync(file, { force: true });
  }
});

test("可抄纸批次不再登记观察；不存在批次 404", async () => {
  const { store, file } = tempStore();
  try {
    await store.update(createBatch({ code: "PF-D1", source: "构树皮", vat: "六号缸", owner: "林素" }));
    for (let i = 0; i < 7; i++) await store.update(addObservation("PF-D1", validObs()));
    await expectHttp(() => store.update(addObservation("PF-D1", validObs())), 400, "status_not_observable");
    await expectHttp(() => store.update(addObservation("NOPE", validObs())), 404, "item_not_found");
  } finally {
    rmSync(file, { force: true });
  }
});
