import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OTEL_PATH = path.join(__dirname, '..', 'otel-skill-instrumentation.mjs');
const RECORD_PATH = path.join(__dirname, '..', 'record-execution.mjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SAMPLE_ARTIFACT = [
  'const verify = () => {',
  '  return "telemetry fixture payload";',
  '};',
].join('\n');

async function readTraceLine(runPath) {
  const content = await fs.promises.readFile(runPath, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

describe('otel-skill-instrumentation.mjs span timing', () => {
  test('span measures real elapsed wall time', async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-otel-test-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(scratch);
      const otel = await import(OTEL_PATH);
      const trace = await otel.startTrace('telemetry-test-skill');
      const span = otel.startSpan(trace, 'telemetry.test', 'internal', { 'skill.phase': 'test' });
      assert.equal(span.durationMs, 0);
      assert.equal(span.finishedAt, null);

      await sleep(50);
      const ended = span.end();
      await otel.finishTrace(trace, 'ok', []);

      assert.ok(ended.durationMs >= 40, `durationMs was ${ended.durationMs}`);
      assert.ok(new Date(span.finishedAt) > new Date(span.startedAt));
      assert.equal(span.attributes['gen_ai.skill.name'], 'telemetry-test-skill');
      assert.equal(span.attributes['skill.name'], 'telemetry-test-skill');

      const traceFile = path.join(scratch, '.agents', 'skills', 'platform', 'traces', `${trace.traceId}-telemetry-test-skill.json`);
      const persisted = JSON.parse(await fs.promises.readFile(traceFile, 'utf8'));
      const persistedSpan = persisted.spans.find((s) => s.spanId === span.spanId);
      assert.ok(persistedSpan.durationMs >= 40, `persisted durationMs was ${persistedSpan.durationMs}`);
      assert.ok(persisted.durationMs >= 40);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('endSpan is idempotent and addSpan stays available', async () => {
    const trace = { traceId: 'test-trace', spanId: 'test-span', skill: 'telemetry-test-skill', spans: [] };
    const otel = await import(OTEL_PATH);

    const closed = await otel.addSpan(trace, 'telemetry.instant', 'internal', {});
    assert.ok(closed.durationMs >= 0);
    assert.notEqual(closed.finishedAt, null);
    const firstDuration = closed.durationMs;
    otel.endSpan(trace, closed, { 'telemetry.extra': true });
    assert.equal(closed.durationMs, firstDuration);

    const span = otel.startSpan(trace, 'telemetry.manual', 'internal', {});
    otel.endSpan(trace, span);
    const before = span.durationMs;
    otel.endSpan(trace, span);
    assert.equal(span.durationMs, before);
  });
});

describe('record-execution.mjs trace defaults', () => {
  let scratch;

  before(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-otel-test-'));
  });

  after(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test('sizeTokens is populated from artifact content', async () => {
    const { recordExecution, validateTrace } = await import(RECORD_PATH);
    const runPath = await recordExecution({
      repoRoot: scratch,
      skill: 'telemetry-test-tokens',
      input: { artifactType: 'prompt', content: SAMPLE_ARTIFACT },
      output: { artifactType: 'code', content: SAMPLE_ARTIFACT, schemaValid: true },
      execution: {
        startedAt: new Date(Date.now() - 500).toISOString(),
        completedAt: new Date().toISOString(),
      },
      result: 'completed',
    });

    const trace = await readTraceLine(runPath);
    assert.ok(trace.input.sizeTokens > 0, `input.sizeTokens was ${trace.input.sizeTokens}`);
    assert.ok(trace.output.sizeTokens > 0, `output.sizeTokens was ${trace.output.sizeTokens}`);
    assert.ok(trace.execution.durationMs >= 495, `durationMs was ${trace.execution.durationMs}`);
    assert.deepEqual(validateTrace(trace), []);
  });

  test('raw artifact and arbitrary secret payloads are not persisted', async () => {
    const { recordExecution } = await import(RECORD_PATH);
    const secret = 'sk-test-super-secret-token';
    const runPath = await recordExecution({
      repoRoot: scratch,
      skill: 'telemetry-redaction',
      input: { artifactType: 'prompt', content: secret, contextRefs: ['issue-1'], apiToken: secret },
      output: { artifactType: 'code', text: secret, schemaValid: true, outputRef: 'artifact.md', password: secret },
      tools: [{ name: 'Bash', calls: 1, token: secret }],
      extra: { authorization: secret },
    });
    const persistedText = await fs.promises.readFile(runPath, 'utf8');
    assert.ok(!persistedText.includes(secret), 'trace must not contain raw secret-bearing payload text');
    const trace = await readTraceLine(runPath);
    assert.deepEqual(trace.input, { artifactType: 'prompt', sizeTokens: Math.ceil(secret.length / 4), contextRefs: ['issue-1'] });
    assert.deepEqual(trace.output, { artifactType: 'code', sizeTokens: Math.ceil(secret.length / 4), schemaValid: true, outputRef: 'artifact.md' });
    assert.deepEqual(trace.tools, [{ name: 'Bash', calls: 1 }]);
    assert.equal(Object.hasOwn(trace, 'extra'), false);
  });

  test('a trace with no optional fields still succeeds with durationMs computed', async () => {
    const { recordExecution, validateTrace } = await import(RECORD_PATH);
    const runPath = await recordExecution({
      repoRoot: scratch,
      skill: 'telemetry-test-bare',
    });

    const trace = await readTraceLine(runPath);
    assert.equal(trace.skill, 'telemetry-test-bare');
    assert.equal(trace.result, 'completed');
    assert.equal(trace.quality.artifactScore, null);
    assert.equal(trace.quality.artifactPassedQualityBar, false);
    assert.deepEqual(validateTrace(trace), []);
    assert.equal(
      trace.execution.durationMs,
      new Date(trace.execution.completedAt) - new Date(trace.execution.startedAt),
    );
    assert.ok(Number.isInteger(trace.execution.durationMs));
    assert.ok(trace.execution.durationMs >= 0);
    assert.equal(trace.input.sizeTokens, 0);
    assert.equal(trace.output.sizeTokens, 0);
  });
});
