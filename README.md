# 古法纸浆发酵记录

纸浆批次发酵管理：一缸一批排他占用、每日四项观察必填、异常双人复核闭环。

## 运行

```bash
npm start      # http://localhost:3039
npm test       # 状态规则闭环测试（node:test，使用临时数据文件）
```

数据保存在 `data/paper-pulp-fermentation.json`（可用 `DB_PATH` 覆盖，原子写：临时文件 + rename）。

## 模块划分

| 文件 | 职责 |
| --- | --- |
| `server.js` | 启动入口，装配存储与 HTTP 服务 |
| `src/routes.js` | 请求入口：HTTP 解析、路由分发、错误码响应 |
| `src/rules.js` | 状态规则：缸位排他、观察校验、异常复核状态机、统计（纯函数，可单测） |
| `src/store.js` | 记录存储：JSON 持久化、写操作串行队列、历史数据迁移 |
| `src/page.js` | 单页前端 |

## 业务规则

- **缸位排他**：一口缸同时只能有一批发酵（入缸 / 发酵中 / 异常观察均占用缸位，可抄纸后释放）。冲突提交返回 `409 vat_conflicted`（编号重复为 `409 code_exists`），经串行写队列保证**不落库**。
- **每日观察必填四项**：温度、气味、纤维松散度、换水（另需观察人）。缺项返回 `400 missing_fields`，不保存。
- **异常复核闭环**：观察中勾选异味或霉点 → 批次转「异常观察·待复核」，只能走复核流程；复核人必须是另一人（不能是批次负责人，也不能是上报该次异常的观察人），须填写处置措施。
- **恢复条件**：复核后进入「异常观察·复核中恢复」，需**连续两次正常且完成换水**的观察才恢复发酵（未换水则连续计数清零；期间再出现异味/霉点须重新复核）。
- **统计**：待复核批次不计入「可抄纸进度」；统计单列「异常观察·待复核」「异常观察·复核中恢复」。
- **一致性**：列表与统计只从 `GET /api/overview` 同一快照渲染，任何写操作成功后整体重拉，刷新后一致。

## API

- `POST /api/batches` 建档入缸
- `POST /api/batches/:code/observations` 每日观察（`temperature` `smell` `fiber` `changedWater=是|否` `observer`，可选 `odor` `mold`）
- `POST /api/batches/:code/reviews` 异常复核（`reviewer` `disposal` `result`）
- `GET /api/overview` 列表 + 统计（同源快照）
- `GET /api/batches`、`GET /api/stats` 兼容入口
