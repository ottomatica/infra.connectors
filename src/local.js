const child_process = require('child_process');
const fs = require('fs-extra');
const os = require('os');
const si = require('systeminformation');
const checkDiskSpace = require('check-disk-space');
const got = require('got');
const path = require('path');


class LocalConnector {

    constructor() 
    {
        this.cwd = '.';
        this.type = 'local';
    }

    setCWD(cwd){
        this.cwd = cwd;
    }

    getCWD(){
        return this.cwd;
    }

    async getContainerIp() {
        return 'localhost';
    }

    async getName() {
        return 'localhost';
    }

    async ready() {
        // If using local connector, localhost is always ready
        return true;
    }

    async getState(VMName) {
        return "running";
    }

    async setup(context, setup) {
        return new Promise(((resolve, reject) => {
            if (setup && setup.cmd) {
                console.log(`\tSetup: ${setup.cmd}`);
                let child = child_process.spawn(`${setup.cmd}`, {
                    shell: true,
                });

                child.stderr.on('data', (error) => {
                    console.error(error);
                    reject({ error });
                });

                child.stdout.on('data', (data) => {
                    // console.log('\n\n\n\n\n', data);
                    if (setup.wait_for) {
                        if (data.indexOf(setup.wait_for) !== -1) {
                            console.log(`\tResolved wait_for condition: Stdout matches "${setup.wait_for}"`);
                            resolve({ child });
                        }
                    }
                });
            }
        }));
    }

    async tearDown(obj) {
        if (obj && obj.child) {
            // 'SIGINT'
            console.log('\tTearing down');
            obj.child.stdout.removeAllListeners('data');
            obj.child.stdin.write('\x03');
            obj.child.kill();
        }
    }

    async cp(src, dest) {
        return fs.promises.copyFile(src, dest);
    }

    async scp(src, dest) {
        return this.cp(src, dest);
    }

    async exec(cmd, options = { pipefail: true }) {
        if (options.pipefail && os.platform() != "win32" ) cmd = 'set -o pipefail; ' + cmd;

        const { status, stdout, stderr, error } = child_process.spawnSync(cmd, { shell: true, cwd: this.cwd });
        return {
            exitCode: status != undefined ? status : 1,
            stdout: stdout ? stdout.toString() : '',
            stderr: stderr ? stderr.toString() : (error.message || '')
        }
    }

    // Execute and return pid
    async spawn(cmd, options) {
        return new Promise((resolve, reject) => {
            options = options || {};
            options.shell = true;
            options.cwd = this.cwd;
            let child = child_process.spawn(cmd, options);

            child.stderr.on('data', (error) => {
                console.error(error);
                reject({ error });
            });

            // child.stdout.on('data', (data) => {
            //     console.log(data);
            // });
            resolve({pid: child.pid });
        });
    }

    async resolveHost(host) {
        return false;
    }

    async isReachable(address, context) {

        //prepend http for domains
        if (!/^[a-z]+:\/\//.test(address)) 
        {
            address = "http://" + address;
        }
 
        try {
            return (await got(address, { followRedirect: true, https: { rejectUnauthorized: false } })).statusCode == 200;
        } catch (err) {
            return false;
        }
    }

    async pathExists(destPath, context) {
        return fs.pathExists(this.resolvePath(destPath));
    }

    async contains(context, file, string, expect) {
        if (await this.pathExists(file)) {
            return expect === (await fs.readFile(this.resolvePath(file))).includes(string);
        }
        throw Error('file doesn\'t exist');
    }

    checkVirt() {
        let status = null;
        if (os.platform() === 'win32') {
            let output = child_process.execSync('systeminfo');
            if (output && output.toString().indexOf('Virtualization Enabled In Firmware: Yes') !== -1) {
                status = true;
            } else {
                status = false;
            }
        } else if (os.platform() === 'darwin') {
            let output = child_process.execSync('sysctl -a | grep machdep.cpu.features');
            if (output && output.toString().indexOf('VMX') !== -1) {
                status = true;
            } else {
                status = false;
            }
        } else if (os.platform() === 'linux') {
            let output = null;
            try {
                output = child_process.execSync("cat /proc/cpuinfo | grep -E -c 'svm|vmx'");
            } catch (err) { 
                output = err.stdout.toString();
            }
            
            if (output != 0) {
                status = true;
            } else {
                status = false;
            }
        }
        return status;
    }

    checkHyperV() {
        if (os.platform() === 'win32') {
            let output = child_process.execSync('systeminfo');
            if (output && output.toString().includes('A hypervisor has been detected. Features required for Hyper-V will not be displayed.')) {
                return true;
            } else {
                return false;
            }
        }
        return false;
    }

    async getCPUCores(_context) {
        return (await si.cpu()).cores;
    }

    async getMemory(_context) {
        return Math.floor((await si.mem()).total / 1024000000);
    }

    async getDiskSpace(_context, diskLocation) {
        return Math.floor((await checkDiskSpace(diskLocation)).free / 1024000000);
    }

    resolvePath(destPath) {
        if (!destPath) return destPath;
        if (destPath.slice(0, 2) !== '~/') return path.resolve(destPath);
        return path.resolve(path.join(os.homedir(), destPath.slice(2)));
    }
}

// Export factory class
module.exports = LocalConnector;
