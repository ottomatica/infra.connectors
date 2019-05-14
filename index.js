const BakerConnector = require('./src/baker');
const SSHConnector = require('./src/ssh');
const DockerConnector = require('./src/docker');
const VagrantConnector = require('./src/vagrant');
const LocalConnector = require('./src/local');
const SlimConnector = require('./src/slim');


class Connector {

    constructor(type, name) {
        switch (type) {
            case 'local':
                this.connector = new LocalConnector();
                break;

            case 'slim':
                this.connector = new SlimConnector(name);
                break;

            case 'vagrant':
                this.connector = new VagrantConnector();
                break;

            case 'baker': 
                this.connector = new BakerConnector();
                break;

            case 'ssh':
                this.connector = new SSHConnector();
                break;

            case 'docker':
                this.connector = new DockerConnector();
                break;

            default:
                break;
        }
    }
}

module.exports = Connector;
