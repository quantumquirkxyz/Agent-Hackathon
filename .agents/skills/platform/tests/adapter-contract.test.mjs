import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateModelResponse,
  validateModelAdapter,
  validateAgentAdapter,
  validateMcpAdapter,
} from '../../../../evals/harness/adapter-contract.mjs';

test('model response contract is provider-neutral', () => {
  const response = validateModelResponse({ text: 'ok', toolCalls: [{ name: 'read', input: {} }] });
  assert.equal(response.text, 'ok');
  assert.throws(() => validateModelResponse({ text: 'bad' }), /toolCalls/);
});

test('model, agent and MCP adapters expose minimal capabilities', () => {
  assert.equal(validateModelAdapter({ complete() {} }).complete instanceof Function, true);
  assert.equal(validateAgentAdapter({ run() {} }).run instanceof Function, true);
  assert.equal(validateMcpAdapter({ callTool() {} }).callTool instanceof Function, true);
  assert.throws(() => validateModelAdapter({}), /complete/);
  assert.throws(() => validateAgentAdapter({}), /run/);
  assert.throws(() => validateMcpAdapter({}), /callTool/);
});
