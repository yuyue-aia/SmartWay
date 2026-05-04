# SmartWay systemd 服务部署

建议把 Web 服务注册为 `systemd` 服务，由系统负责启动、停止和重启。

## 1. 配置环境变量

```bash
sudo cp /root/SmartWay/deploy/smartway.env.example /etc/smartway.env
sudo chmod 600 /etc/smartway.env
sudo vi /etc/smartway.env
```

把 `GITHUB_UPDATE_TOKEN` 改成足够长的随机字符串。

## 2. 安装服务

```bash
sudo cp /root/SmartWay/deploy/smartway.service /etc/systemd/system/smartway.service
sudo systemctl daemon-reload
sudo systemctl enable smartway
sudo systemctl start smartway
```

## 3. 常用命令

```bash
sudo systemctl status smartway
sudo systemctl restart smartway
sudo systemctl stop smartway
sudo journalctl -u smartway -f
```

## 4. 远程更新并重启

服务启动时需要启用：

```ini
SMARTWAY_RESTART_MODE=exit
```

远程调用：

```bash
SMARTWAY_UPDATE_URL="http://你的服务器/api/github/update" \
SMARTWAY_UPDATE_TOKEN="/etc/smartway.env 中的 GITHUB_UPDATE_TOKEN" \
SMARTWAY_RESTART=1 \
npm run update:github
```

接口会先执行 `git fetch` + `git pull --ff-only`，成功后返回响应，再退出当前 Node.js 进程。`systemd` 因为配置了 `Restart=always`，会自动拉起新进程。
