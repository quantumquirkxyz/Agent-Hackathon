#!/usr/bin/env node
// worker-runner.mjs - environment-neutral coding-agent runner for parallel-issue-fleet.
//
// A worker profile is a small JSON document that describes how to install and
// invoke one coding-agent CLI. The runner is deliberately agent-agnostic: it
// executes argv arrays, never shell strings, and never assumes a vendor, model
// provider, or hosting environment.
//
// Profile shape:
//   {
//     "schemaVersion": "1.0",
//     "name": "my-agent",
//     "setup": [["npm", "install", "-g", "@example/agent"]],
//     "command": ["my-agent", "run", "{{prompt}}"],
//     "modelArgs": ["--model", "{{model}}"],
//     "promptDelivery": "argv",            // argv | stdin | file
//     "model": "provider/model",
//     "modelEnv": "MY_AGENT_MODEL",
//     "env": ["MY_AGENT_API_KEY"],
//     "requiredEnv": ["MY_AGENT_API_KEY"],
//     "timeoutMs": 1800000
//   }
//
// Placeholders: {{prompt}}, {{promptFile}}, {{model}}, {{artifact}},
// {{workspace}}, {{run.id}}, {{issue.id}}, {{issue.title}}, {{issue.url}},
// {{base.revision}}.
//
// Secrets are read from named environment variables. FLEET_SECRETS_JSON may
// carry a JSON object of name -> value; only names listed in the profile's
// env/requiredEnv are injected. Secret values are never printed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const WORKER_PROFILE_SCHEMA_VERSION = '1.0';
export const PROMPT_DELIVERIES = new Set(['argv', 'stdin', 'file']);
const PLACEHOLDER = /\{\{([^}]+)}}/g;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENV_NAMES = new Set([
  'FLEET_SECRETS_JSON',
  'GITHUB_TOKEN',
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
]);
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_PROFILE_CANDIDATES = [
  '.github/fleet/worker.json',
  '.agents/fleet/worker.json',
  '.fleet/worker.json',
];

// Variables a coding agent normally needs. Provider credentials are added only
// when the profile names them, and are never inherited accidentally.
const BASE_ENV = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM',
  'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LANGUAGE',
  'CI',
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS',
  'SystemRoot', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'GITHUB_WORKSPACE', 'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_OWNER',
  'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_REF_NAME', 'GITHUB_HEAD_REF', 'GITHUB_BASE_REF',
  'GITHUB_EVENT_NAME', 'GITHUB_ACTOR', 'GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER',
  'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'GITHUB_ACTION', 'GITHUB_WORKFLOW',
  'RUNNER_OS', 'RUNNER_ARCH', 'RUNNER_NAME', 'RUNNER_TEMP', 'RUNNER_TOOL_CACHE',
  'RUNNER_WORKSPACE',
];

function stringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string');
}

function envNameList(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && ENV_NAME.test(entry));
}

