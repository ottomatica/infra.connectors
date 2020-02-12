const fs            = require('fs-extra');
const path          = require('path');
const child_process = require('child_process');
const yaml          = require('js-yaml');

const boxes = path.join(require('os').homedir(), '.baker');
const bakerForMacPath = process.platform === 'darwin' ? path.join(require('os').homedir(), 'Library', 'Baker', 'BakerForMac') : undefined;
const privateKey = process.platform === 'darwin' ? path.join(bakerForMacPath, 'baker_rsa') : path.join(boxes, 'baker_rsa');
const VBexe = process.platform === 'win32' ? '"C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe"' : 'VBoxManage';

const SshConnector = require('./ssh');

class BakerConnector extends SshConnector {
    constructor(context) {
        super('baker@', privateKey);
        this._bakerDoc = null;

        this.context = context;
        this.type = 'baker';
    }

    async getOrLoadBakerYaml() {
        if (!this.context.bakerPath) {
            throw new Error('No bakerPath provided in context object');
        }
        if (!this._bakerDoc) {
            this._bakerDoc = yaml.safeLoad(await fs.readFile(path.join(this.context.bakerPath, 'baker.yml'), 'utf8'));
        }
        return this._bakerDoc;
    }

    async getName() {
        let doc = await this.getOrLoadBakerYaml(this.context);
        if (doc && doc.name) {
            return doc.name;
        }
        throw new Error(`No name defined in baker file in ${this.context.bakerPath}`);
    }

    async getContainerIp() {
        let doc = await this.getOrLoadBakerYaml(this.context);
        if (doc.vm && doc.vm.ip) {
            return doc.vm.ip;
        }
        throw new Error(`No ip defined in baker file in ${this.context.bakerPath}`);
    }

    async getSSHConfig(machine, _nodeName) {
        let vmInfo = await this._VBoxProvider_info(machine);
        let port = null;
        Object.keys(vmInfo).forEach((key) => {
            if (vmInfo[key].includes('guestssh')) {
                port = parseInt(vmInfo[key].split(',')[3]);
            }
        });
        return {
            user: 'vagrant', port, host: machine, hostname: '127.0.0.1', private_key: privateKey,
        };
    }

    async _VBoxProvider_info(vmname) {
        return new Promise(((resolve, reject) => {
            child_process.exec(`${VBexe} showvminfo ${vmname} --machinereadable`, (error, stdout, stderr) => {
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

    async setup(context, setup) {
        return await new Promise(((resolve, reject) => {
            if (setup && setup.cmd) {
                console.log(`\tSetup: ${setup.cmd}`);
                let child = child_process.spawn(`cd ${this.context.bakerPath} && ${setup.cmd}`, { shell: true });
                child.stderr.on('data', (error) => {
                    console.error(error);
                    reject({ error });
                });

                child.stdout.on('data', (data) => {
                    if (setup.wait_for) {
                        if (data.toString().indexOf(setup.wait_for) !== -1) {
                            console.log(`\tResolved wait_for condition: Stdout matches "${setup.wait_for}"`);
                            resolve({ child });
                        }
                    }
                });
            }
        }));
    }

    async ready() {
        const name = await this.getName(this.context);
        const state = await this.getState(name);
        if (state !== 'running') throw Error(`Baker environment is not running or doesn't exist: ${name}`);
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

    async exec(cmd) {
        let name = await this.getName(this.context);
        this.sshConfig = await this.getSSHConfig(name);
        return super.exec(cmd);
    }
}

// Export factory class
module.exports = BakerConnector;
