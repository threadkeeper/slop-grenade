# Research: AI Slop & The "Slop Grenade" in Workplace Communication

## 1. What Is a "Slop Grenade"?

Across workplace communication platforms (chat, team messaging, email, and collaborative documents), a **"Slop Grenade"** (also called *AI workslop*) is an unreviewed, unedited wall of AI-generated output that someone generates in seconds and lobs into a chat thread or inbox without adding personal discernment, context, verification, or editorial effort.

Popularized by industry leaders (including Shopify CEO Tobi Lütke's warnings against throwing "AI slop grenades" at colleagues) and workplace productivity researchers, the metaphor captures the asymmetric cognitive cost of unreviewed AI text:

- **10 seconds to pull the pin and throw**: The sender types a lazy prompt ("write a comprehensive response / strategy update") and hits Send without reading or editing.
- **30 minutes of shrapnel for recipients**: Every recipient in the chat channel or email thread must wade through 600 words of generic, sycophantic, bulleted corporate fluff to figure out what—if anything—the sender actually means or wants.

### Core Characteristics of a Slop Grenade

1. **Asymmetric Cognitive Offloading**: Shifts the burden of thinking, synthesizing, and editing from the sender to the reader.
2. **Channel Norm Violation**: Dropping a 5-section structured essay with bolded bullet headers (`**Key Takeaways:**`, `**Next Steps:**`) into an informal chat thread where a 2-sentence human reply was appropriate.
3. **Zero Personal Discernment or Grounding**: Speaks in sweeping abstractions ("fostering cross-functional synergy," "navigating the evolving landscape") without referencing concrete team artifacts, actual decisions, or human ownership.
4. **Passive Handoff Disclaimers**: Often accompanied by telltale pin-pulling phrases like *"Asked AI to take a quick first pass,"* *"Here are some initial thoughts for reaction,"* or *"Unedited AI brain-dump below."*
5. **Illusion of Productivity**: Looks polished and grammatically immaculate at 10,000 feet, while containing zero actionable substance or verified facts up close.

---

## 2. Two-Stage Detection Algorithm (`core/src/slop_detector.rs`)

Before scoring any message, `isolate_authored_text` strips security banners, quoted reply chains (`From:/Sent:/To:/Subject:`, `On ... wrote:`, `> ` blockquotes, and HTML reply dividers), and trailing email signatures so senders are evaluated strictly on the words they actually authored.

### Stage 1: Deterministic 4-Signal + Human-Credit Heuristic

The Stage 1 heuristic score is calculated as:

$$\text{Score}_{\text{Stage 1}} = \text{clamp}_{0..100}\!\left(\min(\text{Lexical}, 74) + \text{Structural} + \text{Burstiness} + \text{Handoff} - \text{Human Credit}\right)$$

- Without any structural or handoff signal, the heuristic score is capped at **79**, ensuring plain buzzword prose cannot falsely trigger a `slop_grenade` (80+).
- Short messages under 65 words without AI lexical or structural signals have their polish prior capped at **8** (`human_sparkle`).
- Automated notifications and bots are scored **4** (`human_sparkle`) and excluded from human communication shares.

#### Signal Family A: Lexical Clichés & Corporate AI Boilerplate (`lexical_score`, capped at 74)
- **Opening/Closing Clichés**: *"I hope this email finds you well"*, *"I hope this message finds you thriving"*, *"Please do not hesitate to reach out"*, *"Thank you for bringing this to my attention"*.
- **AI Overused Verbs/Adjectives**: *delve*, *tapestry*, *testament*, *underscore*, *pivotal*, *multifaceted*, *foster*, *spearhead*, *synergize*, *holistic*, *paradigm*, *seamless*, *robust*, *transformative*, *landscape*, *navigating*, *beacon*, *catalyze*, *streamline*.
- **Formulaic Transitions**: *"Furthermore,"*, *"Moreover,"*, *"Additionally,"*, *"In conclusion,"*, *"It is important to note that"*, *"It is worth noting that"*, *"At its core,"*, *"In today's fast-paced..."*.

#### Signal Family B: Structural Symmetry & Formatting Slop (`structural_score`)
- **Bolded List Lead-ins**: Repeated bullet items matching `- **Heading Phrase:** Explanation sentence.` (the single strongest structural fingerprint of raw LLM markdown pasted into chat or email).
- **Sectioned Essay in Chat**: Multiple markdown headers (`###`, `**1. ...**`), numbered takeaways, rule-of-three lists, emoji-led lines, and a wrap-up summary paragraph inside a chat message.
- **Em-Dash & Colon Over-Density**: High frequency of `—` (em-dashes, weighted more heavily in chat) and rhetorical `not only X, but also Y` / `It's not just X—it's Y` constructions.

#### Signal Family C: Low Burstiness & Uniform Cadence (`burstiness_score`, capped at 36)
- **Human writing is "bursty"**: Humans write a 4-word fragment ("Makes sense. Let's ship."), followed by a 28-word explanation, followed by a quick question.
- **AI slop has flat sentence variance**: Sentences cluster tightly around 16–24 words with uniform capitalization, punctuation, and long-word density.

#### Signal Family D: Prompt Bleed & Handoff Disclaimers (`handoff_score`)
- **Prompt Artifacts & Assistant Voice**: *"Certainly! Here is a draft..."*, *"As requested, below is..."*, *"Here's a polished version..."*, `[Insert Name]`, `[Date/Time]`, or a pasted `Subject:` line.
- **Grenade Pin-Pullers**: *"I had AI take a swing at this"*, *"Quick first pass from AI"*, *"Generated a quick summary for thoughts"*.

#### Human Credit (`human_credit`, up to 24 points)
- Deducts **6 points per authentic human fingerprint** (up to 24 points): lower-case sentence starts, lower-case `"i"`, workplace colloquialisms or un-apostrophized contractions, `@Name` mentions, expressive punctuation (`??`, `!!`, `...`), emoticons, and unpunctuated short replies.

### Stage 2: Two-Stage Hybrid LLM Verification (`luna_score`)
- For any message whose Stage 1 heuristic score is **28 or higher** (`TWO_STAGE_LUNA_THRESHOLD`), `SlopDetector::merge_luna_judgment` runs semantic verification using `gpt-5.6-luna` (weighted at **65%** alongside **35%** Stage 1 heuristic) and grants veto power over heuristic false positives on genuine human writing:
  - `luna_score <= 12` caps the final score at **19** (`human_sparkle`)
  - `luna_score <= 20` caps the final score at **32** (`peaceful_cloud`)
  - `luna_score <= 35` caps the final score at **38** (`peaceful_cloud`)
- Evaluates:
  1. **Authenticity vs. Synthetic Distance**: Does this sound like a real colleague speaking to another human, or an unedited LLM completion?
  2. **Cognitive Tax**: Does the message respect the recipient's time, or does it dump unedited bullet-sludge onto the reader?
  3. **Self-Awareness Coaching**: When the message is **outgoing (sent by the user)**, what single concrete edit would make it shorter, warmer, and more human?

---

## 3. The 5-Tier Visual Feedback Scale

The goal of **Slop Grenade** is not punitive surveillance—it is **immediate, visceral, playful awareness** of communication quality across both **incoming** and **outgoing** messages across all connected communication platforms (a score of **40+** counts as AI-written on the dashboard dials and leaderboards):

| Slop Score | Tier Name (`UI Label`) | Animation Triggered on Monitor | Meaning |
| :--- | :--- | :--- | :--- |
| **0 – 19** | `human_sparkle` (`human`) | **Subtle Plumes of Sparkles**: Delicate crystal twinkles and warm stardust glinting near the screen edge. | Real, human-typed communication with natural rhythm, brevity, and authentic voice. |
| **20 – 39** | `peaceful_cloud` (`polish`) | **Peaceful Rolling Smoke Cloud**: Soft plumes drifting gently inward from the bezel and fading away. | Lightly assisted or slightly formal prose, still thoughtful and easy to read. |
| **40 – 59** | `innocent_fruit` (`sprinkled`) | **Tumbling 3D Fruit**: A cel-shaded watermelon, orange, kiwi, or berry tossed across the screen that sticks if it hits existing goop. | Noticeable AI polish or template phrasing, but bounded and harmless. |
| **60 – 79** | `slop_splat` (`ai-cannon`) | **Goo Cannonball Splat**: A gelatinous cannonball of slop that splatters against the monitor bezel and oozes downward. | Heavy AI corporate-speak and bullet inflation; bordering on a grenade. |
| **80 – 100** | `slop_grenade` (`slop-grenade`) | **Full Hand Grenade & Goop Explosion**: A tumbling hand grenade arcs across the monitor and explodes into a bubbly sloppy mess of goop! | Unreviewed AI Slop Grenade detected! High cognitive tax, bolded bullet wall, or raw AI dump. |
