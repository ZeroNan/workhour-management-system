// 统计路由：按项目统计矩阵（渲染与导出共用）+ 管理员工时统计总览
// admin 全量；pm 仅自己负责的项目（/admin/overview 仅 admin）
// projectId 为空且未提供 projectIds = 聚合可见范围内的全部项目；projectIds（多选）优先于 projectId
import { Router } from 'express';
import db from '../db.js';
import { err, wrap } from '../utils/http.js';
import { requireRole } from '../middleware/auth.js';
import { projectStats, adminOverview } from '../services/statsService.js';

const router = Router();

/**
 * 解析多选项目参数 projectIds（逗号分隔整数）。
 * @param {unknown} raw 原始查询参数
 * @returns {number[]|null} null = 未提供（走单值/聚合原逻辑）
 */
function parseProjectIds(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const parts = String(raw).split(',').map(s => s.trim()).filter(s => s !== '');
  if (!parts.length) throw err('VALIDATION_ERROR', 'projectIds 非法');
  const ids = [...new Set(parts.map(Number))];
  if (ids.some(id => !Number.isInteger(id))) throw err('VALIDATION_ERROR', 'projectIds 必须为整数项目 id 列表');
  return ids;
}

// 30. 按项目统计
router.get('/project', requireRole('admin', 'pm'), wrap(async (req, res) => {
  const me = req.user;
  const { projectId, projectIds, month, scope } = req.query;
  // 可见项目范围：admin 全部；pm 仅自己负责的
  let accessible = [];
  if (me.role === 'admin') {
    accessible = (await db.prepare('SELECT id FROM projects ORDER BY id').all()).map(r => r.id);
  } else {
    accessible = (await db.prepare('SELECT id FROM projects WHERE owner_id = ? ORDER BY id').all(me.id)).map(r => r.id);
  }
  // 多选优先：projectIds 存在时以它为准，projectId 传 null
  const selected = parseProjectIds(projectIds);
  if (selected) {
    const visible = new Set(accessible.map(Number));
    if (selected.some(id => !visible.has(id))) throw err('FORBIDDEN', '无权查看所选项目统计');
  }
  const pid = selected ? null : (projectId ? Number(projectId) : null);
  res.json(await projectStats(pid, String(month || ''), String(scope || 'all'), accessible, selected));
}));

// 32. 管理员工时统计总览（工时统计页，仅 admin，只读聚合）
router.get('/admin/overview', requireRole('admin'), wrap(async (req, res) => {
  const { from, to, scope } = req.query;
  res.json(await adminOverview({
    from: String(from || ''),
    to: String(to || ''),
    scope: scope === undefined || scope === null ? 'all' : String(scope),
  }));
}));

export default router;
