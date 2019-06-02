const BakerConnector = require('./src/baker');
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
                return new VagrantConnector();

            case 'baker':
                return new BakerConnector();

            case 'ssh':
                return new SSHConnector();

            case 'docker':
                return new DockerConnector();

            default:
                break;
        }
    }
}

module.exports = Connector;
