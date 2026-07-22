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
          ts: { type: 'string', description: 'message internalDate/epoch — used to advance the briefing cursor' },
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

// settle() so one failed draft (or an entire failed stream) can't discard everything
// else parallel() already produced — see the Act phase below.
const settle = (p) => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e) }))

phase('Triage')
const digest = await agent(
  `Triage all unread Gmail from the overnight window (newer_than:${WINDOW}). Handle each message exactly
   once across repeated /briefing runs — reruns must not re-draft mail already covered:
   1. Recall the briefing cursor: python3 .claude/memory/store.py recall --kind cursor --key briefing:lastrun --k 1
   2. EXCLUDE any message at or before that cursor (already covered by a prior briefing this window).
   Apply RAHU priority + category labels via mcp__google-workspace__modify_gmail_message_labels using
   the learned tagging rules in the memory store. Return the digest — ONLY new-this-run messages, each
   with its internalDate/epoch as \`ts\` (needed to advance the cursor after Synthesize succeeds).`,
  { agentType: 'inbox-triage', label: 'triage:overnight', phase: 'Triage', schema: DIGEST_SCHEMA }
)

const items = (digest && digest.messages) || []
const needReply = items.filter(m => m.needsReply)
const needTask = items.filter(m => m.suggestTask)
log(`Triaged ${items.length} messages — ${needReply.length} need replies, ${needTask.length} → tasks`)

phase('Act')
// All three act-streams run concurrently; drafts fan out one agent per message. settle()
// wraps BOTH each individual draft AND each of the three streams: parallel() is
// Promise.all-shaped, so without this a single rejected draft used to discard every
// sibling draft, the tasks, the meeting preps — and Synthesize never ran at all.
const [draftsOutcome, tasksOutcome, prepsOutcome] = await parallel([
  () => settle(parallel(needReply.map(m => () => settle(
    agent(
      `Draft a reply in the user's voice to Gmail message id ${m.id} — "${m.subject}" from ${m.sender} (${m.context || 'no stored context'}). Recall voice for this audience first. Save it as a Gmail draft on the thread. Return {id, gist, flagged} (flagged=true if high-stakes recipient needing an Opus re-draft).`,
      { agentType: 'voice-drafter', label: `draft:${m.sender}`, phase: 'Act', schema: DRAFT_SCHEMA }
    )
  ).then(r => ({ ...r, sender: m.sender, subject: m.subject }))))),
  () => settle(needTask.length
    ? agent(`Extract action items and create deduped Google Tasks from these flagged messages: ${JSON.stringify(needTask)}. Return {tasks:[...]} as short titles.`,
        { agentType: 'action-extractor', label: 'tasks', phase: 'Act', schema: TASKS_SCHEMA })
    : Promise.resolve({ tasks: [] })),
  () => settle(agent(`Prepare briefs for today's calendar meetings (meeting-prep skill). Write each into its Calendar event description or a linked Google Doc. Return one short line per meeting with its prep link.`,
        { agentType: 'meeting-prep', label: 'prep:today', phase: 'Act' })),
])

if (!draftsOutcome.ok) log(`Draft stream failed entirely: ${draftsOutcome.e}`)
const draftAttempts = draftsOutcome.ok ? (draftsOutcome.v || []) : []
const draftFailures = draftAttempts.filter(r => r && !r.ok)
if (draftFailures.length) log(`${draftFailures.length}/${needReply.length} drafts FAILED (Synthesize still runs with the rest)`)
const cleanDrafts = draftAttempts.filter(r => r && r.ok).map(r => r.v).filter(Boolean)

if (!tasksOutcome.ok) log(`Task extraction FAILED: ${tasksOutcome.e}`)
const tasks = tasksOutcome.ok ? tasksOutcome.v : { tasks: [] }

if (!prepsOutcome.ok) log(`Meeting prep FAILED: ${prepsOutcome.e}`)
const preps = prepsOutcome.ok ? prepsOutcome.v : null

const flagged = cleanDrafts.filter(d => d.flagged)

