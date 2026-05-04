# SmartWay 家庭作业平台

用于余晓、余跃的家庭作业跟踪和练习。后端已改造为标准 Express Web 服务，前端仍保留原生 HTML 任务页结构。

## 启动

```bash
npm install
npm start
```

默认端口为 `80`，可通过环境变量覆盖：

```bash
PORT=3000 npm run dev
```

启动后访问：

```text
http://localhost:80
```

## 项目结构

```text
src/
├── app.js                 # Express 应用组装
├── server.js              # 服务启动入口
├── config/                # 路径和环境变量配置
├── controllers/           # API 控制器
├── middleware/            # 通用中间件
├── repositories/          # JSON 文件读写
├── routes/                # API 路由
└── services/              # 业务逻辑
```

根目录 `server.js` 保留为兼容入口，现有 `systemd` 部署无需改动。

## 后端接口

- `GET /api/health`：健康检查
- `GET /api/children`：儿童列表
- `GET /api/children/:childId/tasks`：指定儿童的任务列表
- `GET /api/children/:childId/records`：指定儿童的完成记录
- `POST /api/children/:childId/records`：新增完成记录
- `POST /api/github/update`：从 GitHub 拉取更新，可选重启