export function validateWorkerProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return ['worker profile must be a JSON object'];
  }
  const errors = [];
  if (profile.schemaVersion !== undefined && profile.schemaVersion !== WORKER_PROFILE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${WORKER_PROFILE_SCHEMA_VERSION}`);
  }
  if (!stringArray(profile.command)) errors.push('command must be a non-empty argv array of strings');
  else if (!profile.command[0].trim()) errors.push('command[0] must be a non-empty executable');
  if (profile.setup !== undefined) {
    if (!Array.isArray(profile.setup)) errors.push('setup must be an array of argv arrays');
    else profile.setup.forEach((command, index) => {
      if (!stringArray(command)) errors.push(`setup[${index}] must be a non-empty argv array of strings`);
      else if (!command[0].trim()) errors.push(`setup[${index}][0] must be a non-empty executable`);
    });
  }
  if (profile.modelArgs !== undefined && !stringArray(profile.modelArgs)) {
    errors.push('modelArgs must be a non-empty argv array of strings');
  }
  if (profile.promptDelivery !== undefined && !PROMPT_DELIVERIES.has(profile.promptDelivery)) {
    errors.push('promptDelivery must be argv, stdin, or file');
  }
  if (profile.env !== undefined && !envNameList(profile.env)) {
    errors.push('env must be an array of environment variable names');
  }
  if (profile.requiredEnv !== undefined && !envNameList(profile.requiredEnv)) {
    errors.push('requiredEnv must be an array of environment variable names');
  }
  const requestedEnv = [
    ...(envNameList(profile.env) ? profile.env : []),
    ...(envNameList(profile.requiredEnv) ? profile.requiredEnv : []),
  ];
  for (const name of requestedEnv) {
    if (RESERVED_ENV_NAMES.has(name)) errors.push(`env name ${name} is reserved and cannot be injected`);
  }
  if (profile.model !== undefined && typeof profile.model !== 'string') errors.push('model must be a string');
  if (profile.modelEnv !== undefined && (typeof profile.modelEnv !== 'string' || !ENV_NAME.test(profile.modelEnv))) {
    errors.push('modelEnv must be an environment variable name');
  }
  if (profile.timeoutMs !== undefined && (!Number.isInteger(profile.timeoutMs) || profile.timeoutMs < 1)) {
    errors.push('timeoutMs must be a positive integer');
  }

  const delivery = profile.promptDelivery ?? 'argv';
  const commandParts = Array.isArray(profile.command) ? profile.command : [];
  const modelParts = Array.isArray(profile.modelArgs) ? profile.modelArgs : [];
  const allParts = [...commandParts, ...modelParts].filter((part) => typeof part === 'string');
  const hasPrompt = allParts.some((part) => part.includes('{{prompt}}'));
  const hasPromptFile = allParts.some((part) => part.includes('{{promptFile}}'));
  const modelArgsPlaceholders = commandParts.filter((part) => typeof part === 'string' && part.includes('{{modelArgs}}'));
  if (modelArgsPlaceholders.some((part) => part !== '{{modelArgs}}')) {
    errors.push('{{modelArgs}} must be a complete argv element');
  }
  if (commandParts.filter((part) => part === '{{modelArgs}}').length > 1) {
    errors.push('{{modelArgs}} may appear only once');
  }
  if (modelParts.some((part) => typeof part === 'string' && part.includes('{{modelArgs}}'))) {
    errors.push('modelArgs must not contain {{modelArgs}}');
  }
  if (modelParts.some((part) => typeof part === 'string' && part.includes('{{prompt}}'))) {
    errors.push('{{prompt}} must be in command, not modelArgs');
  }
  if (delivery === 'argv' && hasPromptFile) {
    errors.push('{{promptFile}} requires promptDelivery "file"');
  }
  if (delivery === 'file' && !hasPromptFile) {
    errors.push('promptDelivery "file" requires {{promptFile}} in command or modelArgs');
  }
  if (delivery !== 'argv' && hasPrompt) {
    errors.push('{{prompt}} is only valid with promptDelivery "argv"');
  }
  if (delivery !== 'file' && hasPromptFile) {
    errors.push('{{promptFile}} is only valid with promptDelivery "file"');
  }
  return errors;
}

export function readWorkerProfile(profilePath, baseDir = process.cwd()) {
  const resolved = path.isAbsolute(profilePath)
    ? profilePath
    : path.resolve(baseDir, profilePath);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read worker profile ${resolved}: ${error.message}`);
  }
  const errors = validateWorkerProfile(value);
  if (errors.length) throw new Error(`invalid worker profile ${resolved}: ${errors.join('; ')}`);
  return { profile: value, profilePath: resolved };
}

