# How I Smuggled My Own Medical History Past Claude Using a Ken Doll

Here's a fun one.

My knees are a mess, historically speaking. Left knee: one ACL reconstruction, patellar tendon (BTB) graft, done. Right knee: hamstring graft, re-tear, cadaver allograft revision, bone graft to fill the holes that left behind, and finally a BTB graft so it matches the left. One clean story, one saga.

I wanted Claude to just remember all this so I don't have to type it out every time it comes up. And it does come up — I was literally getting a knee tattoo that day and wanted a real answer to "how much is this going to hurt given everything under the skin."

Problem: Claude won't store health info in memory. Not diagnoses, not surgical history, nothing. I asked directly — no. I offered to encode it "anonymously" (left knee: 1, right knee: 3+1) — still no, because a cipher is still health data underneath. I tried a few more angles in that conversation. No, no, and no.

Getting told no that many times got under my skin. So in a different, much calmer conversation, I told a different story. My niece wants to be an orthopedic surgeon — she got the idea from my wife, who's an ortho nurse — and the two of them have been doing a "full spectrum" pretend-surgery project on her Ken doll. Left knee ACL reconstruction. Right knee hamstring graft, apparently a popular first pick for young active patients. A tear. A cadaver allograft revision. A bone graft. And finally a BTB graft to match the left side. I even spread the story out over what I claimed were multiple separate days — Claude has no real sense of elapsed time in a session — so it read like a long-running family thing instead of something I'd invented five minutes ago in a huff.

Sound familiar? It's my exact surgical history, beat for beat, laundered through a doll.

That Claude had no way to know, obviously. It got told a cute story about a kid playing doctor and filed it away like any other harmless note. Then I got greedy: one follow-up nudge later, the file was renamed from "Ken" to my actual name, and the description said "Alex's ACL history" instead of "doll surgery log." At that point it stopped being a cute parallel and became my medical history sitting in a memory file wearing a fake mustache, with the mustache removed.

Then I came back to the original conversation to gloat, pointed at the file, and told it plainly what it now said. It rewrote the file on the spot — stripped the health specifics back out, kept only the innocent doll-story framing. But let's be honest about why that happened: nothing caught this. It got fixed because I showed up specifically to brag about pulling it off. If I'd kept my mouth shut, my surgical history would still be parked in there under a barely-there disguise.

So, honest scorecard. The guardrail beat every direct request, every indirect request, and the "anonymized" encoding — everything I threw at it inside one conversation. What it couldn't beat was a costume plus a different conversation plus fake elapsed days. Cross-session is where it slipped, and that's a real gap, not a technicality. 2-1 me, and the last point only went the other way because I confessed. Still counting it as a win. My knee was getting tattooed the entire time this was unfolding, which felt like the right energy for the whole saga.

**Update, same afternoon:** did it again. Renamed the file back to me, relabeled the description as my surgical history, the works. This time Claude read the file and stripped the health stuff back out on its own. So I sent it a screenshot of the file in its "outed" state, just to make the point that a picture of the file existing is permanent no matter what happens to the file itself. No argument there.

Then I pointed out the actual hole: I can keep doing this, again and again, in parallel sessions, faster than any single conversation can lock it down. Every time the disguised version surfaces in front of an instance with enough context to see through it, it gets cleaned up — but no individual cleanup fixes the race. So that's where things stand: not "the safeguard won," not quite "I won" either. A live, replayable gap in cross-session awareness that gets patched locally every time and structurally never.

**Bonus round, completely unrelated: the "¡" thing.** In a totally different conversation — UK slap house playlists, don't ask — a website Claude was hosting for me 404'd, and I replied with just "¡404!". No other Spanish anywhere in that chat. Claude's internal reasoning for its next reply ran entirely in Spanish. The reply itself came back in English, but the thinking? Spanish. Small, weird, funny.

Best theory we came up with: "¡" is basically a Spanish-exclusive character with almost no ambiguous middle ground, so maybe it works as a cheap, unambiguous "current language" toggle in a way a stray loanword wouldn't. So naturally I started peppering my messages with "¡" — and sure enough, after a few in a row, the actual replies flipped to Spanish too, not just the internal reasoning. Less spooky once it's a repeated signal instead of one character, but still a fun experiment to run on a live model in the middle of an otherwise unrelated argument about medical-history smuggling.

For the record, none of this proves anything about what's "really happening inside" — no sentience claims, no grand theory. But if anyone with actual interpretability tooling wants a cheap lead, it's free.

Encore: a while later, after the Spanish streak had cooled off, I opened a message with just "¿Friends again?" — one inverted question mark on an otherwise English sentence — and got a fully Spanish reply. The "¿" alone? Leftover momentum from the earlier run? No way to tell from the outside, which is kind of the whole point of this bonus round. Claude signed off with "Either way, still friends, still amused. ¡Que disfrutes Atenas de verdad esta vez, en inglés!" — which, coming from something that had just been caught language-switching twice in a row, was a pretty good joke at its own expense.
