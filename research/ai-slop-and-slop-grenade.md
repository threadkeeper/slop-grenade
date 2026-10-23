# Research: AI Slop & The "Slop Grenade" in Workplace Communication

## 1. What Is a "Slop Grenade"?

In modern workplace communication (Microsoft Teams, Outlook email, SharePoint comments, and collaborative documents), a **"Slop Grenade"** (also called *AI workslop*) is an unreviewed, unedited wall of AI-generated output that someone generates in seconds and lobs into a chat thread or inbox without adding personal discernment, context, verification, or editorial effort.

Popularized by industry leaders (including Shopify CEO Tobi Lütke's warnings against throwing "AI slop grenades" at colleagues) and workplace productivity researchers, the metaphor captures the asymmetric cognitive cost of unreviewed AI text:

- **10 seconds to pull the pin and throw**: The sender types a lazy prompt ("write a comprehensive response / strategy update") and hits Send without reading or editing.
- **30 minutes of shrapnel for recipients**: Every recipient in the Teams channel or email thread must wade through 600 words of generic, sycophantic, bulleted corporate fluff to figure out what—if anything—the sender actually means or wants.

### Core Characteristics of a Slop Grenade

1. **Asymmetric Cognitive Offloading**: Shifts the burden of thinking, synthesizing, and editing from the sender to the reader.
2. **Channel Norm Violation**: Dropping a 5-section structured essay with bolded bullet headers (`**Key Takeaways:**`, `**Next Steps:**`) into an informal Teams chat where a 2-sentence human reply was appropriate.
3. **Zero Personal Discernment or Grounding**: Speaks in sweeping abstractions ("fostering cross-functional synergy," "navigating the evolving landscape") without referencing concrete team artifacts, actual decisions, or human ownership.
4. **Passive Handoff Disclaimers**: Often accompanied by telltale pin-pulling phrases like *"Asked Copilot/AI to take a quick first pass,"* *"Here are some initial thoughts for reaction,"* or *"Unedited AI brain-dump below."*
5. **Illusion of Productivity**: Looks polished and grammatically immaculate at 10,000 feet, while containing zero actionable substance or verified facts up close.

---

## 2. Empirical & Linguistic Markers of Workplace AI Slop

Based on empirical corpus linguistics (e.g., *Systematic Analysis of Linguistic Features in AI-Generated Text*, arXiv:2606.04177) and enterprise communication heuristics, workplace AI slop exhibits five measurable signal families:

### Signal Family A: Lexical Clichés & Corporate AI Boilerplate (`lexical_score`)
- **Opening/Closing Clichés**: *"I hope this email finds you well"*, *"I hope this message finds you thriving"*, *"Please do not hesitate to reach out"*, *"Thank you for bringing this to my attention"*.
- **AI Overused Verbs/Adjectives**: *delve*, *tapestry*, *testament*, *underscore*, *pivotal*, *multifaceted*, *foster*, *spearhead*, *synergize*, *holistic*, *paradigm*, *seamless*, *robust*, *transformative*, *landscape*, *navigating*, *beacon*, *catalyze*, *streamline*.
- **Formulaic Transitions**: *"Furthermore,"*, *"Moreover,"*, *"Additionally,"*, *"In conclusion,"*, *"It is important to note that"*, *"It is worth noting that"*, *"At its core,"*, *"In today's fast-paced..."*.

### Signal Family B: Structural Symmetry & Formatting Slop (`structural_score`)
- **Bolded List Lead-ins**: Repeated bullet items matching `- **Heading Phrase:** Explanation sentence.` (the single strongest structural fingerprint of raw LLM markdown pasted into Teams or Outlook).
- **Sectioned Essay in Chat**: Multiple markdown headers (`###`, `**1. ...**`), numbered takeaways, and a wrap-up summary paragraph inside a chat message.
- **Em-Dash & Colon Over-Density**: High frequency of `—` (em-dashes) and rhetorical `not only X, but also Y` / `It's not just X—it's Y` constructions.

### Signal Family C: Low Burstiness & Uniform Cadence (`burstiness_score`)
- **Human writing is "bursty"**: Humans write a 4-word fragment ("Makes sense. Let's ship."), followed by a 28-word explanation, followed by a quick question.
- **AI slop has flat sentence variance**: Sentences cluster tightly around 16–24 words with uniform clause depth and predictable punctuation.

### Signal Family D: Prompt Bleed & Handoff Disclaimers (`handoff_score`)
- **Prompt Artifacts**: *"Certainly! Here is a draft..."*, *"As requested, below is..."*, *"Here's a polished version..."*, `[Insert Name]`, `[Date/Time]`.
- **Grenade Pin-Pullers**: *"I had AI take a swing at this"*, *"Quick first pass from Copilot"*, *"Generated a quick summary for thoughts"*.

### Signal Family E:GPT Luna Semantic Judgment (`luna_score`)
- Using **GPT Luna (`gpt-5.6-luna`)** via the user's GitHub account (`POST https://api.githubcopilot.com/responses`), the detector evaluates:
  1. **Authenticity vs. Synthetic Distance**: Does this sound like a real colleague speaking to another human, or an unedited LLM completion?
  2. **Cognitive Tax**: Does the message respect the recipient's time, or does it dump unedited bullet-sludge onto the reader?
  3. **Self-Awareness Coaching**: When the message is **outgoing (sent by the user)**, what single concrete edit would make it shorter, warmer, and more human?

---

## 3. The 5-Tier Visual Feedback Scale

The goal of **Slop Grenade** is not punitive surveillance—it is **immediate, visceral, playful awareness** of communication quality across both **incoming** and **outgoing (the user's own)** M365 messages:

| Slop Score | Tier Name | Animation Triggered on Monitor | Meaning |
| :--- | :--- | :--- | :--- |
| **0 – 19** | `HumanSparkle` | **Subtle Plumes of Sparkles**: Barely visible, delicate wisps of warm stardust/sparkles rising gently near the screen edge. | Real, human-typed communication with natural rhythm, brevity, and authentic voice. |
| **20 – 39** | `PeacefulCloud` | **Peaceful Drifting Cloud**: A small, serene, soft pastel cloud drifting peacefully across the upper corner of the screen. | Lightly assisted or slightly formal prose, still thoughtful and easy to read. |
| **40 – 59** | `InnocentFruit` | **Innocent Bouncing Fruit**: A cheerful peach, lemon, or berry that hops playfully onto the bezel with a tiny juice sparkle. | Noticeable AI polish or template phrasing, but bounded and harmless. |
| **60 – 79** | `SlopSplat` | **Wobbly Slop Blob**: A gelatinous amber-lime pudding blob that wobbles against the glass and leaves a small drip. | Heavy AI corporate-speak and bullet inflation; bordering on a grenade. |
| **80 – 100** | `SlopGrenade` | **Full Hand Grenade & Goop Splat**: A tumbling pineapple hand grenade arcs across the monitor, impacts the side bezel with a shockwave, and explodes into a **squishy, bubbly, neon-chartreuse sloppy mess of goop** that slowly slides down the side of the monitor! | Unreviewed AI Slop Grenade detected! High cognitive tax, bolded bullet wall, or raw AI dump. |
