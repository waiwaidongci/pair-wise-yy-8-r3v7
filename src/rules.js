// 状态规则模块：发酵批次全部业务规则的唯一来源。
//
// 状态机：
//   入缸 ──首次每日观察──▶ 发酵中 ──正常观察且满7天──▶ 可抄纸（缸位释放）
//   任意阶段出现异味/霉点 ──▶ 异常观察（待复核，占用缸位、不计入可抄纸进度）
//   异常观察·待复核 ──他人复核并填写处置──▶ 异常观察·复核中恢复
//       ──连续两次【正常且完成换水】的观察──▶ 发酵中（恢复）
//       ──期间再出现异味/霉点──▶ 异常观察·待复核（重新走复核）
export const STATUSES = ["入缸", "发酵中", "可抄纸", "异常观察"];
export const STAT_LABELS = [
  "入缸",
  "发酵中",
  "可抄纸",
  "异常观察·待复核",
  "异常观察·复核中恢复",
  "可抄纸进度"
];
// 发酵中（含入缸、异常恢复观察）仍占用缸位；可抄纸后缸位释放。
const OCCUPYING = new Set(["入缸", "发酵中", "异常观察"]);
const ACTIVE = new Set(["入缸", "发酵中", "异常观察"]);
const FERMENT_DAYS = 7;

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const trueness = v => ["是", "有", "true", "1", "yes"].includes(String(v ?? "").trim().toLowerCase());

function text(input, key, label, fields) {
  const value = String(input?.[key] ?? "").trim();
  if (!value) {
    fields.push(label);
    return "";
  }
  return value;
}

function findItem(db, id) {
  const item = db.items.find(x => x.id === id || x.code === id);
  if (!item) throw new HttpError(404, "item_not_found", "未找到该纸浆批次");
  return item;
}

// —— 新建批次：缸位排他，冲突返回 409 且不落库 ——
export function createBatch(input) {
  return db => {
    const missing = [];
    const code = text(input, "code", "批次编号", missing);
    const source = text(input, "source", "原料来源", missing);
    const vat = text(input, "vat", "浸泡缸", missing);
    const owner = text(input, "owner", "负责人", missing);
    if (missing.length) {
      throw new HttpError(400, "missing_fields", "请完整填写：" + missing.join("、"), { fields: missing });
    }

    if (db.items.some(x => x.code === code)) {
      throw new HttpError(409, "code_exists", `批次编号 ${code} 已存在`, { code });
    }
    // 每口缸同时只能有一批发酵：入缸/发酵中/异常观察均占用缸位，可抄纸后释放。
    const occupant = db.items.find(x => x.vat === vat && OCCUPYING.has(x.status));
    if (occupant) {
      throw new HttpError(409, "vat_conflicted",
        `${vat}已有批次 ${occupant.code}（${occupant.status}）在发酵，无法重复占用`,
        { vat, occupiedBy: occupant.code, occupantStatus: occupant.status });
    }

    const now = new Date().toISOString();
    const item = {
      id: code,
      code,
      source,
      vat,
      days: 0,
      owner,
      status: "入缸",
      reviewState: "none",
      recoveryStreak: 0,
      observations: [],
      reviews: [],
      logs: [{ at: now, step: "建档", note: `${owner}登记入缸，缸位：${vat}，原料：${source}` }]
    };
    db.items.unshift(item);
    return item;
  };
}

