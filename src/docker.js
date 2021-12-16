const Docker = require('dockerode');
const stream = require('stream');
const chalk  = require('chalk');
const tar = require('tar');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const Connector = require('./connector');
const { resolveCaa } = require('dns');

class DockerConnector extends Connector {
    constructor(container) {
        super('docker@', 'privateKey@');
        this.docker = new Docker();
        this.containerId = container;
        this.type = 'docker';
    }

    async _pull(imageName, options, onProgress, verbose = true) {

        let self = this;
        // console.log( `pulling ${imageName}`);
        process.stdout.write(`pulling ${imageName} `);
        return new Promise((resolve, reject) => {
            self.docker.pull(imageName, options, async (error, stream) => {
                
                if (error) { return reject(error); }
                if (!stream) { return reject("Failured to pull."); }
                
                let onFinished = (error, output) => {
                    if (error) {
                        return reject(error);
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

    async pull(imageName, onProgress, verbose = true) {
        return this._pull(imageName, {}, onProgress, verbose);
    }

    /*
     * imageNames: string | string[] 
     * image format <image-name>[:<tag>]
     */    
    async imageExists( imageNames ) {
        return new Promise((resolve, reject) => {    
            let imageNamesArray = Array.isArray(imageNames) ? imageNames : [imageNames];

            this.docker.listImages({ filters: { reference: imageNamesArray } })
                .then( (images) => { 
                    console.log( images );
                    resolve( images.length > 0 )
                })
                .catch( (err) => reject(err.message) )
            ;
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

    async run(image, cmd, options) {

        options = options || {};

        return new Promise( (resolve, reject) => {

            this.docker.createContainer({
                name: this.containerId,
                Image: image,
                AttachStdin: false,
                AttachStdout: true,
                AttachStderr: true,
                Tty: true,
                Cmd: Array.isArray(cmd) ? cmd : [cmd],
                OpenStdin: false,
                StdinOnce: false,
                HostConfig: {
                    ...options,
                    Memory: options.Memory || 0,
                    NanoCPUs: options.NanoCPUs || 1000000000                
                }
            }).then(container => {

                container.start( {}, (err, data) => {
                    if( err ) return reject(err);
                    resolve(data);

                    // These might not be fully ready. Caller should use `ready()` to check if container is still running.
                    // container.stats({stream: false}, (statsErr, stats) => {
                    //     if( statsErr ) reject(statsErr);
                    //     if( Object.keys( pids_stats ).length == 0 || Object.keys( memory_stats).length == 0 ) {
                    //     }
                    // container.inspect( {}, (statsErr, stats) => {
                    //     if( statsErr ) reject(statsErr);
                    //     console.log(stats);
                    //     resolve( stats );
                    // })
                });
            })
            .catch(err => reject(err) );

        });

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
tmpfile=$(mktemp -u)
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

        if( (await fs.promises.lstat(src)).isDirectory() )
            return {exitCode: 0, stdout: `Copied ${src} to ${dest}`, stderr: ""};
        return await this.exec(`mv ${path.dirname(dest)}/${path.basename(src)} ${dest}`);
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

    async stream(cmd, onProgress, options) {
        return this._exec(cmd, onProgress, options)
    }

    async kill(pid) {
        return this._exec(`kill -9 ${pid}`);
    }

    async _exec(cmd, onProgress, execOptions) {
        execOptions = execOptions || {};

        if( execOptions.pipefail ) {
            cmd = 'set -o pipefail; ' + cmd;
        }
 
        const self = this;
        return new Promise((async (resolve, reject) => {

            const pidfile = `/tmp/${uuidv4()}`;
            let launchScript = 
`tmpfile="${pidfile}"
echo $$ > $tmpfile
${cmd}
`;

            let launchScriptPath;
            if(execOptions.getPid) {
                launchScriptPath = await this.writeTempFile('', launchScript);
                await this.exec(`chmod +x ${launchScriptPath}`);
            }
            else
                launchScriptPath = cmd;

            let options = {
                Cmd: ['bash', '-c', launchScriptPath],
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
            // console.log( `container working dir: ${workingDir}` );
            if( this.cwd && this.cwd != '.' )
            {
                if( path.isAbsolute(this.cwd )) {
                    workingDir = this.cwd;
                } else {
                    workingDir = path.join(workingDir, this.cwd);
                }
            }
            // if host is windows, will need to convert to posix.
            options.WorkingDir = workingDir.replace(/\\/g, "/");
            // console.log( `updated working dir: ${workingDir}` );

            container.exec(options, async (err, exec) => {
                if (err) return;
                exec.start(async (err, execStream) => {
                    if (err) return;
                    
                    let pid;
                    if(execOptions.getPid)
                        pid = parseInt(await this.readFile(pidfile));

                    let stdoutStream = new stream.PassThrough();
                    let stdout = '';
                    stdoutStream.on('data', (chunk) => {
                        let data = chunk.toString('utf8');
                        stdout += data;
                        if (onProgress) {
                            if (pid) onProgress({ stdout: data, pid });
                            else onProgress(data);
                        }
                    });
        
                    let stderrStream = new stream.PassThrough();
                    let stderr = '';
                    stderrStream.on('data', (chunk) => {
                        let data = chunk.toString('utf8'); 
                        stderr += data;
                        if (onProgress) {
                            if (pid) onProgress({ stderr: data, pid });
                            else onProgress(data);
                        }
                    });

                    container.modem.demuxStream(execStream, stdoutStream, stderrStream);
                    execStream.on('end', async () => {
                        stdoutStream.destroy();

                        const exitCode = (await exec.inspect()).ExitCode;

                        resolve({stdout, stderr, exitCode});
                    });
                });
            });
        }));
    }

    // We "fire-n-forget".
    async spawn(cmd, execOptions) {
        execOptions = execOptions || {};

        if( execOptions.pipefail ) {
            cmd = 'set -o pipefail; ' + cmd;
        }
 
        const self = this;
        return new Promise(((resolve, reject) => {

            let options = {
                Cmd: ['bash', '-c', cmd],
                AttachStdout: false,
                AttachStderr: false,
            };

            let container = self.docker.getContainer(self.containerId);
            let workingDir = container.WorkingDir || "/";
            if( this.cwd && this.cwd != '.' )
            {
                if( path.isAbsolute(this.cwd )) {
                    workingDir = this.cwd;
                } else {
                    workingDir = path.join(workingDir, this.cwd);
                }
            }
            // if host is windows, will need to convert to posix.
            options.WorkingDir = workingDir.replace(/\\/g, "/");

            container.exec(options, (err, exec) => {
                if (err) {
                    resolve({stdout: "", stderr:err.message, exitCode: 1});
                    return;
                }
                exec.start((err, stream) => {
                    if (err) {
                        resolve({stdout: "", stderr:err.message, exitCode: 1});
                        return;
                    }

                    // exec doesn't necessarily expose pids, we'll just return supervisor.
                    resolve({stdout: "", stderr:"", pid: 1, exitCode: 0});
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
