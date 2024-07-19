const NotificationProvider = require("./notification-provider");
const axios = require("axios");

const { DOWN, UP } = require("../../src/util");

class Pushbullet extends NotificationProvider {
    name = "pushbullet";

    /**
     * @inheritdoc
     */
    async send(notification, msg, monitorJSON = null, heartbeatJSON = null) {
        const okMsg = "Sent Successfully.";
        const url = "https://api.pushbullet.com/v2/pushes";

        try {
            let config = {
                headers: {
                    "Access-Token": notification.pushbulletAccessToken,
                    "Content-Type": "application/json"
                }
            };
            if (heartbeatJSON == null) {
                let data = {
                    "type": "note",
                    "title": "Uptime Kuma Alert",
                    "body": msg,
                };
                await axios.post(url, data, config);
            } else if (heartbeatJSON["status"] === DOWN) {
                let downData = {
                    "type": "note",
                    "title": "ZGIT Network 业务状态告警: " + monitorJSON["name"],
                    "body": "[🔴 异常/离线] " +
                        heartbeatJSON["msg"] +
                        `\n时间戳 (${heartbeatJSON["timezone"]}): ${heartbeatJSON["localDateTime"]}`,
                };
                await axios.post(url, downData, config);
            } else if (heartbeatJSON["status"] === UP) {
                let upData = {
                    "type": "note",
                    "title": "ZGIT Network 业务状态告警: " + monitorJSON["name"],
                    "body": "[✅ 已恢复] " +
                        heartbeatJSON["msg"] +
                        `\n时间戳 (${heartbeatJSON["timezone"]}): ${heartbeatJSON["localDateTime"]}`,
                };
                await axios.post(url, upData, config);
            }
            return okMsg;
        } catch (error) {
            this.throwGeneralAxiosError(error);
        }
    }
}

module.exports = Pushbullet;
