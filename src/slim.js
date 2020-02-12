const fs            = require('fs-extra');
const path          = require('path');
const child_process = require('child_process');
const os            = require('os');

const privateKey = path.join(os.homedir(), '.slim', 'baker_rsa');
const VBexe = process.platform === 'win32' ? '"C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe"' : 'VBoxManage';

const SshConnector = require('./ssh');

class SlimConnector extends SshConnector {
    constructor(VMName, opts) {
        super(`root@ottomatica`, privateKey);
        this.VMName = VMName;
        this.provider = opts.provider || 'virtualbox';
        this.type = 'slim';
    }

    async getName() {
        return this.VMName;
    }

    async getSSHConfig() {
        let info, port;
        switch (this.provider) {
            case 'kvm':
                port = await this._KVMSSH_port(this.VMName);
                break;
            case 'virtualbox':
            default:
                info = await this._VBoxProvider_info();
                Object.keys(info).forEach((key) => {
                    if (info[key].includes('guestssh')) {
                        port = parseInt(info[key].split(',')[3]);
                    }
                });
                break;
        }
        return {
            user: 'root', port, host: 'nanobox', hostname: '127.0.0.1', private_key: privateKey,
        };
    }

    async build(file)
    {
        child_process.execSync(`slim build ${file} -p ${this.provider}`, {stdio:"inherit"});
    }

    async delete(name)
    {
        child_process.execSync(`slim delete vm ${name} -p ${this.provider}`, {stdio:"inherit"});
    }

    async provision(name, imagePath, options = {})
    {
        let memory = options.memory ? `--memory=${options.memory}` : "";
        let cpus = options.cpus ? `--cpus=${options.cpus}` : "";
        
        child_process.execSync(`slim run ${name} ${imagePath} -p ${this.provider} ${memory} ${cpus}`, {stdio:"inherit"});
    }

    async isImageAvailable(image)
    {
        let output = child_process.execSync(`slim images`).toString();
        return output.indexOf(image) > -1;
    }

    async ready() {
        this.sshConfig = await this.getSSHConfig();
        return super.ready();
    }

    async _VBoxProvider_info() {
        return new Promise(((resolve, reject) => {
            child_process.exec(`${VBexe} showvminfo ${this.VMName} --machinereadable`, (error, stdout, stderr) => {
                if (error && stderr.indexOf('VBOX_E_OBJECT_NOT_FOUND') !== -1) {
                    resolve({ VMState: 'not_found' });
                } else if (error) {
                    console.error(`=> ${error}, ${stderr}`);
                    reject(error);
                } else {
                    let properties = {};
                    let lines = stdout.split('\n');
                    for (let i = 0; i < lines.length - 1; i++) {
                        let lineSplit = lines[i].split('=');
                        let name = lineSplit[0].trim();
                        let id = lineSplit[1].trim();
                        properties[name] = id;
                    }
                    resolve(properties);
                }
            });
        }));
    }

    async _KVMProvider_info(name) {
        return new Promise((resolve, reject) => {
            child_process.exec(`virsh -c qemu:///session dominfo ${name}`, (err, stdout, stderr) => {
                if (err && stderr.indexOf('failed to get domain') !== -1) {
                    resolve({ VMState: 'not_found' });
                } else if (err) {
                    console.error(`=> ${err}, ${stderr}`);
                    reject(err);
                } else {
                    let props = {};
                    stdout.trim()
                        .split('\n')
                        .map(l => l.split(':').map(e => e.trim()))
                        .reduce((o, [k, v]) => {
                            o[k] = v;
                            return o;
                        }, props);
                    resolve(props);
                }
            });
        });
    }

    async _KVMSSH_port(name) {
        let re = /^.+hostfwd=tcp::(\d+)-:22.+$/gm;
        let xml = child_process.execSync(`virsh -c qemu:///session dumpxml ${name}`);
        let [, port, ] = re.exec(xml);

        return port;
    }

    /**
     * Returns State of a VM
     * @param {String} VMName
     */
    async getState(VMName) {
        let state, info;
        switch (this.provider) {
            case 'kvm':
                info = await this._KVMProvider_info(VMName);
                state = info.State;
                break;
            case 'virtualbox':
            default:
                info = await this._VBoxProvider_info(VMName);
                state = info.VMState.replace(/"/g, '');
                break;
        }
        return state;
    }

    async exec(cmd) {
        this.sshConfig = await this.getSSHConfig();
        return super.exec(cmd);
    }

    async execPersistent(cmd, id = process.pid, timeout = 600) {
        this.sshConfig = await this.getSSHConfig();
        return super.execPersistent(cmd, id, timeout);
    }
}

// Export factory class
module.exports = SlimConnector;
