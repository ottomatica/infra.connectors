const child_process = require('child_process');
const assert = require('assert');
const Connector = require('../index');
const testVMName = 'infra_slimconnector_test';

describe('hooks', function() {
    
});

describe('Slim connector test', async function () {

    const connector = Connector.getConnector('slim', testVMName, {});

    before('Starting a slim vm to test connector', async function(){
        this.timeout(120000);
        if( ! await connector.isImageAvailable('alpine3.9-infra-slim-test') )
        {
            await connector.build(path.resolve('test/resources/alpine3.9-infra-slim-test'));
        }
        await connector.provision(testVMName, 'alpine3.9-infra-slim-test');
    });
    
    it('Run simple commands in a Slim VM', async function () {
        this.timeout(60000);
 
        // console.log( await connector.getSSHConfig() );

        let output = await connector.exec('touch helloworld && ls helloworld');
        assert.equal(output.stdout, 'helloworld');
        assert.equal(output.exitCode, 0);
        assert.equal(output.stderr, '');
    });
    
    after('Delete the test vm', async function () {
        this.timeout(60000);
        await connector.delete(testVMName);
    })
});
