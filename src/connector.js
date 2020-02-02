class Connector {
    constructor() { }

    async contains(context, file, string, expect = true) {
        let output;
        if (!(await this.pathExists(file, context))) {
            throw Error('file doesn\'t exist');
        }

        try {
            output = (await this.exec(`cat ${file} | grep '${string}'`)).stdout;
        } catch (error) {
            output = error;
        }

        let contains = output.includes(string);

        return contains === expect;
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
