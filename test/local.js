const child_process = require('child_process');
const assert = require('assert');
const Connector = require('../index');
const testVMName = 'infra_slimconnector_test';

describe('local connector', async function () {

    const connector = Connector.getConnector('local', '', {});

    connector.setCWD( 'test/resources');

    it('Run cwd test', async function () {

        assert.equal( 'test/resources', connector.getCWD() );

        // console.log( await connector.getSSHConfig() );

        let output = await connector.exec('cat local.txt');
        assert.equal(output.stdout, 'testing cwd in local.');
        assert.equal(output.exitCode, 0);
        assert.equal(output.stderr, '');
    });
});
