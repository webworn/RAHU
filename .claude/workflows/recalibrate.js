export const meta = {
  name: 'rahu-recalibrate',
  description: 'The correction loop /learn + /label never had: diff what RAHU applied against what the user changed it to, then refine the learned tagging rules. Read-only against Gmail — writes only to local memory.',
  phases: [
    { title: 'Diff', detail: 'applied label vs current label, per message', model: 'haiku' },
    { title: 'Learn', detail: 'refine tagging rules from genuine overrides', model: 'sonnet' },
  ],
}

const WINDOW = (args && args.window) || '7d'

const CORRECTION_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    subject: { type: 'string' },
    sender: { type: 'string' },
    applied: { type: 'string', description: 'label RAHU applied at the time' },
    current: { type: 'string', description: 'label now on the message, in place of applied' },
  },
  required: ['id', 'applied', 'current'],
}
const DIFF_SCHEMA = {
  type: 'object',
  properties: {
    sampled: { type: 'number' },
    corrections: { type: 'array', items: CORRECTION_SCHEMA },
  },
  required: ['sampled', 'corrections'],
}

const settle = (p) => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e) }))

phase('Diff')
const diffResult = await settle(agent(
  `Find genuine label corrections per the label-corrections skill, over Gmail newer_than:${WINDOW}.
   1. Recall any audit trail: python3 .claude/memory/store.py recall --kind audit --k 40
      --max-chars 1800 — each fact (if any exist) records a message id and the label RAHU
      applied to it.
   2. If audit facts exist, for each one fetch that message's CURRENT labels and compare
      against the applied label recorded in the fact.
   3. If no audit facts exist, fall back: search mail in the window carrying the RAHU
      processed marker, sample up to 40 of them, and use whatever context is available
      (the processed marker / thread) to infer what was applied at the time; skip any
      message where that inference isn't reasonably confident rather than guessing.
   4. For each sampled message, keep it as a correction ONLY if the label RAHU applied is
      now gone and/or replaced by a different label from the same group — an extra label
      added alongside the original one is NOT a correction, skip it. Also skip messages
      RAHU never touched and messages whose current labels exactly match what was applied.
   Return {sampled, corrections:[{id, subject, sender, applied, current}]} — sampled is the
   total messages examined, corrections is only the genuine overrides.`,
  { agentType: 'inbox-triage', label: 'diff', phase: 'Diff', schema: DIFF_SCHEMA }
))

if (!diffResult.ok) {
  log(`Diff phase failed: ${diffResult.e}`)
  return { sampled: 0, corrections: [], updated: [], summary: '', error: diffResult.e }
}

const diff = diffResult.v || {}
const sampled = diff.sampled || 0
const corrections = diff.corrections || []
log(`Diff: sampled ${sampled}, found ${corrections.length} genuine correction(s)`)

if (!corrections.length) {
  return { sampled, corrections: [], updated: [], summary: 'No corrections found — current tagging rules held over the window.' }
}

phase('Learn')
const learnResult = await settle(agent(
  `Refine the RAHU tagging rules from these user corrections, per the label-corrections
   skill: ${JSON.stringify(corrections)}
   For each correction, write a correcting 'tagging' fact — upsert onto the SAME key as
   the original rule where you can infer it (usually the "applied" label's rule key, and/or
   the "current" label's rule key), refining the rule rather than logging the one-off
   incident:
   python3 .claude/memory/store.py add --kind tagging --key "<label-key>" --text "<refined rule>; note: user moved <sender/subject pattern> mail from <applied> to <current>"
   NEVER invent a label that isn't already in the learned labelmap / live label list —
   skip any correction that would require one. Return {updated:[<keys written>], summary}.`,
  { agentType: 'memory-curator', label: 'learn', phase: 'Learn',
    schema: { type: 'object',
              properties: { updated: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } },
              required: ['updated'] } }
))

if (!learnResult.ok) {
  log(`Learn phase failed: ${learnResult.e}`)
  return { sampled, corrections, updated: [], summary: '', error: learnResult.e }
}

const learn = learnResult.v || {}
return {
  sampled,
  corrections,
  updated: learn.updated || [],
  summary: learn.summary || '',
}
