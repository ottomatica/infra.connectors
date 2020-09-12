const BakerConnector = require('./src/baker');
const BakerxConnector = require('./src/bakerx');
const SSHConnector = require('./src/ssh');
const DockerConnector = require('./src/docker');
const VagrantConnector = require('./src/vagrant');
const LocalConnector = require('./src/local');
const SlimConnector = require('./src/slim');


class Connector {

    static getConnector(type, name, opts) {
        switch (type) {
            case 'local':
                return new LocalConnector();

            case 'slim':
                return new SlimConnector(name, opts);

            case 'vagrant':
                return new VagrantConnector(opts.inCWD, name);

            case 'baker':
                return new BakerConnector({bakerPath: name});

            case 'bakerx':
                return new BakerxConnector(name);

            case 'ssh':
                return new SSHConnector(name, opts.privateKey);

            case 'docker':
                return new DockerConnector(name);

            default:
                break;
        }
    }
}

module.exports = Connector;

// (async () => {
//     let conn = new LocalConnector();
//     console.log( conn.shouldUseMultiLine("echo 1\r\necho 2\n"));
//     let res = await conn.exec("echo 1\r\necho 2\n");
//     console.log(res);
// })();
