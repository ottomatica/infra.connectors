const fs         = require('fs-extra');
const { Client } = require('ssh2');
const chalk      = require('chalk');

class SSHConnector {
    constructor(userHost, private_key) {
        let userHostSplit = userHost.split(/[@:]+/);
        // TODO: better validation
        if (userHostSplit.length < 2) { throw new Error(`Couldn't parse provided host information. Correct format is 'user@hostname:port'`); }
        this.sshConfig = {
            user: userHostSplit[0],
            hostname: userHostSplit[1],
            port: userHostSplit[2] || 22,
            private_key,
        };
    }

    async getName(context) {
        return context.bakerPath.split('@')[0];
    }

    async getContainerIp(_context) {
        return this.sshConfig.hostname;
    }

    async ready() {
        let counter = 0;
        while (counter++ <= 5) {
            try {
                await new Promise((resolve, reject) => {
                   var conn = new Client();
                   conn.on('ready', function () {
                       // console.log('Client :: ready');
                       resolve(true);
                   }).on('error', function (err) {
                       reject(err);
                   }).connect({
                       host: this.sshConfig.hostname,
                       port: this.sshConfig.port,
                       username: this.sshConfig.user,
                       privateKey: fs.readFileSync(this.sshConfig.private_key),
                       readyTimeout: 20000,
                   });
                });
                return;
            } catch (e) {
                // console.log(`ready error: ${e}`);
            }
        }
    }

    async setup(context, setup) {
        if (setup && setup.cmd) {
            const cmd = `echo $$; exec ${setup.cmd}`;
            let data = await this._JSSSHExec(cmd, this.sshConfig, 5000, false, { setup })
            // format will be PID\nsetup.wait_for\n
            try {
                let pid = data.stdout.split('\n')[0];
                console.log(`\tResolved wait_for condition: Stdout matches "${setup.wait_for}"`);
                return pid;
            } catch (err) {
                console.error(chalk.red('\t=> Failed to run the command and store the PID'));
                return;
            }
        }
    }

    // Execute and return pid
    async spawn(cmd, options) {
        return new Promise(async (resolve, reject) => {
            let cmdWithPid = `echo $$; exec ${cmd}`;
            if( options.cwd )
            {
                cmdWithPid = `echo $$; cd ${options.cwd}; exec ${cmd}`;
            }
            let sshOptions = {setup: {wait_for: ""}};
            let data = await this._JSSSHExec(cmdWithPid, this.sshConfig, 5000, true, sshOptions);
            // format will be PID\nsetup.wait_for\n
            try {
                let pid = data.stdout.split('\n')[0];
                resolve({pid: pid, output: data });
            } catch (err) {
                console.error(chalk.red('\t=> Failed to run the command and store the PID'));
                reject( {error: err} );
            }
        });
    }

    async tearDown(pid) {
        if (pid) {
            // 'SIGINT'
            console.log('\tTearing down');
            await this.exec('', `kill ${pid}`);
        }
    }

    async exec(cmd) {
        let result = await this._JSSSHExec(cmd + '\n echo $?', this.sshConfig);
        let exitCode = Number(result.stdout.trimRight().split('\n').slice(-1)[0].replace(/s+/, ''));
        result.stdout = result.stdout.trimRight().split('\n').slice(0,-1).join('\n');
        result = {...result, exitCode}
        return result;
    }

    /**
     * Execute commands in an interactive shell
     * @param {string} cmd command to run
     * @param {string} id optionally give the session an id
     * @param {number} timeout kill the session after x seconds (use false to disable 10m default)
     */
    async execPersistent(cmd, id = process.pid, timeout = 600) {
        // ensure screen exists
        await this._JSSSHExec(`screen -list | grep "${id}" || screen -dmS ${id}`, this.sshConfig);
        if (timeout) this._JSSSHExec(`screen -list | grep "${id}" && (sleep ${timeout}; screen -S ${id} -X quit)`, this.sshConfig);

        cmd = `
            screen -S ${id} -X stuff '${cmd.replace("'", "\'").replace('$', '\\$')} >/tmp/cmd.stdout 2>/tmp/cmd.stderr\n'
            screen -S ${id} -X stuff 'echo $? >> /tmp/cmd.stdout\n'
            cat /tmp/cmd.stderr > /dev/stderr
            cat /tmp/cmd.stdout > /dev/stdout`;

        let result = await this._JSSSHExec(cmd, this.sshConfig)

        let exitCode = Number(result.stdout.trimRight().split('\n').slice(-1)[0].replace(/s+/, ''));
        result.stdout = result.stdout.trimRight().split('\n').slice(0, -1).join('\n');
        result = { ...result, exitCode }
        return result;
    }

