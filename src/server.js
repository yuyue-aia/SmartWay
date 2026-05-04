const app = require('./app');
const config = require('./config');
const { setWebServer } = require('./services/restart.service');

const server = app.listen(config.port, () => {
  console.log(`SmartWay 服务已启动：http://localhost:${config.port}`);
});

setWebServer(server);

function shutdown(signal) {
  console.log(`收到 ${signal}，SmartWay 服务准备退出`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
