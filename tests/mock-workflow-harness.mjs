#!/usr/bin/env node
// tests/mock-workflow-harness.mjs
//
// Dry-run harness for .claude/workflows/*.js.
//
// Those files are NOT plain ESM modules — they're a small DSL: the primitives
// `agent(prompt, opts)`, `parallel([fns])`, `pipeline(items, fn)`, `phase(title)`,
// `log(msg)`, a global `args` object, and a TOP-LEVEL `return` statement. A plain
// `import()` of one of these files fails (top-level return is a syntax error outside
// a function body), by design — they're meant to be executed as a function body by
// the real RAHU workflow runner, not imported as a module.
//
// This harness reproduces that execution shape well enough to dry-run a workflow
// with fake agents, so tests can assert on call order/shape/branching without
// hitting real MCP tools or spawning real subagents.
//
// Approach:
//   1. Read the workflow file's source as text.
//   2. Strip leading `export ` from `export const meta = ...` (and similar) — the
//      workflow body under the DSL is not itself an ES module, so `export` there is
//      only meaningful when the file IS imported normally elsewhere; for our purposes
//      it's dead syntax we need to remove before eval.
//   3. Compile the remaining source as the body of a `new AsyncFunction(...)`, i.e.
//      `Object.getPrototypeOf(async function(){}).constructor`, with the DSL
//      primitives (agent, parallel, pipeline, phase, log, args) passed in as
//      parameters. This gives the body real top-level `await` and a real top-level
//      `return` — both illegal in normal top-level module code, both required here.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

/**
 * Dry-run a workflow DSL file.
 *
 * @param {string} filePath - path to a .claude/workflows/*.js file
 * @param {object} opts
 * @param {(prompt: string, agentOpts: object, callIndex: number) => any} opts.agentFake
 *   Called once per agent() invocation in the workflow, in order. Its return value
 *   (or thrown value) becomes the resolved/rejected value of that agent() call.
 *   Required — without it every agent() call throws.
 * @param {object} [opts.args] - stubs the workflow's global `args` object.
 * @returns {Promise<{result: any, calls: Array<{prompt: string, opts: object}>, phases: string[], logs: string[]}>}
 *   result — whatever the workflow's top-level `return` produced.
 *   calls  — every agent() invocation, in call order, as {prompt, opts}.
 *   phases — every phase() title, in order (bonus, beyond the minimum contract).
 *   logs   — every log() message, in order (bonus, beyond the minimum contract).
 */
export function runWorkflow(filePath, { agentFake, args = {} } = {}) {
  const source = readFileSync(filePath, 'utf8')
  // Strip `export ` prefixes (export const / export function / export default …).
  // The workflow body is run as a plain function body, not a module, so `export`
  // keywords in it are just syntax we don't want to trip over.
  const body = source.replace(/^export\s+/gm, '')

  const calls = []
  let callIndex = 0

  async function agent(prompt, agentOpts) {
    const idx = callIndex++
    calls.push({ prompt, opts: agentOpts })
    if (typeof agentFake !== 'function') {
      throw new Error('mock-workflow-harness: runWorkflow() requires an agentFake(prompt, opts, callIndex) function')
    }
    // agentFake may itself be sync or async, and may throw/reject to simulate failure.
    return await agentFake(prompt, agentOpts, idx)
  }

  function parallel(fns) {
    return Promise.all(fns.map((fn) => fn()))
  }

  function pipeline(items, fn) {
    return Promise.all(items.map((item) => fn(item)))
  }

  const phases = []
  function phase(title) {
    phases.push(title)
  }

  const logs = []
  function log(msg) {
    logs.push(msg)
  }

  const run = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', body)

  return run(agent, parallel, pipeline, phase, log, args).then((result) => ({
    result,
    calls,
    phases,
    logs,
  }))
}

// ---------------------------------------------------------------------------
// Self-test — runs only when this file is invoked directly:
//   node tests/mock-workflow-harness.mjs
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isMain) {
  const path = fileURLToPath(new URL('../.claude/workflows/learn-voice.js', import.meta.url))

  // All-succeed fake: give every agent() call a plausible return value regardless
  // of which one it is, keyed loosely off the label so schema-shaped calls (like
  // the final profile-report, which requires {summary, labelmapOk}) get a shape
  // that satisfies the workflow's own post-processing.
  const agentFake = (prompt, opts, idx) => {
    const label = (opts && opts.label) || ''
    if (label === 'profile-report') {
      return { summary: 'fake profile summary — voice + tagging learned', labelmapOk: true }
    }
    if (label === 'learn:voice') {
      return 'learned: greeting/sign-off/tone patterns per audience'
    }
    if (label === 'learn:tagging') {
      return 'learned: tagging rules + labelmap fact written'
    }
    return { ok: true, note: `generic fake result for call #${idx}` }
  }

  let failures = []

  runWorkflow(path, { agentFake, args: {} })
    .then(({ result, calls }) => {
      if (typeof result !== 'object' || result === null) {
        failures.push(`expected a result object, got: ${JSON.stringify(result)}`)
      }
      if (!(calls.length >= 3)) {
        failures.push(`expected calls.length >= 3, got: ${calls.length}`)
      }

      if (failures.length === 0) {
        console.log('PASS — mock-workflow-harness self-test')
        console.log(`  result: ${JSON.stringify(result)}`)
        console.log(`  calls: ${calls.length}`)
        process.exit(0)
      } else {
        console.log('FAIL — mock-workflow-harness self-test')
        for (const f of failures) console.log(`  - ${f}`)
        process.exit(1)
      }
    })
    .catch((err) => {
      console.log('FAIL — mock-workflow-harness self-test threw an error')
      console.log(`  ${err && err.stack ? err.stack : err}`)
      process.exit(1)
    })
}
