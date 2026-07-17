export const meta = {
  name: 'rahu-learn-voice',
  description: 'Learn the user\'s writing voice (from Sent mail) and tagging conventions (from existing Gmail labels) and distill them into the local memory store. Makes RAHU sound + tag like the user. Run on setup and periodically to stay current.',
  phases: [
    { title: 'Learn', detail: 'voice from Sent + tagging from labels', model: 'sonnet' },
    { title: 'Report', detail: 'what the profile now knows' },
  ],
}

phase('Learn')
// Two independent learners run concurrently, each writing to its own memory namespace.
const [voice, tagging] = await parallel([
  () => agent(
    `Learn the user's WRITING VOICE per the memory-curator skill. Sample ~30 recent Sent messages spanning audiences (in:sent newer_than:90d). Distill greeting/sign-off/tone/length/emoji patterns PER AUDIENCE and write each as a 'voice' fact to the store (add --kind voice). Do not store raw emails. Return a short list of the patterns learned.`,
    { agentType: 'memory-curator', label: 'learn:voice', phase: 'Learn' }
  ),
  () => agent(
    `Learn the user's TAGGING conventions per the memory-curator skill.
     1. Fetch the user's LIVE Gmail label list — the only source of truth for what labels exist.
     2. REQUIRED: write the label STRUCTURE as a single labelmap fact. /label preflights
        \`recall --kind labelmap\` and refuses to run if it is missing, so skipping this
        leaves the user permanently unable to label:
        python3 .claude/memory/store.py add --kind labelmap --key structure --text "pick-one group (apply exactly 1): [...]. multi-select categories: [...]. retired: [...]. silent: yes/no."
        Infer the pick-one group from labels that are mutually exclusive in practice and/or
        share a structural marker (e.g. a numeric/ordinal prefix). Never invent labels.
     3. Then inspect the messages under each label, infer the rule that explains them, and
        write one 'tagging' fact per label (add --kind tagging).
     Return the rules learned AND confirm the labelmap fact was written.`,
    { agentType: 'memory-curator', label: 'learn:tagging', phase: 'Learn' }
  ),
])

phase('Report')
// Read the store back so the user sees the profile that now drives drafting/triage, and
// VERIFY the labelmap landed — /label hard-stops without it, so a silent miss here is the
// difference between a working install and a permanent dead end.
const stats = await agent(
  `Report the RAHU profile:
   1. python3 .claude/memory/store.py stats
   2. python3 .claude/memory/store.py list --limit 40
   3. python3 .claude/memory/store.py recall --kind labelmap --k 1
   Summarize what the profile now knows about the user's voice and tagging, and note
   anything thin that more email history would improve.
   CRITICAL: if step 3 returns no facts, say so LOUDLY — /label will refuse to run. Report
   {labelmapOk: false} and tell the user to re-run /learn rather than reporting success.
   Return {summary, labelmapOk}.`,
  { agentType: 'memory-curator', label: 'profile-report', phase: 'Report',
    schema: { type: 'object',
              properties: { summary: { type: 'string' }, labelmapOk: { type: 'boolean' } },
              required: ['summary', 'labelmapOk'] } }
)

if (stats && stats.labelmapOk === false) log('labelmap MISSING — /label will refuse to run. Re-run /learn.')

return { voice, tagging, profile: stats }
