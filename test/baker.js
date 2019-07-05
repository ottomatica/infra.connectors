const child_process = require('child_process');
const assert = require('assert');
const Connector = require('../index');

describe('hooks', function() {
    
});

describe('Baker connector test', async function () {
    
    let connector = Connector.getConnector('baker','test/resources/baker_vm/', {});

    before('Starting a baker vm to test connector', async function(){
        this.timeout(120000);
        child_process.execSync(`cd test/resources/baker_vm && baker bake`);
    });
    
    it('Run simple commands in a Baker VM', async function () {
        this.timeout(60000);
        let output = await connector.exec('touch helloworld && ls helloworld');
        assert.equal(output.stdout, 'helloworld');
        assert.equal(output.exitCode, 0);
        assert.equal(output.stderr, '');
    });
    
    after('Delete the test vm', function () {
        this.timeout(60000);
        child_process.execSync(`cd test/resources/baker_vm && baker delete`);
    })
});
