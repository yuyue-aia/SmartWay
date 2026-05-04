const config = require('../config');

let webServer;

function setWebServer(server) {
  webServer = server;
}

function isWebRestartEnabled() {
  return config.restartMode === 'exit';
}

function scheduleWebRestart() {
  const delayMs = Number.isFinite(config.restartDelayMs) && config.restartDelayMs >= 0
    ? config.restartDelayMs
    : 500;

  setTimeout(() => {
    console.log('SmartWay 服务准备重启');
    const forceExit = setTimeout(() => process.exit(0), 5000);
    forceExit.unref();

    if (webServer) {
      webServer.close(() => process.exit(0));
      return;
    }

    process.exit(0);
  }, delayMs).unref();
}

module.exports = {
  setWebServer,
  isWebRestartEnabled,
  scheduleWebRestart
};
