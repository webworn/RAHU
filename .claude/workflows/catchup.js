export const meta = {
  name: 'rahu-catchup',
  description: 'Dimension\'s "Catch Up": every new email gets a 1-line summary AND a ready-to-send Gmail draft. Triage → per-message draft, pipelined so a draft starts the moment its message is triaged.',
  phases: [
    { title: 'Triage', detail: 'summarize + label new mail', model: 'haiku' },
    { title: 'Draft', detail: 'one voice draft per message', model: 'sonnet' },
  ],
}

const MSG_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    sender: { type: 'string' },
    subject: { type: 'string' },
    summary: { type: 'string' },
    ts: { type: 'string', description: 'message internalDate/epoch — used to advance the cursor' },
    priority: { type: 'string' },
    needsReply: { type: 'boolean' },
  },
  required: ['id', 'sender', 'subject', 'summary', 'needsReply'],
}
const DRAFT_SCHEMA = {
  type: 'object',
  properties: { id: { type: 'string' }, gist: { type: 'string' } },
  required: ['id', 'gist'],
}
const FAILCOUNT_SCHEMA = {
  type: 'object',
  properties: { id: { type: 'string' }, count: { type: 'number' } },
  required: ['id', 'count'],
}

const WINDOW = (args && args.window) || '1d'
const POISON_THRESHOLD = 3

// 1) Get the list of new messages (cheap, single triage agent labels them all).
phase('Triage')
const digest = await agent(
  `List unread Gmail and return one entry per message with a 1-line summary.
   Handle each message exactly once across repeated runs — /catchup is often looped, and the
   window (${WINDOW}) is far wider than the loop interval, so the same mail resurfaces every pass:
   1. Recall the cursor: python3 .claude/memory/store.py recall --kind cursor --key catchup:watermark --k 1
      Return whatever value you recalled (epoch ms) verbatim as \`watermark\`, or "" if none was found.
   2. Build the Gmail query from that: if you recalled a watermark, query after:<the watermark
      converted to whole seconds, i.e. floor(ms/1000)> — this fetches only genuinely-new mail
      instead of the entire window every pass. Only when no watermark exists, fall back to
      newer_than:${WINDOW}.
   3. EXCLUDE any message already carrying the RAHU processed marker — a cheap backstop in case
      the query-side watermark and reality ever drift.
   4. Recall poisoned ids: python3 .claude/memory/store.py recall --kind failcount --k 20
      EXCLUDE any message id with a recalled count >= ${POISON_THRESHOLD} from processing this pass
      (list its id in \`skippedPoisoned\` instead of \`messages\`, so it stops holding the cursor
      back). Return the counts you saw for ids present in that recall as \`failcounts\`.
   5. Recall voice notes once: python3 .claude/memory/store.py recall --kind voice --k 3 --max-chars 600
      Return that text verbatim as \`voiceFacts\` — the draft phase reuses it and must NOT recall
      voice itself.
   6. Label/prioritize the remainder (email-triage skill) and summarize each.
   Do NOT advance the cursor — this workflow advances it only after drafting succeeds.
   Return {messages:[...]} of ONLY the new-this-pass messages, each with its internalDate/epoch as \`ts\`.`,
  { agentType: 'inbox-triage', label: 'triage', phase: 'Triage',
    schema: { type: 'object',
              properties: {
                messages: { type: 'array', items: MSG_SCHEMA },
                watermark: { type: 'string', description: 'the cursor value recalled this pass (epoch ms), or "" if none' },
                skippedPoisoned: { type: 'array', items: { type: 'string' },
                                    description: `message ids excluded because they have failed to draft >=${POISON_THRESHOLD} times` },
                failcounts: { type: 'array', items: FAILCOUNT_SCHEMA,
                              description: 'fail counts seen during the poison-id recall, as {id, count} pairs' },
                voiceFacts: { type: 'string', description: 'voice notes recalled once for this pass, reused by every draft' },
              },
              required: ['messages'] } }
)
const msgs = ((digest && digest.messages) || []).filter(m => m.needsReply)
const voiceFacts = (digest && digest.voiceFacts) || ''
const skippedPoisoned = (digest && digest.skippedPoisoned) || []
const failcounts = Object.fromEntries(((digest && digest.failcounts) || []).map(f => [f.id, f.count]))
log(`${msgs.length} messages need a Catch-Up draft`)
if (skippedPoisoned.length) {
  log(`${skippedPoisoned.length} poisoned message(s) skipped (>=${POISON_THRESHOLD} failed drafts), so they stop holding the cursor back: ${skippedPoisoned.join(', ')}`)
}

