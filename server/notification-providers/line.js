const NotificationProvider = require("./notification-provider");
const axios = require("axios");
const { DOWN, UP } = require("../../src/util");

class Line extends NotificationProvider {
    name = "line";

    /**
     * @inheritdoc
     */
    async send(notification, msg, monitorJSON = null, heartbeatJSON = null) {
        const okMsg = "Sent Successfully.";
        const url = "https://api.line.me/v2/bot/message/push";

        try {
            let config = {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + notification.lineChannelAccessToken
                }
            };
            if (heartbeatJSON == null) {
                let testMessage = {
                    "to": notification.lineUserID,
                    "messages": [
                        {
                            "type": "text",
                            "text": "Test Successful!"
                        }
                    ]
                };
                await axios.post(url, testMessage, config);
            } else if (heartbeatJSON["status"] === DOWN) {
                let downMessage = {
                    "to": notification.lineUserID,
                    "messages": [
                        {
                            "type": "text",
                            "text": "ZGIT Network 业务状态告警: [🔴 异常/离线]\n" +
                                "[" + monitorJSON["name"] + "] \n" +
                                heartbeatJSON["msg"] +
                                `\n时间戳 (${heartbeatJSON["timezone"]}): ${heartbeatJSON["localDateTime"]}`
                        }
                    ]
                };
                await axios.post(url, downMessage, config);
            } else if (heartbeatJSON["status"] === UP) {
                let upMessage = {
                    "to": notification.lineUserID,
                    "messages": [
                        {
                            "type": "text",
                            "text": "ZGIT Network 业务状态通知: [✅ 已恢复]\n" +
                                "[" + monitorJSON["name"] + "] \n" +
                                heartbeatJSON["msg"] +
                                `\n时间戳 (${heartbeatJSON["timezone"]}): ${heartbeatJSON["localDateTime"]}`
                        }
                    ]
                };
                await axios.post(url, upMessage, config);
            }
            return okMsg;
        } catch (error) {
            this.throwGeneralAxiosError(error);
        }
    }
}

module.exports = Line;
