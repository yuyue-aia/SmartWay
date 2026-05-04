# SmartWay 家庭作业平台

用于余晓、余跃的家庭作业跟踪和练习。

## 启动

```bash
npm start
```

启动后访问：

```text
http://localhost:3000
```

## 后端接口

- `GET /api/children`：儿童列表
- `GET /api/children/:childId/tasks`：指定儿童的任务列表
- `GET /api/children/:childId/records`：指定儿童的完成记录
- `POST /api/children/:childId/records`：新增完成记录