// 2) Pipeline: each message flows straight into its own voice draft (no barrier).
// settle() so one failed draft can't discard every sibling that already succeeded.
// voiceFacts was recalled once above and is injected into every draft prompt so the
// drafter never has to spend a Bash round-trip re-recalling the same voice notes.
phase('Draft')
const settle = (p) => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e) }))
const results = await pipeline(
  msgs,
  (m) => settle(agent(
    `Catch-Up draft: reply in the user's voice to Gmail id ${m.id} — "${m.subject}" from ${m.sender}. Context summary: "${m.summary}". Voice notes (already recalled for this pass — do NOT recall voice again): "${voiceFacts}". Save as a Gmail draft on the thread, return {id, gist}.`,
    { agentType: 'voice-drafter', label: `draft:${m.sender}`, phase: 'Draft', schema: DRAFT_SCHEMA }
  )).then(r => ({ ...r, id: m.id, ts: m.ts }))
)

const failed = results.filter(r => r && !r.ok)
if (failed.length) log(`${failed.length}/${msgs.length} drafts FAILED — cursor will not advance past them`)

// Checkpoint only up to the first failure: never skip a message we couldn't draft.
const tsNum = (x) => Number(x && x.ts)
const failedTs = failed.map(tsNum).filter(Number.isFinite)
const firstGap = failedTs.length ? Math.min(...failedTs) : Infinity
const safeTs = msgs.map(tsNum).filter(t => Number.isFinite(t) && t < firstGap)

// Only ever persist when there's something to persist: a real cursor advance, or a
// failcount to bump. A no-op pass (nothing new, nothing failed) skips the agent call.
const priorWatermarkRaw = digest && digest.watermark
const hasPriorWatermark = priorWatermarkRaw !== undefined && priorWatermarkRaw !== null &&
  priorWatermarkRaw !== '' && Number.isFinite(Number(priorWatermarkRaw))
const priorWatermark = hasPriorWatermark ? Number(priorWatermarkRaw) : null
const newMark = safeTs.length ? Math.max(...safeTs) : null
const cursorAdvances = newMark !== null && (!hasPriorWatermark || newMark > priorWatermark)

const persistCmds = []
if (cursorAdvances) {
  persistCmds.push(`python3 .claude/memory/store.py add --kind cursor --key catchup:watermark --text "${newMark}"`)
}
for (const r of failed) {
  const nextCount = (Number(failcounts[r.id]) || 0) + 1
  persistCmds.push(`python3 .claude/memory/store.py add --kind failcount --key ${r.id} --text "${nextCount}"`)
  if (nextCount >= POISON_THRESHOLD) {
    log(`Message ${r.id} has now failed ${nextCount} times in a row — POISONED, will be skipped on future passes`)
  }
}
if (persistCmds.length) {
  await agent(
    `Persist catchup state, run exactly these commands and nothing else:\n${persistCmds.join('\n')}`,
    { agentType: 'inbox-triage', label: 'cursor', phase: 'Draft' })
}

const drafts = results.filter(r => r && r.ok).map(r => r.v).filter(Boolean)
return {
  caughtUp: msgs.length,
  drafted: drafts.length,
  draftsFailed: failed.length,
  items: msgs.map(m => ({ from: m.sender, subject: m.subject, summary: m.summary,
                          draft: (drafts.find(d => d.id === m.id) || {}).gist || '(draft failed)' })),
}
