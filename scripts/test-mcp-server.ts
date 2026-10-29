import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testMcp() {
  const mcpScript = path.resolve(__dirname, '../dist/index.js');
  console.log('Testing MCP Server at:', mcpScript);

  const child = spawn('node', [mcpScript], {
    env: {
      ...process.env,
      SOCIALDISPATCH_API_URL: process.env.SOCIALDISPATCH_API_URL || 'https://api.socialdispatch.site',
      SOCIALDISPATCH_API_KEY: process.env.SOCIALDISPATCH_API_KEY || 'test-key',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stderr.on('data', (data) => {
    console.log('[MCP STDERR]:', data.toString().trim());
  });

  let responseData = '';
  child.stdout.on('data', (data) => {
    responseData += data.toString();
    console.log('[MCP STDOUT]:', data.toString().trim());
  });

  // Send JSON-RPC initialize request
  const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0' },
    },
  };

  const callToolRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'list_social_connections',
      arguments: {},
    },
  };

  child.stdin.write(JSON.stringify(initRequest) + '\n');
  child.stdin.write(JSON.stringify(callToolRequest) + '\n');

  await new Promise((resolve) => setTimeout(resolve, 1500));

  child.kill();
  console.log('MCP Test finished successfully!');
}

testMcp().catch(console.error);
