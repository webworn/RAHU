export const meta = {
  name: 'rahu-inbox-autopilot',
  description: 'Dimension\'s Inbox Autopilot for one pass: triage every new message, then for each tag an action + a tone-matched Gmail draft, and extract tasks. Designed to be called repeatedly by the /autopilot loop. Drafts only — never sends unless you have explicitly enabled auto-send.',
  phases: [
    { title: 'Triage', detail: 'label every new message', model: 'haiku' },
    { title: 'Autopilot', detail: 'draft + task per actionable message' },
  ],
}

// Single source of truth for the poison cap, quoted into both the triage prompt (English,
// since triage does the actual exclusion) and the workflow's own threshold-crossed log —
// bump it here and both sides move together instead of silently drifting apart.
const POISON_THRESHOLD = 3

const MSG_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' }, sender: { type: 'string' }, subject: { type: 'string' },
    ts: { type: 'string', description: 'message internalDate/epoch (ms) — used to advance the watermark' },
    priority: { type: 'string' }, action: { type: 'string', enum: ['reply', 'task', 'fyi', 'ignore'] },
  },
  required: ['id', 'sender', 'subject', 'action'],
}

// Everything triage hands back this pass: the new messages, which ids it skipped as
// poisoned, the fail counts it saw (so the workflow can bump them), the voice profile
// hoisted once for every drafter, and the watermark value it recalled (so the workflow
// can tell whether this pass actually advanced anything).
const DIGEST_SCHEMA = {
  type: 'object',
  properties: {
    messages: { type: 'array', items: MSG_SCHEMA },
    skippedPoisoned: {
      type: 'array', items: { type: 'string' },
      description: `ids excluded this pass because their fail count is >= ${POISON_THRESHOLD} — left out of messages so they stop blocking the cursor`,
    },
    failcounts: {
      type: 'object',
      description: 'map of message id -> fail count as recalled from memory this pass, for any id mentioned',
    },
    voiceFacts: {
      type: 'string',
      description: 'voice profile recalled once for the whole pass; every draft agent reuses this instead of recalling it again',
    },
    watermark: {
      type: 'string',
      description: 'watermark epoch-ms value as recalled this pass, or "" if none existed yet',
    },
  },
  required: ['messages'],
}

// Overlapping /loop windows would re-surface the same mail every pass. Two guards keep
// each message handled exactly once: (a) a per-user watermark in memory that triage
// advances each pass, and (b) the RAHU "processed" label marker. Triage must return
// ONLY genuinely-new messages so the draft phase never re-drafts an old thread.
const SINCE = (args && args.since) || '2h'

phase('Triage')
const digest = await agent(
  `Triage unread Gmail, processing each message exactly once across repeated autopilot passes.
   Steps 1, 3, and 4 are independent recalls — none needs another's output, so run them back
   to back without waiting between them:
   1. Recall the watermark: python3 .claude/memory/store.py recall --kind cursor --key autopilot:watermark --k 1
      Its value, if any, is an epoch-MILLISECONDS timestamp.
   2. Build the search query from that watermark instead of re-reading the same window every pass:
      if a watermark was recalled, compute epoch-seconds = floor(watermark_ms / 1000) and list unread Gmail
      matching \`after:<epoch-seconds>\` — this filters at the Gmail query level so already-processed mail is
      never even fetched. If no watermark exists yet, fall back to \`newer_than:${SINCE}\`.
   3. Recall fail counts: python3 .claude/memory/store.py recall --kind failcount --k 20
      (each is a message id and how many times it has failed to draft). EXCLUDE any message whose count is
      >= ${POISON_THRESHOLD} from the messages you return — put its id in skippedPoisoned instead, so a
      message that can never draft successfully stops pinning the cursor forever. Return whatever counts
      you saw as failcounts.
   4. Recall the voice profile ONCE for this whole pass: python3 .claude/memory/store.py recall --kind voice --k 3 --max-chars 600
      Return that text verbatim as voiceFacts — this replaces every downstream drafter recalling it individually.
   5. Consider ONLY messages not already carrying the RAHU processed marker. Exclude everything already
      processed from the returned list — this is just a cheap backstop for the boundary second the
      after: filter might straddle, not the primary filter anymore.
   6. Label/prioritize each remaining new message (email-triage skill) and assign an action: reply | task | fyi | ignore.
   Do NOT advance the watermark — this workflow advances it only after the drafting phase succeeds.
   Return {messages, skippedPoisoned, failcounts, voiceFacts, watermark} where messages contains ONLY the
   new-this-pass, non-poisoned messages, each with its internalDate/epoch (ms) as \`ts\`.`,
  { agentType: 'inbox-triage', label: 'triage', phase: 'Triage', schema: DIGEST_SCHEMA }
)
const msgs = (digest && digest.messages) || []
const voiceFacts = (digest && digest.voiceFacts) || ''
const failcounts = (digest && digest.failcounts) || {}
const skippedPoisoned = (digest && digest.skippedPoisoned) || []
const recalledWatermark = Number(digest && digest.watermark) || 0
const toReply = msgs.filter(m => m.action === 'reply')
const toTask = msgs.filter(m => m.action === 'task' || m.action === 'reply')
log(`Autopilot pass: ${msgs.length} new — ${toReply.length} drafts, ${toTask.length} tasks`)
if (skippedPoisoned.length) log(`${skippedPoisoned.length} message(s) skipped as poisoned (>=${POISON_THRESHOLD} failed drafts): ${skippedPoisoned.join(', ')}`)

