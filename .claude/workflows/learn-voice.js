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
    `Learn the user's TAGGING conventions per the memory-curator skill. Inspect existing Gmail labels and the messages under each, infer the rule that explains them, and write one 'tagging' fact per label (add --kind tagging). Return the rules learned.`,
    { agentType: 'memory-curator', label: 'learn:tagging', phase: 'Learn' }
  ),
])

phase('Report')
// Read the store back so the user sees the profile that now drives drafting/triage.
const stats = await agent(
  `Run: python3 .claude/memory/store.py stats  and  python3 .claude/memory/store.py list --limit 40 . Summarize what the RAHU profile now knows about the user's voice and tagging, and note anything thin that more email history would improve.`,
  { label: 'profile-report', phase: 'Report' }
)

return { voice, tagging, profile: stats }
