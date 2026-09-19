// 状态规则模块：缸位排他、观察校验、异常复核闭环、状态流转与统计口径。
// 所有规则集中在此处，HTTP 层与存储层都不重复实现。

export const STATUS = {
  ENTERED: "入缸",
  FERMENTING: "发酵中",
  READY: "可抄纸",
  ABNORMAL: "异常观察"
};
export const STATUSES = [STATUS.ENTERED, STATUS.FERMENTING, STATUS.READY, STATUS.ABNORMAL];
export const READY_DAYS = 7; // 累计发酵满 7 天方可抄纸
export const RECOVER_STREAK = 2; // 恢复发酵所需的连续正常且换水次数

// 需要占用缸位的状态（可抄纸后缸位释放，可投入下一批）。
export function occupiesVat(item) {
  return item.status === STATUS.ENTERED || item.status === STATUS.FERMENTING || item.status === STATUS.ABNORMAL;
}
export function isPendingReview(item) {
  return item.status === STATUS.ABNORMAL && Boolean(item.abnormalCase && item.abnormalCase.review === null);
}

export class RuleError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "RuleError";
    this.code = code;
    Object.assign(this, extra);
  }
}

const text = value => String(value ?? "").trim();
export function asChangedWater(value) {
  return ["是", "true", "1", "yes", "y", "已换水", "已换"].includes(text(value).toLowerCase());
}
// 异味或霉点：表单显式勾选，或文本中包含“有/异味/霉”等肯定表述。
export function asAbnormal(value) {
  const v = text(value);
  if (v === "") return false;
  if (["是", "true", "1", "yes", "y", "有"].includes(v.toLowerCase())) return true;
  if (["否", "false", "0", "no", "n", "无", "正常"].includes(v.toLowerCase())) return false;
  return /异味|霉|臭|酸败/.test(v);
}

function findItem(items, idOrCode) {
  const item = items.find(x => x.id === idOrCode || x.code === idOrCode);
  if (!item) throw new RuleError("item_not_found", "未找到该纸浆批次", { http: 404 });
  return item;
}
const today = () => new Date().toISOString().slice(0, 10);

// ---------- 建档：缸位排他 ----------
export function prepareCreate(input, { genId }) {
  const code = text(input.code);
  const vat = text(input.vat);
  const source = text(input.source);
  const owner = text(input.owner);
  const days = Math.max(0, Number(input.days) || 0);
  if (!code || !vat || !source || !owner) {
    throw new RuleError("missing_fields", "批次编号、原料来源、浸泡缸、负责人均为必填");
  }
  return { code, vat, source, owner, days, genId };
}

export function createItem(items, fields) {
  if (items.some(x => x.code === fields.code)) {
    throw new RuleError("code_duplicated", "批次编号已存在", { http: 409 });
  }
  const holder = items.find(x => x.vat === fields.vat && occupiesVat(x));
  if (holder) {
    throw new RuleError("vat_occupied", `缸位已被占用：${fields.vat} 正在发酵批次 ${holder.code}`, {
      http: 409, vat: fields.vat, heldBy: holder.code
    });
  }
  const item = {
    id: fields.genId(),
    code: fields.code,
    source: fields.source,
    vat: fields.vat,
    days: fields.days,
    owner: fields.owner,
    status: STATUS.ENTERED,
    normalStreak: 0,
    abnormalCase: null,
    logs: [{ at: new Date().toISOString(), step: "建档", note: `创建纸浆批次（${fields.vat}）` }],
    observations: []
  };
  return item;
}

// ---------- 每日观察：缺项不保存 + 异常/正常分流 ----------
export function addObservation(items, idOrCode, raw) {
  const item = findItem(items, idOrCode);
  if (item.status === STATUS.READY) {
    throw new RuleError("batch_ready", "该批次已可抄纸，不再接受每日观察", { http: 409 });
  }

  const temperature = text(raw.temperature);
  const smell = text(raw.smell);
  const fiber = text(raw.fiber);
  const observer = text(raw.observer);
  if (!temperature || !smell || !fiber || !observer) {
    throw new RuleError("missing_fields", "每日观察须填写温度、气味、纤维松散度和换水，且需填写观察人");
  }
  const changedWater = asChangedWater(raw.changedWater);
  const abnormal = asAbnormal(raw.abnormal) || asAbnormal(raw.abnormalSign);

  const record = {
    at: new Date().toISOString(),
    date: raw.date ? text(raw.date) : today(),
    temperature, smell, fiber, changedWater, abnormal, observer
  };

  if (abnormal) {
    applyAbnormalObservation(item, record);
  } else if (item.status === STATUS.ABNORMAL) {
    applyRecoveryObservation(item, record);
  } else {
    applyNormalObservation(item, record);
  }
  return item;
}

// 出现异味或霉点：只能转入异常观察，并开启待复核案件。
function applyAbnormalObservation(item, record) {
  if (item.abnormalCase) {
    // 复核处置后再次出现异常：原案件归档，另立新案，重新由他人复核。
    item.abnormalCaseHistory ||= [];
    item.abnormalCaseHistory.push(item.abnormalCase);
  }
  item.abnormalCase = {
    reportedAt: record.at,
    reporter: record.observer,
    abnormalSign: text(record.abnormalSign) || "异味或霉点",
    temperature: record.temperature,
    smell: record.smell,
    fiber: record.fiber,
    review: null
  };
  item.normalStreak = 0;
  item.status = STATUS.ABNORMAL;
  item.observations.push(record);
  item.logs.push({
    at: record.at, step: "异常观察",
    note: `${record.observer} 发现异味/霉点：温度${record.temperature}，${record.smell}，${record.fiber}，待复核`
  });
}

