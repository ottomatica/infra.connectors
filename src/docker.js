const Docker = require('dockerode');
const stream = require('stream');
const chalk  = require('chalk');
const tar = require('tar');
const path = require('path');
const Connector = require('./connector');

class DockerConnector extends Connector {
    constructor(container) {
        super('docker@', 'privateKey@');
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
        this.containerId = container;
        this.type = 'docker';
    }

    async pull(imageName) {
        let self = this;
        // console.log( `pulling ${imageName}`);
        process.stdout.write(`pulling ${imageName} `);
        return new Promise((resolve, reject) => {
            self.docker.pull(imageName, (error, stream) => {
                self.docker.modem.followProgress(stream, (error, output) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    process.stdout.write('... pulled\n');
                    resolve(output);
                }, event => console.log(event));
            });
        });
    }

    async setup(_context, _setup) {
        // TODO:
    }

    async getContainerIp(context) {
        const container = this.docker.getContainer(context.name);
        const data = await container.inspect();
        return data.NetworkSettings.IPAddress;
    }

    async run(image, cmd) {
        await this.docker.createContainer({
            name: this.containerId,
            Image: image,
            AttachStdin: false,
            AttachStdout: true,
            AttachStderr: true,
            Tty: true,
            Cmd: Array.isArray(cmd) ? cmd : [cmd],
            OpenStdin: false,
            StdinOnce: false,
        }).then(container => container.start());
    }

    async delete() {
        const container = this.docker.getContainer(this.containerId);
        return await container.remove({ force: true });
    }

    async ready() {
        let isReady = false;
        const containerExists = await this.containerExists();

        if(containerExists) {
            const container = this.docker.getContainer(this.containerId);
            isReady = (await container.inspect()).State.Running;
        }

        return isReady;
    }

    setCWD(cwd){
        this.cwd = cwd;
    }

    getCWD(){
        return this.cwd;
    }

    async containerExists() {
        let containerExists = false;
        try {
            let runningContainers = await this.docker.listContainers({ all: false });
            containerExists = runningContainers.filter(container => container.Id.includes(this.containerId) || container.Names.includes(`/${this.containerId}`)).length > 0;
        } catch (err) {
            console.error(chalk.red(' => Docker is not running so can\'t check for any matching containers.'));
        }
        return containerExists;
    }

    async scp(src, dest) {
        let destContainer = this.docker.getContainer(this.containerId);

        destContainer.putArchive(tar.c({ gzip: false, follow: true, cwd: path.dirname(src) }, [path.basename(src)]), { path: dest }, (writeError, writeStream) => {
            if (writeError)
                throw writeError;
        });
    }

    async getState() {
        try {
            if (await this.ready())
                return 'ready';
            else
                return 'timed out';
        } catch (err) {
            console.log('err', err);
            return 'timed out';
        }
    }

    async exec(cmd) {
        const self = this;
        return new Promise(((resolve, reject) => {
            let options = {
                Cmd: ['bash', '-c', cmd],
                // Cmd: ['bash', '-c', 'echo test $VAR'],
                // Env: ['VAR=ttslkfjsdalkfj'],
                AttachStdout: true,
                AttachStderr: true,
            };
            let container = self.docker.getContainer(self.containerId);
            
            let stdoutStream = new stream.PassThrough();
            let stdout = '';
            stdoutStream.on('data', (chunk) => {
                stdout += chunk.toString('utf8');
            });

            let stderrStream = new stream.PassThrough();
            let stderr = '';
            stderrStream.on('data', (chunk) => {
                stderr += chunk.toString('utf8');
            });

            container.exec(options, (err, exec) => {
                if (err) return;
                exec.start((err, stream) => {
                    if (err) return;

                    container.modem.demuxStream(stream, stdoutStream, stderrStream);
                    stream.on('end', async () => {
                        stdoutStream.destroy();

                        const exitCode = (await exec.inspect()).ExitCode;

                        resolve({stdout, stderr, exitCode});
                    });
                });
            });
        }));
    }

    async isReachable(host, context) {
        //TODO
        return "Docker";
    }
}

// Export factory class
module.exports = DockerConnector;
