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
// settle() so one learner's failure doesn't discard the other's completed work — parallel()
// is Promise.all-shaped, so a bare rejection here used to also skip the Report phase below,
// leaving the user with no report at all even when one learner had already succeeded.
const settle = (p) => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e) }))
const [voice, tagging] = await parallel([
  () => settle(agent(
    `Learn the user's WRITING VOICE per the memory-curator skill. Sample ~30 recent Sent messages spanning audiences (in:sent newer_than:90d). Distill greeting/sign-off/tone/length/emoji patterns PER AUDIENCE and write each as a 'voice' fact to the store (add --kind voice). Do not store raw emails. Return a short list of the patterns learned.`,
    { agentType: 'memory-curator', label: 'learn:voice', phase: 'Learn' }
  )),
  () => settle(agent(
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
  )),
])

if (!voice.ok) log(`voice learner FAILED: ${voice.e} — voice half of the profile not updated this run.`)
if (!tagging.ok) log(`tagging learner FAILED: ${tagging.e} — tagging rules (and labelmap) not updated this run.`)

phase('Report')
// Read the store back so the user sees the profile that now drives drafting/triage, and
// VERIFY the labelmap landed — /label hard-stops without it, so a silent miss here is the
// difference between a working install and a permanent dead end. This phase always runs,
// even when a learner above failed, so the user still gets an accurate status report.
const failureNote = (!voice.ok || !tagging.ok)
  ? `\n   NOTE: learner failure(s) this run — ${!voice.ok ? `voice learner FAILED (${voice.e}); the voice half of the profile is unchanged. ` : ''}${!tagging.ok ? `tagging learner FAILED (${tagging.e}); tagging rules and the labelmap are likely unchanged or still missing. ` : ''}Say plainly in the summary that half the profile is missing and which half.`
  : ''
const stats = await agent(
  `Report the RAHU profile:
   1. python3 .claude/memory/store.py stats
   2. python3 .claude/memory/store.py list --limit 40
   3. python3 .claude/memory/store.py recall --kind labelmap --k 1
   Summarize what the profile now knows about the user's voice and tagging, and note
   anything thin that more email history would improve.${failureNote}
   CRITICAL: if step 3 returns no facts, say so LOUDLY — /label will refuse to run. Report
   {labelmapOk: false} and tell the user to re-run /learn rather than reporting success.
   Return {summary, labelmapOk}.`,
  { agentType: 'memory-curator', label: 'profile-report', phase: 'Report',
    schema: { type: 'object',
              properties: { summary: { type: 'string' }, labelmapOk: { type: 'boolean' } },
              required: ['summary', 'labelmapOk'] } }
)

if (stats && stats.labelmapOk === false) log('labelmap MISSING — /label will refuse to run. Re-run /learn.')

return {
  voice: voice.ok ? { ok: true, result: voice.v } : { ok: false, error: voice.e },
  tagging: tagging.ok ? { ok: true, result: tagging.v } : { ok: false, error: tagging.e },
  profile: stats,
}
