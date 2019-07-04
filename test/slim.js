const child_process = require('child_process');
const assert = require('assert');
const SlimConnector = require('../src/slim');
const testVMName = 'infra_slimconnector_test';

describe('hooks', function() {
    
});

describe('Slim connector test', async function () {
 
    const connector = new SlimConnector(testVMName, {});
    before('Starting a slim vm to test connector', async function(){
        this.timeout(120000);
        if( ! await connector.isImageAvailable('alpine3.9-infra-slim-test') )
        {
            child_process.execSync(`slim build test/resources/alpine3.9-infra-slim-test`);
        }
        child_process.execSync(`slim run ${testVMName} alpine3.9-infra-slim-test`);
    });
    
    it('Run simple commands in a Slim VM', async function () {
        this.timeout(60000);
 
        // console.log( await connector.getSSHConfig() );

        let output = await connector.exec('touch helloworld && ls helloworld');
        assert.equal(output.stdout, 'helloworld');
        assert.equal(output.exitCode, 0);
        assert.equal(output.stderr, '');
    });
    
    after('Delete the test vm', function () {
        this.timeout(60000);
        child_process.execSync(`VBoxManage controlvm ${testVMName} poweroff soft`, {stdio: ['ignore', 'ignore', 'ignore']});
        child_process.execSync(`VBoxManage unregistervm ${testVMName} --delete`, {stdio: ['ignore', 'ignore', 'ignore']});
    })
});
