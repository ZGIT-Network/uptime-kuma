const express = require("express");
const { log } = require("../src/util");
const expressStaticGzip = require("express-static-gzip");
const fs = require("fs");
const path = require("path");
const Database = require("./database");
const { allowDevAllOrigin } = require("./util-server");
const mysql = require("mysql2/promise");

/**
 *  A standalone express app that is used to setup a database
 *  It is used when db-config.json and kuma.db are not found or invalid
 *  Once it is configured, it will shut down and start the main server
 */
class SetupDatabase {
    /**
     * Show Setup Page
     * @type {boolean}
     */
    needSetup = true;
    /**
     * If the server has finished the setup
     * @type {boolean}
     * @private
     */
    runningSetup = false;
    /**
     * @inheritDoc
     * @type {UptimeKumaServer}
     * @private
     */
    server;

    /**
     * @param  {object} args The arguments passed from the command line
     * @param  {UptimeKumaServer} server the main server instance
     */
    constructor(args, server) {
        this.server = server;

        // Priority: env > db-config.json
        // If env is provided, write it to db-config.json
        // If db-config.json is found, check if it is valid
        // If db-config.json is not found or invalid, check if kuma.db is found
        // If kuma.db is not found, show setup page

        let dbConfig;

        try {
            dbConfig = Database.readDBConfig();
            log.debug("setup-database", "db-config.json 已找到并且有效");
            this.needSetup = false;

        } catch (e) {
            log.info("setup-database", "db-config.json 未找到或无效: " + e.message);

            // Check if kuma.db is found (1.X.X users), generate db-config.json
            if (fs.existsSync(path.join(Database.dataDir, "kuma.db"))) {
                this.needSetup = false;

                log.info("setup-database", "kuma.db 已找到,将生成 db-config.json");
                Database.writeDBConfig({
                    type: "sqlite",
                });
            } else {
                this.needSetup = true;
            }
            dbConfig = {};
        }

        if (process.env.UPTIME_KUMA_DB_TYPE) {
            this.needSetup = false;
            log.info("setup-database", "UPTIME_KUMA_DB_TYPE 由 env 提供, 尝试覆盖 db-config.json");
            dbConfig.type = process.env.UPTIME_KUMA_DB_TYPE;
            dbConfig.hostname = process.env.UPTIME_KUMA_DB_HOSTNAME;
            dbConfig.port = process.env.UPTIME_KUMA_DB_PORT;
            dbConfig.dbName = process.env.UPTIME_KUMA_DB_NAME;
            dbConfig.username = process.env.UPTIME_KUMA_DB_USERNAME;
            dbConfig.password = process.env.UPTIME_KUMA_DB_PASSWORD;
            Database.writeDBConfig(dbConfig);
        }

    }

    /**
     * Show Setup Page
     * @returns {boolean} true if the setup page should be shown
     */
    isNeedSetup() {
        return this.needSetup;
    }

    /**
     * Check if the embedded MariaDB is enabled
     * @returns {boolean} true if the embedded MariaDB is enabled
     */
    isEnabledEmbeddedMariaDB() {
        return process.env.UPTIME_KUMA_ENABLE_EMBEDDED_MARIADB === "1";
    }

    /**
     * Start the setup-database server
     * @param {string} hostname where the server is listening
     * @param {number} port where the server is listening
     * @returns {Promise<void>}
     */
    start(hostname, port) {
        return new Promise((resolve) => {
            const app = express();
            let tempServer;
            app.use(express.json());

            // Disable Keep Alive, otherwise the server will not shutdown, as the client will keep the connection alive
            app.use(function (req, res, next) {
                res.setHeader("Connection", "close");
                next();
            });

            app.get("/", async (request, response) => {
                response.redirect("/setup-database");
            });

            app.get("/api/entry-page", async (request, response) => {
                allowDevAllOrigin(response);
                response.json({
                    type: "setup-database",
                });
            });

            app.get("/setup-database-info", (request, response) => {
                allowDevAllOrigin(response);
                console.log("Request /setup-database-info");
                response.json({
                    runningSetup: this.runningSetup,
                    needSetup: this.needSetup,
                    isEnabledEmbeddedMariaDB: this.isEnabledEmbeddedMariaDB(),
                });
            });

            app.post("/setup-database", async (request, response) => {
                allowDevAllOrigin(response);

                if (this.runningSetup) {
                    response.status(400).json("Setup is already running");
                    return;
                }

                this.runningSetup = true;

                let dbConfig = request.body.dbConfig;

                let supportedDBTypes = [ "mariadb", "sqlite" ];

                if (this.isEnabledEmbeddedMariaDB()) {
                    supportedDBTypes.push("embedded-mariadb");
                }

                // Validate input
                if (typeof dbConfig !== "object") {
                    response.status(400).json("Invalid dbConfig");
                    this.runningSetup = false;
                    return;
                }

                if (!dbConfig.type) {
                    response.status(400).json("Database Type is required");
                    this.runningSetup = false;
                    return;
                }

                if (!supportedDBTypes.includes(dbConfig.type)) {
                    response.status(400).json("Unsupported Database Type");
                    this.runningSetup = false;
                    return;
                }

                // External MariaDB
                if (dbConfig.type === "mariadb") {
                    if (!dbConfig.hostname) {
                        response.status(400).json("Hostname is required");
                        this.runningSetup = false;
                        return;
                    }

                    if (!dbConfig.port) {
                        response.status(400).json("Port is required");
                        this.runningSetup = false;
                        return;
                    }

                    if (!dbConfig.dbName) {
                        response.status(400).json("Database name is required");
                        this.runningSetup = false;
                        return;
                    }

                    if (!dbConfig.username) {
                        response.status(400).json("Username is required");
                        this.runningSetup = false;
                        return;
                    }

                    if (!dbConfig.password) {
                        response.status(400).json("Password is required");
                        this.runningSetup = false;
                        return;
                    }

                    // Test connection
                    try {
                        const connection = await mysql.createConnection({
                            host: dbConfig.hostname,
                            port: dbConfig.port,
                            user: dbConfig.username,
                            password: dbConfig.password,
                        });
                        await connection.execute("SELECT 1");
                        connection.end();
                    } catch (e) {
                        response.status(400).json("Cannot connect to the database: " + e.message);
                        this.runningSetup = false;
                        return;
                    }
                }

                // Write db-config.json
                Database.writeDBConfig(dbConfig);

                response.json({
                    ok: true,
                });

                // Shutdown down this express and start the main server
                log.info("setup-database", "数据库已配置, 请关闭安装数据库服务器并立即启动主服务器.");
                if (tempServer) {
                    tempServer.close(() => {
                        log.info("setup-database", "setup-database 服务器已关闭");
                        resolve();
                    });
                } else {
                    resolve();
                }

            });

            app.use("/", expressStaticGzip("dist", {
                enableBrotli: true,
            }));

            app.get("*", async (_request, response) => {
                response.send(this.server.indexHTML);
            });

            app.options("*", async (_request, response) => {
                allowDevAllOrigin(response);
                response.end();
            });

            tempServer = app.listen(port, hostname, () => {
                log.info("setup-database", `启动数据库初始化服务器于端口 ${port}`);
                let domain = (hostname) ? hostname : "localhost";
                log.info("setup-database", `请在浏览器中打开 http://${domain}:${port}`);
                log.info("setup-database", "等待用户操作...");
            });
        });
    }
}

module.exports = {
    SetupDatabase,
};
