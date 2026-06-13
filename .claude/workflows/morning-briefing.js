export const meta = {
  name: 'rahu-morning-briefing',
  description: 'RAHU daily briefing: triage overnight mail, draft replies in the user voice, extract Google Tasks, prep today\'s meetings, then synthesize one Google Doc. Dimension\'s Morning Briefing, Google-native.',
  phases: [
    { title: 'Triage', detail: 'label + prioritize overnight mail', model: 'haiku' },
    { title: 'Act', detail: 'draft replies + extract tasks + meeting prep' },
    { title: 'Synthesize', detail: 'assemble the briefing Google Doc', model: 'sonnet' },
  ],
}

// ---- structured contracts (forces clean JSON out of each agent) ----
const DIGEST_SCHEMA = {
  type: 'object',
  properties: {
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sender: { type: 'string' },
          context: { type: 'string' },
          subject: { type: 'string' },
          priority: { type: 'string', enum: ['P1-now', 'P2-soon', 'P3-fyi', 'P4-bulk'] },
          needsReply: { type: 'boolean' },
          suggestTask: { type: 'boolean' },
        },
        required: ['id', 'sender', 'subject', 'priority', 'needsReply', 'suggestTask'],
      },
    },
  },
  required: ['messages'],
}
const DRAFT_SCHEMA = {
  type: 'object',
  properties: { id: { type: 'string' }, gist: { type: 'string' }, flagged: { type: 'boolean' } },
  required: ['id', 'gist'],
}
const TASKS_SCHEMA = {
  type: 'object',
  properties: { tasks: { type: 'array', items: { type: 'string' } } },
  required: ['tasks'],
}

// window can be overridden: Workflow({ name:'rahu-morning-briefing', args:{ window:'2d', mode:'morning' } })
const WINDOW = (args && args.window) || '1d'
const MODE = (args && args.mode) || 'morning'

phase('Triage')
const digest = await agent(
  `Triage all unread Gmail from the overnight window (newer_than:${WINDOW}). Apply RAHU priority + category labels via gmail_modify_labels using the learned tagging rules in the memory store. Return the digest.`,
  { agentType: 'inbox-triage', label: 'triage:overnight', phase: 'Triage', schema: DIGEST_SCHEMA }
)

const items = (digest && digest.messages) || []
const needReply = items.filter(m => m.needsReply)
const needTask = items.filter(m => m.suggestTask)
log(`Triaged ${items.length} messages — ${needReply.length} need replies, ${needTask.length} → tasks`)

phase('Act')
// All three act-streams run concurrently; drafts fan out one agent per message.
const [drafts, tasks, preps] = await parallel([
  () => parallel(needReply.map(m => () =>
    agent(
      `Draft a reply in the user's voice to Gmail message id ${m.id} — "${m.subject}" from ${m.sender} (${m.context || 'no stored context'}). Recall voice for this audience first. Save it as a Gmail draft on the thread. Return {id, gist, flagged} (flagged=true if high-stakes recipient needing an Opus re-draft).`,
      { agentType: 'voice-drafter', label: `draft:${m.sender}`, phase: 'Act', schema: DRAFT_SCHEMA }
    ))),
  () => needTask.length
    ? agent(`Extract action items and create deduped Google Tasks from these flagged messages: ${JSON.stringify(needTask)}. Return {tasks:[...]} as short titles.`,
        { agentType: 'action-extractor', label: 'tasks', phase: 'Act', schema: TASKS_SCHEMA })
    : Promise.resolve({ tasks: [] }),
  () => agent(`Prepare briefs for today's calendar meetings (meeting-prep skill). Write each into its Calendar event description or a linked Google Doc. Return one short line per meeting with its prep link.`,
        { agentType: 'meeting-prep', label: 'prep:today', phase: 'Act' }),
])

const cleanDrafts = (drafts || []).filter(Boolean)
const flagged = cleanDrafts.filter(d => d.flagged)
if (flagged.length) log(`${flagged.length} high-stakes drafts flagged for Opus re-draft / human review`)

phase('Synthesize')
const briefing = await agent(
  `Assemble today's RAHU ${MODE} briefing as a Google Doc titled "RAHU Briefing — <today>". Follow the morning-briefing skill ordering (Today's map → Overnight digest → Action items → Catch Up → Needs you). Inputs:\n` +
  `DIGEST: ${JSON.stringify(items).slice(0, 6000)}\n` +
  `DRAFTS (gist per P1/P2): ${JSON.stringify(cleanDrafts)}\n` +
  `TASKS: ${JSON.stringify(tasks)}\n` +
  `MEETING PREPS: ${JSON.stringify(preps)}\n` +
  `Reference drafts by gist (they are already saved in Gmail). Put flagged drafts under "Needs you". Return the Doc URL.`,
  { agentType: 'briefing-writer', label: 'briefing', phase: 'Synthesize' }
)

return {
  briefing,
  counts: { triaged: items.length, drafted: cleanDrafts.length, flagged: flagged.length, tasks: (tasks && tasks.tasks || []).length },
}
