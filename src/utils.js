const path = require('path');
const os = require('os');
const fs   = require('fs');
const child = require('child_process');

class Utils {
    static resolvePath(destPath) {
        if (!destPath) return destPath;
        if (destPath.slice(0, 2) !== '~/') return path.resolve(destPath);
        return path.resolve(path.join(os.homedir(), destPath.slice(2)));
    }

    static scp(src, destFile, sshConfig) {
        let scpArgs = [];
        let port = sshConfig.port;
        let identifyFile = this.resolvePath(sshConfig.private_key);
        let dest = `${sshConfig.user}@${sshConfig.hostname}:${destFile}`;

        scpArgs.push(`-q`);
        scpArgs.push(`-P`);
        scpArgs.push(`${port}`);
        scpArgs.push(`-i`);
        scpArgs.push(`"${identifyFile}"`)
        scpArgs.push(`-o`);
        scpArgs.push(`StrictHostKeyChecking=no`);
        scpArgs.push(`-o`);
        scpArgs.push(`UserKnownHostsFile=/dev/null`);
        if( fs.existsSync(src) && fs.lstatSync(src).isDirectory() )
        {
            scpArgs.push("-r");            
        }
        scpArgs.push(`"${src}"`);
        scpArgs.push(`"${dest}"`);

        // console.log(scpArgs);
        return child.spawnSync(`scp`, scpArgs, {shell: true});
    }
}

module.exports = Utils;