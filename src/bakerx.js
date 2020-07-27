const SshConnector = require('./ssh');
const child_process = require('child_process');

class BakerxConnector extends SshConnector {
    constructor(name) {
        const sshInfoStdout = child_process.spawnSync(`bakerx ssh-info ${name} --format json`,
            { encoding: 'utf-8', shell: true }).stdout;
        if (sshInfoStdout.includes('Could not locate VM called')) {
            throw `Could not locate VM called ${name}`;
        }

        const sshConfig = JSON.parse(sshInfoStdout);
        super(`${sshConfig.user}@${sshConfig.hostname}:${sshConfig.port}`, sshConfig.private_key);
        this.type = 'bakerx';
    }
}

module.exports = BakerxConnector;
