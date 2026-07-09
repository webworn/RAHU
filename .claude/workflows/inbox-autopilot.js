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
   1. Recall the watermark: python3 .claude/memory/store.py recall --kind pref --key autopilot:watermark --k 1
   2. Consider ONLY messages newer than that watermark AND not already carrying the RAHU processed marker. Exclude everything already processed from the returned list.
   3. Label/prioritize each new message (email-triage skill) and assign an action: reply | task | fyi | ignore.
   4. After labeling, advance the watermark to the newest message's timestamp:
      python3 .claude/memory/store.py add --kind pref --key autopilot:watermark --text "<epoch_or_ISO of newest processed message>"
   Return {messages:[...]} containing ONLY the new-this-pass messages.`,
  { agentType: 'inbox-triage', label: 'triage', phase: 'Triage',
    schema: { type: 'object', properties: { messages: { type: 'array', items: MSG_SCHEMA } }, required: ['messages'] } }
)
const msgs = (digest && digest.messages) || []
const toReply = msgs.filter(m => m.action === 'reply')
const toTask = msgs.filter(m => m.action === 'task' || m.action === 'reply')
log(`Autopilot pass: ${msgs.length} new — ${toReply.length} drafts, ${toTask.length} tasks`)

if (!msgs.length) return { processed: 0, drafted: 0, tasked: 0, note: 'inbox quiet' }

phase('Autopilot')
const [drafts, tasks] = await parallel([
  () => parallel(toReply.map(m => () =>
    agent(`Autopilot draft: reply in the user's voice to Gmail id ${m.id} ("${m.subject}" from ${m.sender}). FIRST check the thread doesn't already have a RAHU/unsent draft — if one exists, keep it and return {id, gist:"existing draft kept"} instead of creating a duplicate. Otherwise recall voice and save as a Gmail draft. Return {id, gist}.`,
      { agentType: 'voice-drafter', label: `draft:${m.sender}`, phase: 'Autopilot',
        schema: { type: 'object', properties: { id: { type: 'string' }, gist: { type: 'string' } }, required: ['id'] } }))),
  () => toTask.length
    ? agent(`Create deduped Google Tasks for these messages: ${JSON.stringify(toTask)}. Return {tasks:[...]}.`,
        { agentType: 'action-extractor', label: 'tasks', phase: 'Autopilot' })
    : Promise.resolve({ tasks: [] }),
])

return {
  processed: msgs.length,
  drafted: (drafts || []).filter(Boolean).length,
  tasked: ((tasks && tasks.tasks) || []).length,
}
