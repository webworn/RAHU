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
  `List unread Gmail (newer_than:${WINDOW}), label/prioritize each (email-triage skill), and return one entry per message with a 1-line summary. Return {messages:[...]}.`,
  { agentType: 'inbox-triage', label: 'triage', phase: 'Triage',
    schema: { type: 'object', properties: { messages: { type: 'array', items: MSG_SCHEMA } }, required: ['messages'] } }
)
const msgs = ((digest && digest.messages) || []).filter(m => m.needsReply)
log(`${msgs.length} messages need a Catch-Up draft`)

// 2) Pipeline: each message flows straight into its own voice draft (no barrier).
phase('Draft')
const results = await pipeline(
  msgs,
  (m) => agent(
    `Catch-Up draft: reply in the user's voice to Gmail id ${m.id} — "${m.subject}" from ${m.sender}. Context summary: "${m.summary}". Recall voice first, save as a Gmail draft on the thread, return {id, gist}.`,
    { agentType: 'voice-drafter', label: `draft:${m.sender}`, phase: 'Draft', schema: DRAFT_SCHEMA }
  )
)

const drafts = results.filter(Boolean)
return {
  caughtUp: msgs.length,
  drafted: drafts.length,
  items: msgs.map(m => ({ from: m.sender, subject: m.subject, summary: m.summary,
                          draft: (drafts.find(d => d.id === m.id) || {}).gist || '(draft pending)' })),
}
