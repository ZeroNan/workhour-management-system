// 入口：Express 装配、静态资源、启动监听
import express from 'express';
import { config } from './src/config.js'; // 必须最先 import（内含 TZ 设置）
import { sessionParser, requireAuth } from './src/middleware/auth.js';
import { errorHandler, notFoundHandler } from './src/middleware/errorHandler.js';
import authRoutes from './src/routes/auth.js';
import departmentRoutes from './src/routes/departments.js';
import projectRoutes from './src/routes/projects.js';
import userRoutes from './src/routes/users.js';
import timesheetRoutes from './src/routes/timesheets.js';
import auditRoutes from './src/routes/audit.js';
import statsRoutes from './src/routes/stats.js';
import reportRoutes from './src/routes/reports.js';
import integrationRoutes from './src/routes/integration.js';
import db from './src/db.js';
import { seedIfEmpty } from './src/seed.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(sessionParser);

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/users', requireAuth, userRoutes); // 整体需登录（GET 列表内部再校验 admin）
app.use('/api/timesheets', timesheetRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/integrations', integrationRoutes);

// 404 兜底（API）
app.use('/api', notFoundHandler);

// 静态资源（public/，v1 历史基线位于 legacy/v1-index.html，不影响 v2 服务）
app.use(express.static('public'));

// 统一错误响应
app.use(errorHandler);

// 启动：先种子（空库才种，失败即退出，避免带病运行），成功后再监听
seedIfEmpty()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`[wtms] 工时管理系统已启动: http://localhost:${config.port} (TZ=${process.env.TZ})`);
    });
  })
  .catch((e) => {
    console.error('[wtms] 启动失败（种子数据初始化异常）：', e);
    process.exit(1);
  });