    async _JSSSHExec(cmd, sshConfig, timeout = 20000, verbose = false, options = { count: 20 }) {
        let stdout = '';
        let stderr = '';

        return new Promise((resolve, reject) => {
            let c = new Client();
            const self = this;
            c
                .on('ready', () => {
                    c.exec(cmd, options, (err, stream) => {
                        if (err) {
                            console.error(err);
                            reject(err);
                        }
                        stream
                            .on('close', (code, signal) => {
                                if (verbose) {
                                    console.log("closing stream");
                                }
                                c.end();
                                resolve({stdout, stderr});
                            })
                            .on('data', (data) => {
                                if (verbose) {
                                    process.stdout.write(data);
                                }
                                stdout += data;
                                if (options.setup && data.includes(options.setup.wait_for)) {
                                    c.end();
                                    resolve({stdout, stderr});
                                }
                            })
                            .stderr.on('data', (data) => {
                                if (verbose) {
                                    process.stderr.write(data);
                                }
                                stderr += data;
                            });
                    });
                }).on('error', (err) => {
                    if (options.count === 0) {
                        console.error(chalk.red(' => Host is not ready'));
                        return process.exit(1);
                    } else {
                        options.count -= 1;
                    }

                    if (err.message.indexOf('ECONNREFUSED') > 0) {
                        // Give vm 5 more seconds to get ready
                        console.log(`Waiting 5 seconds for ${sshConfig.hostname}:${sshConfig.port} to be ready`);
                        setTimeout(async () => {
                            resolve(await self._JSSSHExec(cmd, sshConfig, timeout, verbose, options));
                        }, timeout);
                    } else {
                        reject(err);
                    }
                })
                .connect({
                    host: sshConfig.hostname,
                    port: sshConfig.port,
                    username: sshConfig.user,
                    privateKey: fs.readFileSync(sshConfig.private_key),
                    readyTimeout: timeout,
                });
        });
    }

    async isReachable(host, context) {
        let output = (await this.exec(context, `ping -c 3 ${host}`));
        if (!(output.includes('nknown host') || !output.includes('cannot resolve'))) {
            // Domain checks out
            return true;
        }
        // Url is reachable
        // See: https://stackoverflow.com/questions/10060098/getting-only-response-header-from-http-post-using-curl , https://stackoverflow.com/questions/47080853/show-the-final-redirect-headers-using-curl
        return (await this.exec(context, `curl -sL -D - ${host} -o /dev/null | grep 'HTTP/1.1' | tail -1`)).includes('200 OK');
    }

    async pathExists(path, context) {
        return (await this.exec(context, `[ ! -e ${path} ] || echo 'file exists'`)).includes('file exists');
    }

    async contains(context, file, string, expect = true) {
        let output;
        if (!(await this.pathExists(file, context))) {
            throw Error('file doesn\'t exist');
        }

        try {
            output = (await this.exec(context, `cat ${file} | grep '${string}'`));
        } catch (error) {
            output = error;
        }

        let contains = output.includes(string);

        return contains === expect;
    }

    checkVirt() {
        return 'TODO'; // TODO: add shell command for checking virtualization.
    }

    async getCPUCores(context) {
        return (await this.exec(context, 'nproc --all')).trim();
    }

    async getMemory(context) {
        return (await this.exec(context, `grep MemTotal /proc/meminfo | awk '{print $2 / 1024 / 1024}'`)).trim();
    }

    async getDiskSpace(context, diskLocation) {
        return (await this.exec(context, `df --output=avail -h  ${diskLocation} | grep -P '\\d+.\\d+' -o`)).trim();
    }
}

// Export factory class
module.exports = SSHConnector;