// 复核通过但尚未恢复：记录正常观察，换水才累计恢复进度。
function applyRecoveryObservation(item, record) {
  if (!item.abnormalCase || !item.abnormalCase.review) {
    // 未复核的异常案件不接受正常观察（必须先由另一人复核处置）。
    throw new RuleError("review_required", "存在待复核异常，须先由另一人复核并填写处置后再继续观察", { http: 409 });
  }
  if (record.changedWater) {
    item.normalStreak += 1;
  } else {
    item.normalStreak = 0;
    item.logs.push({ at: record.at, step: "观察", note: "本次未完成换水，连续正常计数清零" });
  }
  item.observations.push(record);
  if (item.normalStreak >= RECOVER_STREAK) {
    const closed = item.abnormalCase;
    item.abnormalCaseHistory ||= [];
    item.abnormalCaseHistory.push(closed);
    item.abnormalCase = null;
    item.status = STATUS.FERMENTING;
    item.logs.push({
      at: record.at, step: "恢复发酵",
      note: `连续 ${RECOVER_STREAK} 次正常且完成换水，复核人 ${closed.review.reviewer}，恢复发酵`
    });
  } else {
    item.logs.push({
      at: record.at, step: "观察",
      note: `复核后正常观察（已换水），连续 ${item.normalStreak}/${RECOVER_STREAK} 次`
    });
  }
}

// 入缸/发酵中的常规观察。
function applyNormalObservation(item, record) {
  if (item.status === STATUS.ENTERED) item.status = STATUS.FERMENTING;
  item.days = Number(item.days || 0) + 1;
  item.observations.push(record);
  if (item.days >= READY_DAYS) {
    item.status = STATUS.READY;
    item.logs.push({ at: record.at, step: "可抄纸", note: `累计发酵 ${item.days} 天，达到可抄纸条件，缸位 ${item.vat} 释放` });
  } else {
    item.logs.push({
      at: record.at, step: "观察",
      note: `温度${record.temperature}，${record.smell}，${record.fiber}，${record.changedWater ? "已换水" : "未换水"}（第 ${item.days} 天）`
    });
  }
}

// ---------- 异常复核：必须由另一人复核并填写处置 ----------
export function reviewAbnormal(items, idOrCode, raw) {
  const item = findItem(items, idOrCode);
  const c = item.abnormalCase;
  if (!c || c.review !== null) {
    throw new RuleError("no_pending_review", "该批次没有待复核的异常观察", { http: 409 });
  }
  const reviewer = text(raw.reviewer);
  const disposal = text(raw.disposal);
  if (!reviewer || !disposal) {
    throw new RuleError("missing_fields", "复核人与处置措施均为必填");
  }
  if (reviewer === c.reporter) {
    throw new RuleError("reviewer_must_be_different", "复核人必须与上报人不同（异常须由另一人复核）", { http: 409 });
  }
  c.review = { reviewer, disposal, at: new Date().toISOString() };
  item.normalStreak = 0;
  item.logs.push({
    at: c.review.at, step: "复核",
    note: `${reviewer} 复核 ${c.reporter} 上报的异常，处置：${disposal}；需连续 ${RECOVER_STREAK} 次正常且换水方可恢复发酵`
  });
  return item;
}

// ---------- 记录补充与受限字段更新 ----------
export function addLog(items, idOrCode, raw) {
  const item = findItem(items, idOrCode);
  const note = text(raw.note);
  if (!note) throw new RuleError("missing_fields", "备注内容不能为空");
  item.logs ||= [];
  item.logs.push({ at: new Date().toISOString(), step: text(raw.step) || "备注", note });
  return item;
}

const PATCHABLE = ["source", "owner"];
export function patchItem(items, idOrCode, raw) {
  const item = findItem(items, idOrCode);
  for (const key of Object.keys(raw)) {
    if (key === "status" || key === "vat") {
      throw new RuleError("field_protected", "状态只能由观察与复核流程驱动，缸位在建档后不可修改", { http: 409 });
    }
    if (!PATCHABLE.includes(key)) {
      throw new RuleError("field_not_allowed", `字段 ${key} 不允许修改`, { http: 409 });
    }
    const value = text(raw[key]);
    if (!value) throw new RuleError("missing_fields", `字段 ${key} 不能为空`);
    item[key] = value;
  }
  return item;
}

// ---------- 列表摘要与统计（刷新前后一致，待复核不计入可抄纸进度） ----------
export function summarize(item) {
  return {
    ...item,
    logCount: (item.logs || []).length,
    observationCount: (item.observations || []).length,
    pendingReview: isPendingReview(item)
  };
}

export function computeStats(items) {
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const item of items) if (counts[item.status] !== undefined) counts[item.status] += 1;

  const pendingReview = items.filter(isPendingReview).length;
  // 可抄纸进度：已可抄纸批次 / 参与发酵的批次；待复核批次仍在异常流程中，不计入分子。
  const trackItems = items.filter(x => x.status !== STATUS.ENTERED);
  const readyItems = items.filter(x => x.status === STATUS.READY);
  const denominator = trackItems.length;
  const progress = denominator ? Math.round((readyItems.length / denominator) * 100) : 0;
  const occupiedVats = items.filter(occupiesVat).map(x => ({ vat: x.vat, code: x.code, status: x.status }));

  return {
    counts,
    total: items.length,
    pendingReview,
    readyCount: readyItems.length,
    progress,
    progressDenominator: denominator,
    occupiedVats
  };
}