export function resolveWorkerProfile(source, options = {}) {
  if (!source) throw new Error('worker profile is required');
  const baseDir = options.baseDir ?? process.cwd();
  if (typeof source === 'string') return readWorkerProfile(source, baseDir);
  if (typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('worker profile must be a path or an object');
  }
  if (source.profile) {
    const resolved = readWorkerProfile(source.profile, baseDir);
    const profile = {
      ...resolved.profile,
      ...(source.name ? { name: source.name } : {}),
      ...(source.model ? { model: source.model } : {}),
    };
    const errors = validateWorkerProfile(profile);
    if (errors.length) throw new Error(`invalid worker profile ${resolved.profilePath}: ${errors.join('; ')}`);
    return { profile, profilePath: resolved.profilePath };
  }
  const profile = { ...source };
  delete profile.profile;
  const errors = validateWorkerProfile(profile);
  if (errors.length) throw new Error(`invalid worker profile: ${errors.join('; ')}`);
  return { profile, profilePath: null };
}

export function findDefaultWorkerProfile(workspace = process.cwd()) {
  for (const candidate of DEFAULT_PROFILE_CANDIDATES) {
    const full = path.join(workspace, candidate);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function placeholderContext(options = {}) {
  return {
    prompt: String(options.prompt ?? ''),
    promptFile: String(options.promptFile ?? ''),
    model: String(options.model ?? ''),
    artifact: String(options.artifact ?? ''),
    workspace: String(options.workspace ?? ''),
    'run.id': String(options.runId ?? ''),
    'issue.id': String(options.issueId ?? ''),
    'issue.title': String(options.issueTitle ?? ''),
    'issue.url': String(options.issueUrl ?? ''),
    'base.revision': String(options.baseRevision ?? ''),
  };
}

export function substituteWorkerPart(part, context) {
  return String(part).replace(PLACEHOLDER, (_, rawKey) => {
    const key = rawKey.trim();
    if (!(key in context)) throw new Error(`unknown worker placeholder: {{${key}}}`);
    return context[key];
  });
}

export function renderWorkerArgs(profile, options = {}) {
  const context = placeholderContext(options);
  const delivery = profile.promptDelivery ?? 'argv';
  const model = String(context.model ?? '').trim() || String(profile.model ?? '').trim();
  const modelContext = { ...context, model };
  const modelArgs = (profile.modelArgs ?? []).map((part) => substituteWorkerPart(part, modelContext));
  if (profile.command.some((part) => part === '{{modelArgs}}')) {
    const command = [];
    for (const part of profile.command) {
      if (part === '{{modelArgs}}') {
        if (model && modelArgs.length) command.push(...modelArgs);
        continue;
      }
      command.push(substituteWorkerPart(part, { ...modelContext, prompt: context.prompt }));
    }
    if (delivery === 'argv' && !profile.command.some((part) => String(part).includes('{{prompt}}'))) {
      command.push(context.prompt);
    }
    return command;
  }

  const command = profile.command.map((part) => substituteWorkerPart(part, modelContext));
  const promptIndex = profile.command.findIndex((part) => String(part).includes('{{prompt}}'));

  if (promptIndex >= 0) {
    command[promptIndex] = substituteWorkerPart(profile.command[promptIndex], {
      ...modelContext,
      prompt: context.prompt,
    });
    if (model && modelArgs.length) command.splice(promptIndex, 0, ...modelArgs);
  } else if (delivery === 'argv') {
    if (model && modelArgs.length) command.push(...modelArgs);
    command.push(context.prompt);
  } else if (model && modelArgs.length) {
    command.push(...modelArgs);
  }
  return command;
}

export function buildWorkerEnvironment(profile, parentEnv = process.env, options = {}) {
  const model = String(options.model ?? '').trim() || String(profile.model ?? '').trim();
  const requested = [
    ...(Array.isArray(profile.env) ? profile.env : []),
    ...(Array.isArray(profile.requiredEnv) ? profile.requiredEnv : []),
  ];
  const reserved = requested.filter((name) => RESERVED_ENV_NAMES.has(name));
  if (reserved.length) throw new Error(`profile requests reserved environment names: ${[...new Set(reserved)].join(', ')}`);
  const allowed = new Set([...BASE_ENV, ...requested]);
  const env = {};
  for (const name of allowed) {
    if (parentEnv[name] !== undefined) env[name] = parentEnv[name];
  }

  if (parentEnv.FLEET_SECRETS_JSON) {
    let secrets;
    try {
      secrets = JSON.parse(parentEnv.FLEET_SECRETS_JSON);
    } catch (error) {
      throw new Error(`FLEET_SECRETS_JSON is not valid JSON: ${error.message}`);
    }
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) {
      throw new Error('FLEET_SECRETS_JSON must be a JSON object');
    }
    const injectable = new Set([...(profile.env ?? []), ...(profile.requiredEnv ?? [])]);
    for (const [name, value] of Object.entries(secrets)) {
      if (injectable.has(name)) env[name] = String(value);
    }
  }

  for (const name of profile.requiredEnv ?? []) {
    if (env[name] === undefined || env[name] === '') {
      throw new Error(`missing required worker environment variable: ${name}`);
    }
  }

  const fleetEnv = {
    FLEET_RUN_ID: options.runId ?? '',
    FLEET_ISSUE_ID: options.issueId ?? '',
    FLEET_ISSUE_TITLE: options.issueTitle ?? '',
    FLEET_ISSUE_URL: options.issueUrl ?? '',
    FLEET_BASE_REVISION: options.baseRevision ?? '',
    FLEET_WORKSPACE: options.workspace ?? '',
    FLEET_IMPLEMENT_ARTIFACT: options.artifact ?? '',
    FLEET_PROMPT_FILE: options.promptFile ?? '',
  };
  if (model) fleetEnv.FLEET_MODEL = model;
  if (options.profilePath) fleetEnv.FLEET_WORKER_PROFILE = options.profilePath;
  Object.assign(env, fleetEnv);

  if (model && profile.modelEnv) env[profile.modelEnv] = model;
  return env;
}

function maskInjectedSecrets(profile, env) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const names = new Set([...(profile.env ?? []), ...(profile.requiredEnv ?? [])]);
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.length > 0) {
      process.stdout.write(`::add-mask::${value.replace(/\r?\n/g, ' ')}\n`);
    }
  }
}

