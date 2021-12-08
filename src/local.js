const child_process = require('child_process');
const fs = require('fs-extra');
const os = require('os');
const si = require('systeminformation');
const checkDiskSpace = require('check-disk-space');
const got = require('got');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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
        return "ready";
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

    async readFile(src) {
        return (await fs.promises.readFile(src)).toString();
    }

    async writeTempFile(name, content) {
        let scriptPath = path.join(os.tmpdir(), uuidv4() + name );
        await fs.promises.writeFile( scriptPath,
`
${content}
`);
        return scriptPath;
    }

    async cp(src, dest) {
        return fs.promises.copyFile(src, dest);
    }

    async scp(src, dest) {
        return this.cp(src, dest);
    }

    /* strategy for supporting multiple lines in windows */
    async execMultiLine(cmd) {

        let stdout = "";
        let stderr = "";
        let self = this;
        return new Promise(function(resolve, reject)
        {
            let child = child_process.spawn("Cmd.exe",  ['/q', '/K'], 
                { cwd: self.cwd, shell: true });

            let lines = cmd.split(/\r?\n/g);

            child.stdin.write('@echo off\n');
            child.stdin.write('echo.\n');

            for( let line of lines )
            {
                if( !line.endsWith('\n') )
                    line = line + '\n';
                child.stdin.write(line);
            }

            child.stdout.on('data', (data) => {
                stdout+=data;
            });
            
            child.stderr.on('data', (data) => {
                stderr+=data;
            });

            child.on('error', (err) => {
                resolve({stdout: stdout, stderr: err.message, exitCode: code});
            });


            child.on('close', (code) => {
                let patchStdout = stdout.split(/r?\n/g).slice(1).join('\n');
                resolve({stdout: patchStdout, stderr: stderr, exitCode: code})
            });

            child.stdin.end();

        });

    }

    shouldUseMultiLine(cmd) {
        if( os.platform() == 'win32' && cmd.indexOf('\n') > 0 )
        {
            // don't do things meant to be run in scripts/other shells
            if( cmd.indexOf("powershell") >= 0 || cmd.indexOf("bash") >= 0 )
            {
                return false;
            }
            return true;
        }
        return false;
    }
    

    async exec(cmd, options ) {
        options = options || {};

        if (options.pipefail && os.platform() != "win32" ) cmd = 'set -o pipefail; ' + cmd;

        if( this.shouldUseMultiLine(cmd) )
        {
            return await this.execMultiLine(cmd);
        }
        else
        {
            const { status, stdout, stderr, error } = child_process.spawnSync(cmd, 
                { shell: true, cwd: this.cwd });
            return {
                exitCode: status != undefined ? status : 1,
                stdout: stdout ? stdout.toString() : '',
                stderr: stderr ? stderr.toString() : (error.message || '')
            }
        }
    }

    async stream(cmd, onProgress, options)
    {
        options = options || {};

        if (options.pipefail && os.platform() != "win32" ) cmd = 'set -o pipefail; ' + cmd;

        let child = child_process.spawn(cmd, { shell: true, cwd: this.cwd });

        return new Promise(function(resolve, reject)
        {
           let stdout="", stderr="";

            // Collect stdout and stderr as it happens.
            // Send callback progress.
            child.stdout.on('data', (data) => {
                stdout += data;
                onProgress(data);
            });
            child.stderr.on('data', (data) => {
                stderr += data;
                onProgress(data);
            });

            // Usually an error related to creating process.
            child.on('error', function(err)
            {
                resolve({
                    exitCode: 1,
                    stdout: '',
                    stderr: (err.message || 'Failure to create command')
                });
            })

            // Finished command, we can resolve progress with final results.
            child.on('exit', (code) => {
                resolve({
                    exitCode: code,
                    stdout: stdout ? stdout.toString() : '',
                    stderr: stderr ? stderr.toString() : ''
                });
            });
        });        
    }

    // Execute and return pid
    async spawn(cmd, options) {
        return new Promise((resolve, reject) => {
            options = options || {};
            options.shell = true;
            options.cwd = this.cwd;
            let child = child_process.spawn(cmd, options);

            if (options.stdio != "ignore" )
            {
                // child.stderr.on('data', (error) => {
                //     console.error(error.toString());
                //     reject({err: error.toString() });
                // });
            }

            if( options.detached )
            {
                // explicitly detach from parent so parent does not wait on us.
                child.unref();
            }

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
            let {success,output} = this._executeCommand('systeminfo');
            status = output.includes('Virtualization Enabled In Firmware: Yes');

        } else if (os.platform() === 'darwin') {
            let {success,output} = this._executeCommand('sysctl -a | grep machdep.cpu');
            if( !success ) {
                return false;
            }
            status = output.includes('VMX') || output.includes(".brand_string: Apple M1");

        } else if (os.platform() === 'linux') {
            let {success, output} = this._executeCommand("cat /proc/cpuinfo | grep -E -c 'svm|vmx'");
            status = !output.includes("0");            
        }
        return status;
    }

    _executeCommand(cmd) {
        let output="";
        let success = false;
        try {
            output = child_process.execSync(cmd);
            success = true;
        } catch(err) {
            output = err;
        }
        return {success: success, output: output.toString()}
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