if (!msgs.length) return { processed: 0, drafted: 0, tasked: 0, note: 'inbox quiet' }

phase('Autopilot')
// settle() keeps one bad message from discarding the whole batch: parallel() is
// Promise.all-shaped, so a single rejected draft used to throw away every sibling
// draft, the tasks, AND the watermark advance.
const settle = (p) => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e) }))

const [draftResults, tasks] = await parallel([
  () => parallel(toReply.map(m => () => settle(
    // NOTE: deliberately no "skip if a draft already exists" clause — voice-drafter has
    // no drafts-list tool, so that instruction was unexecutable theatre. Dedup is the
    // watermark + processed marker below, which are real.
    agent(`Autopilot draft: reply in the user's voice to Gmail id ${m.id} ("${m.subject}" from ${m.sender}).
Voice profile, recalled once this pass: ${voiceFacts || '(none recalled — use a neutral, professional tone)'}
Do NOT recall voice yourself; use exactly the profile given above. Save as a Gmail draft. Return {id, gist}.`,
      { agentType: 'voice-drafter', label: `draft:${m.sender}`, phase: 'Autopilot',
        schema: { type: 'object', properties: { id: { type: 'string' }, gist: { type: 'string' } }, required: ['id'] } })
  ).then(v => ({ ...v, ts: m.ts, id: m.id })))),
  () => toTask.length
    ? settle(agent(`Create deduped Google Tasks for these messages: ${JSON.stringify(toTask)}. Return {tasks:[...]}.`,
        { agentType: 'action-extractor', label: 'tasks', phase: 'Autopilot' })).then(r => r.ok ? r.v : { tasks: [] })
    : Promise.resolve({ tasks: [] }),
])

const failures = (draftResults || []).filter(r => r && !r.ok)
if (failures.length) log(`${failures.length}/${toReply.length} drafts FAILED — watermark will not advance past them`)

// Checkpoint only up to the first failure. Advancing past a message we could not finish
// would skip it forever (the inverse bug: silent data loss instead of duplicates).
const tsOf = (m) => Number(m && m.ts)
const failedTs = failures.map(tsOf).filter(Number.isFinite)
const firstGap = failedTs.length ? Math.min(...failedTs) : Infinity
const safeTs = msgs.map(tsOf).filter(t => Number.isFinite(t) && t < firstGap)
const newMark = safeTs.length ? Math.max(...safeTs) : null
const cursorAdvances = newMark !== null && newMark > recalledWatermark

// Poison cap: a message that keeps failing to draft would otherwise pin the cursor
// behind it forever (checkpoint-to-first-failure). Bump its fail count here; triage
// excludes anything >= POISON_THRESHOLD on the NEXT pass, so it stops blocking instead
// of retrying forever, without ever silently losing a message.
const failcountUpdates = failures.filter(r => r && r.id).map(r => {
  const prev = Number(failcounts[r.id] || 0)
  const next = prev + 1
  if (next >= POISON_THRESHOLD) log(`Message ${r.id} crossed the poison threshold (${next} failed drafts) — will be excluded from future passes`)
  return { id: r.id, count: next }
})

// Mirror image of the bump above: a message that had prior failures but drafted fine
// this time is no longer poisoning anything, so drop its stale failcount record instead
// of letting it sit in the store forever (it would otherwise crowd the triage agent's
// `recall --k 20` window and could eventually hide a newly-misbehaving message's count).
const successIds = new Set((draftResults || []).filter(r => r && r.ok && r.id).map(r => r.id))
const staleFailcountIds = Object.keys(failcounts).filter(id => successIds.has(id) && Number(failcounts[id]) > 0)

const persistCommands = [
  ...(cursorAdvances ? [`python3 .claude/memory/store.py add --kind cursor --key autopilot:watermark --text "${newMark}"`] : []),
  ...failcountUpdates.map(({ id, count }) => `python3 .claude/memory/store.py add --kind failcount --key "${id}" --text "${count}"`),
  ...staleFailcountIds.map(id => `python3 .claude/memory/store.py forget --kind failcount --key "${id}"`),
]

// Nothing to persist: no cursor progress beyond what triage already recalled, no newly-
// failed messages to record, and no stale failcounts to clear. Skip the agent call
// entirely rather than spend a round trip confirming a no-op.
if (persistCommands.length) {
  await agent(
    `Persist autopilot state, exactly these commands and nothing else:\n     ${persistCommands.join('\n     ')}`,
    { agentType: 'inbox-triage', label: 'watermark', phase: 'Autopilot' })
}

return {
  processed: msgs.length,
  drafted: (draftResults || []).filter(r => r && r.ok).length,
  draftsFailed: failures.length,
  tasked: ((tasks && tasks.tasks) || []).length,
  skippedPoisoned: skippedPoisoned.length,
}
