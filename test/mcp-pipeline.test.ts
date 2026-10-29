import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('MCP Server Pipeline & Disclosure Tools Verification', () => {
  test('MCP server index should define pipeline and disclosure features', () => {
    const mcpIndexPath = path.resolve(__dirname, '../src/index.ts');
    const content = fs.readFileSync(mcpIndexPath, 'utf-8');

    // 1. Tool names in TOOLS array
    assert.ok(content.includes("'add_content_ideas'"), 'add_content_ideas tool must be defined');
    assert.ok(content.includes("'list_content_pipeline'"), 'list_content_pipeline tool must be defined');
    assert.ok(content.includes("'update_content_progress'"), 'update_content_progress tool must be defined');
    assert.ok(content.includes("'get_next_pipeline_item'"), 'get_next_pipeline_item tool must be defined');

    // 2. isAlteredContent option
    assert.ok(content.includes('isAlteredContent'), 'isAlteredContent must be defined');

    // 3. Case handlers in switch-statement
    assert.ok(content.includes("case 'add_content_ideas':"), 'add_content_ideas case handler must be present');
    assert.ok(content.includes("case 'list_content_pipeline':"), 'list_content_pipeline case handler must be present');
    assert.ok(content.includes("case 'update_content_progress':"), 'update_content_progress case handler must be present');
    assert.ok(content.includes("case 'get_next_pipeline_item':"), 'get_next_pipeline_item case handler must be present');
  });

  test('MCP server compiled dist should exist and contain new tools', () => {
    const distPath = path.resolve(__dirname, '../dist/index.js');
    assert.ok(fs.existsSync(distPath), 'Compiled mcp-server dist/index.js must exist');
    const distContent = fs.readFileSync(distPath, 'utf-8');

    assert.ok(distContent.includes('add_content_ideas'));
    assert.ok(distContent.includes('list_content_pipeline'));
    assert.ok(distContent.includes('update_content_progress'));
    assert.ok(distContent.includes('get_next_pipeline_item'));
    assert.ok(distContent.includes('isAlteredContent'));
  });
});
