// 统计路由：按项目统计矩阵（渲染与导出共用）
// admin 全量；pm 仅自己负责的项目；projectId 为空 = 聚合可见范围内的全部项目
import { Router } from 'express';
import db from '../db.js';
import { err, wrap } from '../utils/http.js';
import { requireRole } from '../middleware/auth.js';
import { projectStats } from '../services/statsService.js';

const router = Router();

// 30. 按项目统计
router.get('/project', requireRole('admin', 'pm'), wrap(async (req, res) => {
  const me = req.user;
  const { projectId, month, scope } = req.query;
  // 可见项目范围：admin 全部；pm 仅自己负责的
  let accessible = [];
  if (me.role === 'admin') {
    accessible = (await db.prepare('SELECT id FROM projects ORDER BY id').all()).map(r => r.id);
  } else {
    accessible = (await db.prepare('SELECT id FROM projects WHERE owner_id = ? ORDER BY id').all(me.id)).map(r => r.id);
  }
  const pid = projectId ? Number(projectId) : null;
  res.json(await projectStats(pid, String(month || ''), String(scope || 'all'), accessible));
}));

export default router;
