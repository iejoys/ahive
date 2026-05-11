const { spawn } = require('child_process');

console.log('Spawning npx...');
const proc = spawn('npx.cmd', ['-y', '@modelcontextprotocol/server-everything'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true
});

proc.stderr.on('data', d => console.log('STDERR:', d.toString()));
proc.stdout.on('data', d => console.log('STDOUT:', d.toString()));

setTimeout(() => {
    console.log('Sending initialize request at 2s...');
    const req = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
    };
    proc.stdin.write(JSON.stringify(req) + '\n');
}, 2000);

setTimeout(() => {
    console.log('Sending SECOND initialize request at 10s...');
    const req = {
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
    };
    proc.stdin.write(JSON.stringify(req) + '\n');
}, 10000);

setTimeout(() => {
    console.log('Test complete, killing...');
    proc.kill();
    process.exit(0);
}, 15000);
