class Connector {
    constructor() { }

    async contains(context, file, string, expect = true) {
        let output;
        if (!(await this.pathExists(file, context)).status) {
            throw Error('file doesn\'t exist');
        }

        try {
            output = (await this.exec(`cat ${file} | grep -- '${string}'`)).stdout;
        } catch (error) {
            output = error;
        }

        let contains = output.includes(string);

        return contains === expect;
    }


    // NOTE: this is from opunit and should be removed after refactoring:
    /**
     * 
     * @param {string} path path to the file
     * @param {string} permission check read/write/execute permission `rwx`
     */
    async pathExists(path, context, permission) {

        path = path.replace(/^~/, '$HOME');
        let fileExists = !(await this.exec(`[ -e "${path}" ] || echo '!e'`)).stdout.includes('!e');
        let actualPermission;
        if(fileExists && permission)
            actualPermission = (await this.exec(`stat -c '%a' ${path}`)).stdout;

        let status = fileExists && permission ? actualPermission == permission : fileExists;

        return {
            status, 
            expected: permission,
            actual: fileExists ? actualPermission : 'Not found'
        }
    }

    async checkVirt(context) {
        if((await this.exec("cat /proc/cpuinfo | grep -E -c 'svm|vmx'")).stdout != 0){
            return true;
        }
	    return false;
    }

    async getCPUCores(context) {
        return (await this.exec('nproc --all')).stdout.trim();
    }

    async getMemory(context) {
        return (await this.exec(`grep MemTotal /proc/meminfo | awk '{print $2 / 1024 / 1024}'`)).stdout.trim();
    }

    async getDiskSpace(context, diskLocation) {
        return (await this.exec(`df --output=avail -h  ${diskLocation} | grep -P '\\d+.\\d+' -o`)).stdout.trim();
    }
}

// Export factory class
module.exports = Connector;
