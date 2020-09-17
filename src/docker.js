const Docker = require('dockerode');
const stream = require('stream');
const chalk  = require('chalk');
const tar = require('tar');
const path = require('path');
const Connector = require('./connector');

class DockerConnector extends Connector {
    constructor(container) {
        super('docker@', 'privateKey@');
        this.docker = new Docker();
        this.containerId = container;
        this.type = 'docker';
    }

    async pull(imageName, onProgress, verbose = true) {
        let self = this;
        // console.log( `pulling ${imageName}`);
        process.stdout.write(`pulling ${imageName} `);
        return new Promise((resolve, reject) => {
            self.docker.pull(imageName, async (error, stream) => {
                
                if (error) { reject(error); }
                
                let onFinished = (error, output) => {
                    if (error) {
                        reject(error);
                    }
                    process.stdout.write('... pulled\n');
                    resolve(output);
                }

                if( onProgress == undefined ) 
                {
                    onProgress = (data) => { if(verbose){ console.log(data) }};
                }

                self.docker.modem.followProgress(stream, onFinished, onProgress);
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
            let runningContainers = await this.docker.listContainers({ all: true });
            containerExists = runningContainers.filter(container => container.Id.includes(this.containerId) || container.Names.includes(`/${this.containerId}`)).length > 0;
        } catch (err) {
            console.error(chalk.red(' => Docker is not running so can\'t check for any matching containers.'));
        }
        return containerExists;
    }

    async readFile(src) {
        let result = await this.exec( `cat ${src}`);
        return result.stdout;
    }

    async writeTempFile(name, content) {
        let result = await this.exec( 
`
tmpfile=$(mktemp)
cat << 'DOCABLE_END_DOC' > $tmpfile-${name}
${content}
DOCABLE_END_DOC
echo -e $tmpfile-${name}
`);
        return result.stdout.trim();
    }

    async scp(src, dest) {
        let destContainer = this.docker.getContainer(this.containerId);

        destContainer.putArchive(tar.c({ gzip: false, follow: true, cwd: path.dirname(src) }, [path.basename(src)]), { path: path.dirname(dest) }, (writeError, writeStream) => {
            if (writeError)
            throw writeError;
        });

        await this.exec(`mv ${path.dirname(dest)}/${path.basename(src)} ${dest}`);
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

    async exec(cmd, options) {
        return this._exec(cmd, () => {}, options);
    }

    async stream(cmd, onProgress) {
        return this._exec(cmd, onProgress)
    }

    async _exec(cmd, onProgress, execOptions) {
        execOptions = execOptions || {};

        if( execOptions.pipefail ) {
            cmd = 'set -o pipefail; ' + cmd;
        }
 
        const self = this;
        return new Promise(((resolve, reject) => {

            let options = {
                Cmd: ['bash', '-c', cmd],
                // Cmd: ['bash', '-c', 'echo test $VAR'],
                // Env: ['VAR=ttslkfjsdalkfj'],
                AttachStdout: true,
                AttachStderr: true,
            };

            if( execOptions.tty )
            {
                options.Tty = true;
            }

            let container = self.docker.getContainer(self.containerId);
            
            let workingDir = container.WorkingDir || "/";
            console.log( `container working dir: ${workingDir}` );
            if( this.cwd && this.cwd != '.' )
            {
                if( path.isAbsolute(this.cwd )) {
                    workingDir = this.cwd;
                } else {
                    workingDir = path.join(workingDir, this.cwd);
                }
            }
            options.WorkingDir = workingDir;
            console.log( `updated working dir: ${workingDir}` );

            let stdoutStream = new stream.PassThrough();
            let stdout = '';
            stdoutStream.on('data', (chunk) => {
                let data = chunk.toString('utf8');
                stdout += data;
                if( onProgress ) { onProgress(data); }
            });

            let stderrStream = new stream.PassThrough();
            let stderr = '';
            stderrStream.on('data', (chunk) => {
                let data = chunk.toString('utf8'); 
                stderr += data;
                if( onProgress ) { onProgress(data); }
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
