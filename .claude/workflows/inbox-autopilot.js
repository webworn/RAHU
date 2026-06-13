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

// The loop passes the high-water mark so each pass only handles genuinely new mail.
const SINCE = (args && args.since) || '2h'

phase('Triage')
const digest = await agent(
  `Triage unread Gmail newer_than:${SINCE}. Label/prioritize each (email-triage skill) and assign an action: reply | task | fyi | ignore. Return {messages:[...]}.`,
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
    agent(`Autopilot draft: reply in the user's voice to Gmail id ${m.id} ("${m.subject}" from ${m.sender}). Recall voice, save as a Gmail draft. Return {id, gist}.`,
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