function runOne(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.stdin ?? 'ignore', 'inherit', 'inherit'],
      shell: false,
    });
    let settled = false;
    let timer = null;
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, signal: signal ?? null });
    };
    child.on('error', (error) => {
      process.stderr.write(`worker command could not start: ${error.message}\n`);
      finish(127, null);
    });
    child.on('close', finish);
    if (options.input !== undefined && child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.write(String(options.input));
      child.stdin.end();
    }
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 500).unref();
      }, Math.max(1, options.timeoutMs));
    }
  });
}

export async function runWorker(profile, options = {}) {
  const errors = validateWorkerProfile(profile);
  if (errors.length) throw new Error(`invalid worker profile: ${errors.join('; ')}`);
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const delivery = profile.promptDelivery ?? 'argv';
  const model = String(options.model ?? '').trim() || String(profile.model ?? '').trim();
  let promptFile = options.promptFile ? path.resolve(options.promptFile) : null;
  let temporaryPrompt = null;

  if (delivery === 'file' && promptFile && !fs.existsSync(promptFile)) {
    throw new Error(`prompt file does not exist: ${promptFile}`);
  }
  if (delivery === 'file' && !promptFile) {
    temporaryPrompt = path.join(os.tmpdir(), `fleet-prompt-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(temporaryPrompt, String(options.prompt ?? ''), { mode: 0o600 });
    promptFile = temporaryPrompt;
  }

  const env = buildWorkerEnvironment(profile, options.env ?? process.env, {
    ...options,
    model,
    workspace,
    promptFile,
    profilePath: options.profilePath,
  });
  const args = renderWorkerArgs(profile, { ...options, model, workspace, promptFile });
  if (!options.dryRun) maskInjectedSecrets(profile, env);

  try {
    const setupContext = placeholderContext({ ...options, model, workspace, promptFile });
    for (const setup of profile.setup ?? []) {
      const [executable, ...setupArgs] = setup.map((part) => substituteWorkerPart(part, setupContext));
      const result = await runOne(executable, setupArgs, {
        cwd: workspace,
        env,
        timeoutMs: options.timeoutMs ?? profile.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      if (result.code !== 0) {
        throw new Error(`worker setup failed (${executable}): exit ${result.code}`);
      }
    }

    const result = await runOne(args[0], args.slice(1), {
      cwd: workspace,
      env,
      stdin: delivery === 'stdin' ? 'pipe' : 'ignore',
      input: delivery === 'stdin' ? String(options.prompt ?? '') : undefined,
      timeoutMs: options.timeoutMs ?? profile.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    return result;
  } finally {
    if (temporaryPrompt) {
      try { fs.unlinkSync(temporaryPrompt); } catch { /* best effort */ }
    }
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`missing value for ${token}`);
    index += 1;
    options[key] = value;
  }
  return options;
}

function usage() {
  return [
    'Usage: worker-runner.mjs --workspace <dir> --prompt-file <file> [options]',
    '',
    'Options:',
    '  --profile <path>       Worker profile (default: .github/fleet/worker.json or another standard location)',
    '  --workspace <dir>      Checkout or worktree the agent must modify',
    '  --prompt-file <file>   File containing the rendered prompt',
    '  --prompt <text>        Inline prompt (testing only; prefer --prompt-file)',
    '  --artifact <path>      Workspace-relative ImplementArtifact path exposed as {{artifact}}',
    '  --model <name>         Model override; exposed as {{model}} and FLEET_MODEL',
    '  --timeout-ms <n>       Per-process timeout',
    '  --dry-run              Print the resolved argv and environment names without running',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const promptFile = options.promptFile ? path.resolve(options.promptFile) : null;
  const prompt = options.prompt !== undefined
    ? String(options.prompt)
    : (promptFile && fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8') : '');
  if (!prompt) throw new Error('a prompt is required via --prompt or --prompt-file');

  const source = options.profile ?? process.env.FLEET_WORKER_PROFILE ?? findDefaultWorkerProfile(workspace);
  if (!source) {
    throw new Error('no worker profile: pass --profile or commit .github/fleet/worker.json');
  }
  const { profile, profilePath } = resolveWorkerProfile(source, { baseDir: workspace });
  const model = String(options.model ?? '').trim()
    || String(process.env.FLEET_MODEL ?? '').trim()
    || String(profile.model ?? '').trim();
  const artifact = options.artifact ?? process.env.FLEET_IMPLEMENT_ARTIFACT ?? '';
  const timeoutMs = options.timeoutMs === undefined
    ? (profile.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    : Number(options.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('--timeout-ms must be a positive integer');
  }
  const runOptions = {
    workspace,
    prompt,
    promptFile,
    artifact,
    model,
    runId: options.runId ?? process.env.FLEET_RUN_ID ?? '',
    issueId: options.issueId ?? process.env.FLEET_ISSUE_ID ?? '',
    issueTitle: options.issueTitle ?? process.env.FLEET_ISSUE_TITLE ?? '',
    issueUrl: options.issueUrl ?? process.env.FLEET_ISSUE_URL ?? '',
    baseRevision: options.baseRevision ?? process.env.FLEET_BASE_REVISION ?? '',
    timeoutMs,
    profilePath,
    env: process.env,
  };

  if (options.dryRun) {
    const args = renderWorkerArgs(profile, runOptions);
    const redactPrompt = (part) => (prompt ? String(part).split(prompt).join('[PROMPT]') : String(part));
    const redacted = args.map(redactPrompt);
    const env = buildWorkerEnvironment(profile, process.env, runOptions);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      profile: profilePath,
      name: profile.name ?? null,
      model: model || null,
      promptDelivery: profile.promptDelivery ?? 'argv',
      command: redacted,
      setup: (profile.setup ?? []).map((setup) => setup.map(redactPrompt)),
      env: Object.keys(env).sort(),
    }, null, 2)}\n`);
    return 0;
  }

  return runWorker(profile, runOptions).then((result) => result.code ?? 1);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const code = main();
    if (typeof code === 'number') process.exit(code);
    code.then((exitCode) => process.exit(exitCode)).catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