// —— 每日观察：四项必填；异味/霉点只能转异常观察 ——
export function addObservation(id, input) {
  return db => {
    const item = findItem(db, id);

    const missing = [];
    const temperature = text(input, "temperature", "温度", missing);
    const smell = text(input, "smell", "气味", missing);
    const fiber = text(input, "fiber", "纤维松散度", missing);
    const waterRaw = String(input?.changedWater ?? "").trim();
    if (!waterRaw) missing.push("换水");
    const observer = text(input, "observer", "观察人", missing);
    if (missing.length) {
      throw new HttpError(400, "missing_fields", "每日观察缺项，不得保存：" + missing.join("、"), { fields: missing });
    }
    if (!["是", "否"].includes(waterRaw)) {
      throw new HttpError(400, "invalid_field", "“换水”请选择“是”或“否”", { fields: ["换水"] });
    }

    if (!ACTIVE.has(item.status)) {
      throw new HttpError(400, "status_not_observable", `批次已为「${item.status}」，不再登记每日观察`);
    }

    const changedWater = waterRaw === "是";
    // 异味或霉点任一出现即判定异常；异常只能走异常观察闭环。
    const abnormal = trueness(input?.odor) || trueness(input?.mold) || trueness(input?.abnormal);

    // 待复核批次不接受普通观察，必须先由另一人复核处置。
    if (item.reviewState === "pending") {
      throw new HttpError(400, "review_pending",
        "该批次存在异味/霉点待复核，需由另一人复核并填写处置后才能继续观察");
    }

    // 先完成全部校验，再写记录，保证缺项/冲突不落库。
    const now = new Date().toISOString();
    const observation = {
      at: now,
      temperature,
      smell,
      fiber,
      changedWater,
      odor: trueness(input?.odor),
      mold: trueness(input?.mold),
      abnormal,
      observer
    };
    item.observations.push(observation);

    let transition = "";
    if (abnormal) {
      item.status = "异常观察";
      item.reviewState = "pending";
      item.recoveryStreak = 0;
      transition = "发现异味/霉点，转入异常观察，等待他人复核";
    } else if (item.reviewState === "recovering") {
      // 连续两次“正常且完成换水”才能恢复发酵；未换水则连续计数清零。
      item.recoveryStreak = changedWater ? item.recoveryStreak + 1 : 0;
      if (item.recoveryStreak >= 2) {
        item.status = "发酵中";
        item.reviewState = "none";
        item.recoveryStreak = 0;
        transition = "连续两次观察正常且完成换水，恢复发酵";
      } else {
        transition = `恢复观察正常${changedWater ? `且完成换水（连续 ${item.recoveryStreak}/2 次）` : "但未换水，连续计数清零（0/2 次）"}`;
      }
    } else {
      item.days = Number(item.days || 0) + 1;
      if (item.status === "入缸") {
        item.status = "发酵中";
        transition = "首次每日观察，进入发酵中";
      }
      if (item.days >= FERMENT_DAYS) {
        item.status = "可抄纸";
        transition = `正常观察满 ${FERMENT_DAYS} 天，达到可抄纸，缸位 ${item.vat} 释放`;
      } else {
        transition = transition || `正常观察，累计 ${item.days}/${FERMENT_DAYS} 天`;
      }
    }

    item.logs.push({
      at: now,
      step: abnormal ? "异常观察" : "观察",
      note: `温度${temperature}，气味${smell}，纤维${fiber}，换水${waterRaw}，观察人${observer}。${transition}`,
      abnormal
    });

    return { item, observation };
  };
}

// —— 异常复核：必须由另一人复核并填写处置 ——
export function reviewBatch(id, input) {
  return db => {
    const item = findItem(db, id);
    if (item.status !== "异常观察" || item.reviewState !== "pending") {
      throw new HttpError(400, "not_pending_review", "该批次当前没有待复核的异常观察");
    }

    const missing = [];
    const reviewer = text(input, "reviewer", "复核人", missing);
    const disposal = text(input, "disposal", "处置措施", missing);
    if (missing.length) {
      throw new HttpError(400, "missing_fields", "复核缺项，不得保存：" + missing.join("、"), { fields: missing });
    }

    const flagged = item.observations.filter(o => o.abnormal);
    const lastFlagged = flagged[flagged.length - 1];
    // 另一人：不能是批次负责人，也不能是上报该次异常的观察人。
    if (reviewer === item.owner) {
      throw new HttpError(400, "reviewer_conflict", "复核人不能是批次负责人本人，须由另一人复核");
    }
    if (lastFlagged && reviewer === lastFlagged.observer) {
      throw new HttpError(400, "reviewer_conflict", "复核人不能是上报本次异味/霉点的观察人，须由另一人复核");
    }

    const now = new Date().toISOString();
    const review = {
      at: now,
      reviewer,
      disposal,
      result: String(input?.result ?? "继续恢复观察").trim() || "继续恢复观察"
    };
    item.reviews.push(review);
    item.reviewState = "recovering";
    item.recoveryStreak = 0;
    item.logs.push({
      at: now,
      step: "复核",
      note: `复核人${reviewer}处置：${disposal}（${review.result}）。等待连续两次正常且换水的观察后恢复发酵`
    });
    return { item, review };
  };
}

// —— 对外视图 ——
export function summarize(item) {
  const lastObs = item.observations[item.observations.length - 1] || null;
  return {
    id: item.id,
    code: item.code,
    source: item.source,
    vat: item.vat,
    days: item.days,
    owner: item.owner,
    status: item.status,
    reviewState: item.reviewState,
    recoveryStreak: item.recoveryStreak,
    observations: item.observations,
    reviews: item.reviews,
    logs: item.logs,
    lastObservation: lastObs,
    abnormalCount: item.observations.filter(o => o.abnormal).length
  };
}

// 待复核批次不计入可抄纸进度：统计只数实际「可抄纸」批次。
export function computeStats(items) {
  const stats = Object.fromEntries(STAT_LABELS.map(label => [label, 0]));
  for (const item of items) {
    if (item.status === "异常观察") {
      stats[item.reviewState === "pending" ? "异常观察·待复核" : "异常观察·复核中恢复"] += 1;
    } else if (stats[item.status] !== undefined) {
      stats[item.status] += 1;
    }
    if (item.status === "可抄纸") stats["可抄纸进度"] += 1;
  }
  return stats;
}

export function overview(db) {
  const items = db.items.map(summarize);
  return { items, stats: computeStats(db.items) };
}
