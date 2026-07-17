export const meta = {
  name: 'rahu-inbox-autopilot',
  description: 'Dimension\'s Inbox Autopilot for one pass: triage every new message, then for each tag an action + a tone-matched Gmail draft, and extract tasks. Designed to be called repeatedly by the /autopilot loop. Drafts only — never sends unless you have explicitly enabled auto-send.',
  phases: [
    { title: 'Triage', detail: 'label every new message', model: 'haiku' },
    { title: 'Autopilot', detail: 'draft + task per actionable message' },
  ],
}

const MSG_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' }, sender: { type: 'string' }, subject: { type: 'string' },
    ts: { type: 'string', description: 'message internalDate/epoch — used to advance the watermark' },
    priority: { type: 'string' }, action: { type: 'string', enum: ['reply', 'task', 'fyi', 'ignore'] },
  },
  required: ['id', 'sender', 'subject', 'action'],
}

// Overlapping /loop windows would re-surface the same mail every pass. Two guards keep
// each message handled exactly once: (a) a per-user watermark in memory that triage
// advances each pass, and (b) the RAHU "processed" label marker. Triage must return
// ONLY genuinely-new messages so the draft phase never re-drafts an old thread.
const SINCE = (args && args.since) || '2h'

phase('Triage')
const digest = await agent(
  `Triage unread Gmail newer_than:${SINCE}, but process each message exactly once across repeated autopilot passes:
   1. Recall the watermark: python3 .claude/memory/store.py recall --kind cursor --key autopilot:watermark --k 1
   2. Consider ONLY messages newer than that watermark AND not already carrying the RAHU processed marker. Exclude everything already processed from the returned list.
   3. Label/prioritize each new message (email-triage skill) and assign an action: reply | task | fyi | ignore.
   Do NOT advance the watermark — this workflow advances it only after the drafting phase succeeds.
   Return {messages:[...]} containing ONLY the new-this-pass messages, each with its internalDate/epoch as \`ts\`.`,
  { agentType: 'inbox-triage', label: 'triage', phase: 'Triage',
    schema: { type: 'object', properties: { messages: { type: 'array', items: MSG_SCHEMA } }, required: ['messages'] } }
)
const msgs = (digest && digest.messages) || []
const toReply = msgs.filter(m => m.action === 'reply')
const toTask = msgs.filter(m => m.action === 'task' || m.action === 'reply')
log(`Autopilot pass: ${msgs.length} new — ${toReply.length} drafts, ${toTask.length} tasks`)

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
    agent(`Autopilot draft: reply in the user's voice to Gmail id ${m.id} ("${m.subject}" from ${m.sender}). Recall voice, save as a Gmail draft. Return {id, gist}.`,
      { agentType: 'voice-drafter', label: `draft:${m.sender}`, phase: 'Autopilot',
        schema: { type: 'object', properties: { id: { type: 'string' }, gist: { type: 'string' } }, required: ['id'] } })
  ).then(v => ({ ...v, ts: m.ts })))),
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
const failedTs = (draftResults || []).filter(r => r && !r.ok).map(tsOf).filter(Number.isFinite)
const firstGap = failedTs.length ? Math.min(...failedTs) : Infinity
const safeTs = msgs.map(tsOf).filter(t => Number.isFinite(t) && t < firstGap)
if (safeTs.length) {
  const mark = Math.max(...safeTs)
  await agent(
    `Persist the autopilot cursor, exactly this one command and nothing else:
     python3 .claude/memory/store.py add --kind cursor --key autopilot:watermark --text "${mark}"`,
    { agentType: 'inbox-triage', label: 'watermark', phase: 'Autopilot' })
}

return {
  processed: msgs.length,
  drafted: (draftResults || []).filter(r => r && r.ok).length,
  draftsFailed: failures.length,
  tasked: ((tasks && tasks.tasks) || []).length,
}