// Opus escalation: sonnet flagged these as high-stakes (investor/board/lawyer, etc).
// Re-run each through voice-drafter-opus, settle()d the same way, and replace the
// sonnet draft's gist in place on success. Anything still failing goes to Synthesize
// under "Needs you" instead of silently vanishing.
let needsYou = []
if (flagged.length) {
  log(`${flagged.length} high-stakes drafts flagged — escalating to voice-drafter-opus`)
  const opusResults = await parallel(flagged.map(d => () => settle(
    agent(
      `Re-draft Gmail message id ${d.id} — "${d.subject}" from ${d.sender} — with extra care. The
       sonnet-tier draft flagged this recipient as high-stakes (investor/board/lawyer or similar).
       Recall voice + contact context first, then replace the existing Gmail draft on the thread
       with an improved version. Return {id, gist}.`,
      { agentType: 'voice-drafter-opus', label: `opus-redraft:${d.sender}`, phase: 'Act', schema: DRAFT_SCHEMA }
    )
  ).then(r => ({ ...r, id: d.id, sender: d.sender, subject: d.subject }))))

  const opusFailed = opusResults.filter(r => r && !r.ok)
  const opusOk = opusResults.filter(r => r && r.ok)
  if (opusFailed.length) log(`${opusFailed.length}/${flagged.length} Opus re-drafts FAILED — needs you`)

  for (const r of opusOk) {
    const idx = cleanDrafts.findIndex(d => d.id === r.id)
    // Clear flagged: the Opus pass already handled it, so it's no longer a "needs you" case.
    if (idx !== -1) cleanDrafts[idx] = { ...cleanDrafts[idx], gist: r.v.gist, flagged: false, opusRedrafted: true }
  }
  needsYou = opusFailed.map(r => ({ id: r.id, sender: r.sender, subject: r.subject, reason: r.e }))
}

// Budgeted truncation: JSON.stringify(...).slice(0, N) can cut a message mid-object and
// feed the writer unparseable JSON. Instead drop WHOLE messages, lowest priority first,
// until the serialized digest fits the budget — the result is always valid JSON.
const DIGEST_BUDGET = 6000
function truncateDigest(list, budget) {
  const kept = list.slice()
  const fits = () => JSON.stringify(kept).length <= budget
  let dropped = 0
  // Drop order: bulk/fyi/soon first — never touch P1-now until nothing else is left.
  for (const tier of ['P4-bulk', 'P3-fyi', 'P2-soon']) {
    while (!fits() && kept.some(m => m.priority === tier)) {
      kept.splice(kept.findIndex(m => m.priority === tier), 1)
      dropped++
    }
    if (fits()) break
  }
  // Last resort: even P1-now-only still doesn't fit — drop from the end rather than
  // ship truncated/invalid JSON.
  while (!fits() && kept.length > 0) {
    kept.pop()
    dropped++
  }
  return { kept, dropped }
}
const { kept: digestForBriefing, dropped: digestDropped } = truncateDigest(items, DIGEST_BUDGET)
if (digestDropped) log(`Digest truncated for Synthesize: dropped ${digestDropped}/${items.length} messages to fit the ${DIGEST_BUDGET}-char budget`)

phase('Synthesize')
const briefing = await agent(
  `Assemble today's RAHU ${MODE} briefing as a Google Doc titled "RAHU Briefing — <today>". ` +
  `FIRST use search_docs to look for a Doc with that exact title — if today's briefing already exists ` +
  `(e.g. this is a rerun), read it with get_doc_content and update it in place with modify_doc_text ` +
  `instead of creating a duplicate; only fall back to create_doc when no matching Doc is found. ` +
  `Follow the morning-briefing skill ordering (Today's map → Overnight digest → Action items → Catch Up → Needs you). Inputs:\n` +
  `DIGEST: ${JSON.stringify(digestForBriefing)}\n` +
  `DRAFTS (gist per P1/P2): ${JSON.stringify(cleanDrafts)}\n` +
  `TASKS: ${JSON.stringify(tasks)}\n` +
  `MEETING PREPS: ${JSON.stringify(preps)}\n` +
  `NEEDS_YOU (Opus re-draft failed or unavailable — handle personally): ${JSON.stringify(needsYou)}\n` +
  `Reference drafts by gist (they are already saved in Gmail). Put NEEDS_YOU items under "Needs you". Return the Doc URL.`,
  { agentType: 'briefing-writer', label: 'briefing', phase: 'Synthesize' }
)

// Advance the briefing cursor only now that Synthesize has succeeded (a thrown Synthesize
// agent() call above would already have aborted the workflow before reaching here), and
// only when there was anything new — an empty/quiet run leaves the cursor untouched.
if (items.length) {
  const tsNum = (x) => Number(x && x.ts)
  const validTs = items.map(tsNum).filter(Number.isFinite)
  const cursorValue = validTs.length ? Math.max(...validTs) : Date.now()
  await agent(
    `Persist the briefing cursor, exactly this one command and nothing else:
     python3 .claude/memory/store.py add --kind cursor --key briefing:lastrun --text "${cursorValue}"`,
    { agentType: 'inbox-triage', label: 'cursor', phase: 'Synthesize' })
}

return {
  briefing,
  counts: {
    triaged: items.length,
    digestDropped,
    drafted: cleanDrafts.length,
    draftsFailed: draftFailures.length,
    flagged: flagged.length,
    opusFailed: needsYou.length,
    tasks: (tasks && tasks.tasks || []).length,
  },
}
