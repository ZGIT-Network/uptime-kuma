const { MonitorType } = require("./monitor-type");
const { UP, log, evaluateJsonQuery } = require("../../src/util");
const snmp = require("net-snmp");

class SNMPMonitorType extends MonitorType {
    name = "snmp";

    /**
     * @inheritdoc
     */
    async check(monitor, heartbeat, _server) {
        let session;
        try {
            const sessionOptions = {
                port: monitor.port || "161",
                retries: monitor.maxretries,
                timeout: monitor.timeout * 1000,
                version: snmp.Version[monitor.snmpVersion],
            };
            session = snmp.createSession(monitor.hostname, monitor.radiusPassword, sessionOptions);

            // Handle errors during session creation
            session.on("error", (error) => {
                throw new Error(`Error creating SNMP session: ${error.message}`);
            });

            const varbinds = await new Promise((resolve, reject) => {
                session.get([ monitor.snmpOid ], (error, varbinds) => {
                    error ? reject(error) : resolve(varbinds);
                });
            });
            log.debug("monitor", `SNMP: 收到 varbinds (类型: ${snmp.ObjectType[varbinds[0].type]} 值: ${varbinds[0].value})`);

            if (varbinds.length === 0) {
                throw new Error(`\`SNMP 会话未返回 varbinds (OID: ${monitor.snmpOid})`);
            }

            if (varbinds[0].type === snmp.ObjectType.NoSuchInstance) {
                throw new Error(`SNMP 查询返回 OID: ${monitor.snmpOid} 不存在实例 `);
            }

            // We restrict querying to one OID per monitor, therefore `varbinds[0]` will always contain the value we're interested in.
            const value = varbinds[0].value;

            const { status, response } = await evaluateJsonQuery(value, monitor.jsonPath, monitor.jsonPathOperator, monitor.expectedValue);

            if (status) {
                heartbeat.status = UP;
                heartbeat.msg = `JSON query passes (comparing ${response} ${monitor.jsonPathOperator} ${monitor.expectedValue})`;
            } else {
                throw new Error(`JSON query does not pass (comparing ${response} ${monitor.jsonPathOperator} ${monitor.expectedValue})`);
            }
        } finally {
            if (session) {
                session.close();
            }
        }
    }
}

module.exports = {
    SNMPMonitorType,
};
