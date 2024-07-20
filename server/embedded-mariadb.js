const { log } = require("../src/util");
const childProcess = require("child_process");
const fs = require("fs");
const mysql = require("mysql2");

/**
 * It is only used inside the docker container
 */
class EmbeddedMariaDB {

    static instance = null;

    exec = "mariadbd";

    mariadbDataDir = "/app/data/mariadb";

    runDir = "/app/data/run/mariadb";

    socketPath = this.runDir + "/mysqld.sock";

    /**
     * @type {ChildProcessWithoutNullStreams}
     * @private
     */
    childProcess = null;
    running = false;

    started = false;

    /**
     * @returns {EmbeddedMariaDB} The singleton instance
     */
    static getInstance() {
        if (!EmbeddedMariaDB.instance) {
            EmbeddedMariaDB.instance = new EmbeddedMariaDB();
        }
        return EmbeddedMariaDB.instance;
    }

    /**
     * @returns {boolean} If the singleton instance is created
     */
    static hasInstance() {
        return !!EmbeddedMariaDB.instance;
    }

    /**
     * Start the embedded MariaDB
     * @returns {Promise<void>|void} A promise that resolves when the MariaDB is started or void if it is already started
     */
    start() {
        if (this.childProcess) {
            log.info("mariadb", "已经启动");
            return;
        }

        this.initDB();

        this.running = true;
        log.info("mariadb", "启动嵌入式 MariaDB");
        this.childProcess = childProcess.spawn(this.exec, [
            "--user=node",
            "--datadir=" + this.mariadbDataDir,
            `--socket=${this.socketPath}`,
            `--pid-file=${this.runDir}/mysqld.pid`,
        ]);

        this.childProcess.on("close", (code) => {
            this.running = false;
            this.childProcess = null;
            this.started = false;
            log.info("mariadb", "启动嵌入式 MariaDB: " + code);

            if (code !== 0) {
                log.info("mariadb", "尝试重启嵌入式 MariaDB,因为不是由用户手动停止的");
                this.start();
            }
        });

        this.childProcess.on("error", (err) => {
            if (err.code === "ENOENT") {
                log.error("mariadb", `嵌入式 MariaDB: ${this.exec} 不存在`);
            } else {
                log.error("mariadb", err);
            }
        });

        let handler = (data) => {
            log.debug("mariadb", data.toString("utf-8"));
            if (data.toString("utf-8").includes("ready for connections")) {
                this.initDBAfterStarted();
            }
        };

        this.childProcess.stdout.on("data", handler);
        this.childProcess.stderr.on("data", handler);

        return new Promise((resolve) => {
            let interval = setInterval(() => {
                if (this.started) {
                    clearInterval(interval);
                    resolve();
                } else {
                    log.info("mariadb", "等待嵌入式 MariaDB 启动...");
                }
            }, 1000);
        });
    }

    /**
     * Stop all the child processes
     * @returns {void}
     */
    stop() {
        if (this.childProcess) {
            this.childProcess.kill("SIGINT");
            this.childProcess = null;
        }
    }

    /**
     * Install MariaDB if it is not installed and make sure the `runDir` directory exists
     * @returns {void}
     */
    initDB() {
        if (!fs.existsSync(this.mariadbDataDir)) {
            log.info("mariadb", `嵌入式 MariaDB: ${this.mariadbDataDir} 没找到,将创建一个.`);
            fs.mkdirSync(this.mariadbDataDir, {
                recursive: true,
            });

            let result = childProcess.spawnSync("mysql_install_db", [
                "--user=node",
                "--ldata=" + this.mariadbDataDir,
            ]);

            if (result.status !== 0) {
                let error = result.stderr.toString("utf-8");
                log.error("mariadb", error);
                return;
            } else {
                log.info("mariadb", "嵌入式 MariaDB: mysql_install_db done:" + result.stdout.toString("utf-8"));
            }
        }

        if (!fs.existsSync(this.runDir)) {
            log.info("mariadb", `嵌入式 MariaDB: ${this.runDir} 没找到,将创建一个.`);
            fs.mkdirSync(this.runDir, {
                recursive: true,
            });
        }

    }

    /**
     * Initialise the "kuma" database in mariadb if it does not exist
     * @returns {Promise<void>}
     */
    async initDBAfterStarted() {
        const connection = mysql.createConnection({
            socketPath: this.socketPath,
            user: "node",
        });

        let result = await connection.execute("CREATE DATABASE IF NOT EXISTS `kuma`");
        log.debug("mariadb", "CREATE DATABASE: " + JSON.stringify(result));

        log.info("mariadb", "嵌入式 MariaDB 已准备好连接");
        this.started = true;
    }

}

module.exports = {
    EmbeddedMariaDB,
};
