const fs            = require('fs-extra');
const path          = require('path');
const child_process = require('child_process');
const os            = require('os');

const privateKey = path.join(os.homedir(), '.slim', 'baker_rsa');
const VBexe = process.platform === 'win32' ? '"C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe"' : 'VBoxManage';

const SshConnector = require('./ssh');

class SlimConnector extends SshConnector {
    constructor(VMName) {
        super(`${VMName}@ottomatica`, privateKey);
        this.VMName = VMName;
    }

    async getName() {
        return this.VMName;
    }

    async getSSHConfig() {
        let vmInfo = await this._VBoxProvider_info();
        let port = null;
        Object.keys(vmInfo).forEach((key) => {
            if (vmInfo[key].includes('guestssh')) {
                port = parseInt(vmInfo[key].split(',')[3]);
            }
        });
        return {
            user: 'root', port, host: 'nanobox', hostname: '127.0.0.1', private_key: privateKey,
        };
    }

    async build(file)
    {
        child_process.execSync(`slim build ${file}`, {stdio:"inherit"});
    }

    async delete(name)
    {
        child_process.execSync(`slim delete vm ${name}`, {stdio:"inherit"});
    }

    async provision(name, imagePath)
    {
        child_process.execSync(`slim run ${name} ${imagePath}`, {stdio:"inherit"});
    }

    async isImageAvailable(image)
    {
        let output = child_process.execSync(`slim images`);
        return output.contains(image);
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

    /**
     * Returns State of a VM
     * @param {String} VMName
     */
    async getState(VMName) {
        let vmInfo = await this._VBoxProvider_info(VMName);
        return vmInfo.VMState.replace(/"/g, '');
    }

    async exec(cmd) {
        this.sshConfig = await this.getSSHConfig();

        return super.exec(cmd);
    }
}

// Export factory class
module.exports = SlimConnector;
