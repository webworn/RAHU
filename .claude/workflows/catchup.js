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

const WINDOW = (args && args.window) || '1d'

// 1) Get the list of new messages (cheap, single triage agent labels them all).
phase('Triage')
const digest = await agent(
  `List unread Gmail (newer_than:${WINDOW}) and return one entry per message with a 1-line summary.
   Handle each message exactly once across repeated runs — /catchup is often looped, and the
   window (${WINDOW}) is far wider than the loop interval, so the same mail resurfaces every pass:
   1. Recall the cursor: python3 .claude/memory/store.py recall --kind cursor --key catchup:watermark --k 1
   2. EXCLUDE messages older than that cursor, and any already carrying the RAHU processed marker.
   3. Label/prioritize the remainder (email-triage skill) and summarize each.
   Do NOT advance the cursor — this workflow advances it only after drafting succeeds.
   Return {messages:[...]} of ONLY the new-this-pass messages, each with its internalDate/epoch as \`ts\`.`,
  { agentType: 'inbox-triage', label: 'triage', phase: 'Triage',
    schema: { type: 'object', properties: { messages: { type: 'array', items: MSG_SCHEMA } }, required: ['messages'] } }
)
const msgs = ((digest && digest.messages) || []).filter(m => m.needsReply)
log(`${msgs.length} messages need a Catch-Up draft`)

// 2) Pipeline: each message flows straight into its own voice draft (no barrier).
// settle() so one failed draft can't discard every sibling that already succeeded.
phase('Draft')
const settle = (p) => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e) }))
const results = await pipeline(
  msgs,
  (m) => settle(agent(
    `Catch-Up draft: reply in the user's voice to Gmail id ${m.id} — "${m.subject}" from ${m.sender}. Context summary: "${m.summary}". Recall voice first, save as a Gmail draft on the thread, return {id, gist}.`,
    { agentType: 'voice-drafter', label: `draft:${m.sender}`, phase: 'Draft', schema: DRAFT_SCHEMA }
  )).then(r => ({ ...r, ts: m.ts }))
)

const failed = results.filter(r => r && !r.ok)
if (failed.length) log(`${failed.length}/${msgs.length} drafts FAILED — cursor will not advance past them`)

// Checkpoint only up to the first failure: never skip a message we couldn't draft.
const tsNum = (x) => Number(x && x.ts)
const failedTs = failed.map(tsNum).filter(Number.isFinite)
const firstGap = failedTs.length ? Math.min(...failedTs) : Infinity
const safeTs = msgs.map(tsNum).filter(t => Number.isFinite(t) && t < firstGap)
if (safeTs.length) {
  await agent(
    `Persist the catchup cursor, exactly this one command and nothing else:
     python3 .claude/memory/store.py add --kind cursor --key catchup:watermark --text "${Math.max(...safeTs)}"`,
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
