//! Deterministic and hybrid AI Slop & Slop Grenade detection engine.
//!
//! Evaluates incoming and outgoing Microsoft 365 communications across five
//! signal families (lexical clichés, structural symmetry, sentence burstiness,
//! passive AI handoff disclaimers, and optional GPT Luna semantic judgment) and
//! maps each message onto the 5-tier monitor animation scale:
//!
//! - `0..=19`  -> [`AnimationTier::HumanSparkle`] (subtle plumes of sparkles)
//! - `20..=39` -> [`AnimationTier::PeacefulCloud`] (serene drifting cloud)
//! - `40..=59` -> [`AnimationTier::InnocentFruit`] (cheerful bouncing fruit)
//! - `60..=79` -> [`AnimationTier::SlopSplat`] (wobbly gelatinous blob)
//! - `80..=100` -> [`AnimationTier::SlopGrenade`] (hand grenade splat & sliding goop)
//!
//! The rubric is deliberately strict. Stock assistant phrasing, em dashes, tidy bullet lists,
//! bold emphasis and uniformly polished prose all add points. Only human typing fingerprints
//! (lower-case sentence starts, slang, `??`, emoticons, a missing final full stop) earn up to
//! 24 points back, so casual human chat stays low while AI-drafted mail lands at 40 or above.

use serde::{Deserialize, Serialize};

/// Visual animation tier triggered on the user's monitor edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnimationTier {
    /// `0..=19`: Barely visible, delicate plumes of warm sparkles for real human typing.
    HumanSparkle,
    /// `20..=39`: Small, peaceful pastel cloud drifting across the upper monitor edge.
    PeacefulCloud,
    /// `40..=59`: Innocent bouncing fruit (peach, citrus, or berry) with a soft droplet.
    InnocentFruit,
    /// `60..=79`: Wobbly gelatinous slime blob warning of heavy corporate AI phrasing.
    SlopSplat,
    /// `80..=100`: Full hand grenade that splats against the monitor bezel and slides down as squishy goop.
    SlopGrenade,
}

impl AnimationTier {
    /// Map a `0..=100` slop score to its deterministic animation tier.
    pub fn from_score(score: u8) -> Self {
        match score {
            0..=19 => Self::HumanSparkle,
            20..=39 => Self::PeacefulCloud,
            40..=59 => Self::InnocentFruit,
            60..=79 => Self::SlopSplat,
            _ => Self::SlopGrenade,
        }
    }

    /// Canonical display name for the tier (`human`, `polish`, `sprinkled`, `ai-cannon`, `slop-grenade`).
    pub fn display_name(self) -> &'static str {
        match self {
            Self::HumanSparkle => "human",
            Self::PeacefulCloud => "polish",
            Self::InnocentFruit => "sprinkled",
            Self::SlopSplat => "ai-cannon",
            Self::SlopGrenade => "slop-grenade",
        }
    }

    /// Short description of the visual effect rendered on the monitor.
    pub fn animation_description(self) -> &'static str {
        match self {
            Self::HumanSparkle => {
                "Barely visible, delicate plumes of warm stardust sparkles drifting gently upward"
            }
            Self::PeacefulCloud => {
                "Small, serene pastel cloud drifting peacefully across the upper bezel"
            }
            Self::InnocentFruit => {
                "Cheerful bouncing fruit (peach/citrus/berry) with a playful juice droplet"
            }
            Self::SlopSplat => {
                "Wobbly chartreuse-amber gelatinous blob quivering on the monitor edge"
            }
            Self::SlopGrenade => {
                "Hand grenade arcs across screen, splats against the side of the monitor, and slides down like a squishy sloppy mess of goop"
            }
        }
    }
}

/// Source application where the communication originated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum M365App {
    /// Microsoft Teams chat or channel message.
    Teams,
    /// Microsoft Outlook email message.
    Outlook,
    /// Google Gmail email message.
    Gmail,
    /// SharePoint comment or page post.
    SharePoint,
    /// Word document comment or shared draft.
    Word,
    /// Microsoft 365 Copilot chat or shared prompt output.
    CopilotChat,
    /// Other M365 or simulated communication surface.
    Other,
}

/// Whether the user sent or received the communication.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageDirection {
    /// Incoming message sent by a colleague or external sender to the user.
    Received,
    /// Outgoing message authored/sent by the user themselves (self-awareness mirror).
    Sent,
}

/// Which side of the monitor the animation should launch toward.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MonitorSide {
    /// Left monitor bezel (default for incoming messages).
    Left,
    /// Right monitor bezel (default for outgoing user-sent messages or alternating hits).
    Right,
}

/// Category of an individual AI slop signal detected in a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlopSignalCategory {
    /// Overused AI vocabulary or corporate boilerplate clichés.
    LexicalCliche,
    /// Markdown bold-bullet walls (`- **Header:** ...`) or rigid essay symmetry.
    StructuralSymmetry,
    /// Uniform sentence lengths lacking natural human burstiness.
    LowBurstiness,
    /// Unedited AI handoff disclaimers ("asked Copilot for a quick first pass") or prompt bleed.
    PassiveHandoff,
    /// Dumping an overlong essay into a fast chat channel like Microsoft Teams.
    ChannelMismatch,
    /// Semantic evaluation from GitHub GPT Luna (`gpt-5.6-luna`).
    LunaSemantic,
}

/// Individual evidence signal contributing to the message's slop score.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlopSignal {
    /// Category of the detected signal.
    pub category: SlopSignalCategory,
    /// Concise human-readable explanation of what triggered the signal.
    pub label: String,
    /// Points contributed toward the heuristic slop score.
    pub weight: u8,
    /// Short matched phrase or structural excerpt.
    pub excerpt: String,
}

/// Per-family score breakdown (`0..=100` each) for transparency in the dashboard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalBreakdown {
    /// Score from AI clichés, buzzwords, and formulaic transitions.
    pub lexical_score: u8,
    /// Score from symmetrical bolded lists, headers, and em-dash density.
    pub structural_score: u8,
    /// Score from flat sentence cadence and uniformly polished prose (low human burstiness).
    pub burstiness_score: u8,
    /// Score from passive AI handoffs, assistant voice, prompt bleed, or channel length mismatch.
    pub handoff_score: u8,
    /// Optional score (`0..=100`) returned by GitHub GPT Luna (`gpt-5.6-luna`).
    pub luna_score: Option<u8>,
}

/// Input communication sample submitted for slop analysis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSample {
    /// Unique identifier for deduplication across M365 polling cycles.
    pub message_id: String,
    /// Source M365 application (Teams, Outlook, etc.).
    pub app: M365App,
    /// Whether the user sent or received this communication.
    pub direction: MessageDirection,
    /// Display name or redacted identifier of the sender.
    pub sender: String,
    /// Email subject or Teams chat topic.
    pub subject_or_topic: String,
    /// Plain-text or markdown body of the communication.
    pub body: String,
    /// ISO-8601 timestamp when the message was created or received.
    pub timestamp: String,
}

/// Structured evaluation returned by GitHub GPT Luna (`gpt-5.6-luna`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LunaJudgment {
    /// Semantic AI slop score (`0..=100`) assigned by GPT Luna.
    pub slop_score: u8,
    /// Model identifier that produced the evaluation (e.g., `gpt-5.6-luna`).
    pub model: String,
    /// Short explanation of why the message reads as human or AI slop.
    pub reasoning: String,
    /// Constructive rewrite or self-awareness coaching tip.
    pub coaching_tip: String,
}

/// Complete slop analysis report and animation trigger specification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlopReport {
    /// Unique message identifier.
    pub message_id: String,
    /// Source M365 application.
    pub app: M365App,
    /// Sent by user vs. received by user.
    pub direction: MessageDirection,
    /// Sender display name.
    pub sender: String,
    /// Subject line or Teams channel/chat topic.
    pub subject_or_topic: String,
    /// Timestamp of the communication.
    pub timestamp: String,
    /// Total word count of the analyzed body.
    pub word_count: usize,
    /// Final combined slop score (`0..=100`).
    pub slop_score: u8,
    /// Deterministic heuristic score (`0..=100`) before LLM enrichment.
    pub heuristic_score: u8,
    /// Optional GPT Luna semantic score (`0..=100`).
    pub luna_score: Option<u8>,
    /// Animation tier triggered on the user's monitor.
    pub tier: AnimationTier,
    /// Convenience flag: `true` when `tier == AnimationTier::SlopGrenade` (`score >= 80`).
    pub is_slop_grenade: bool,
    /// Which side of the monitor the animation targets.
    pub monitor_side: MonitorSide,
    /// Detailed sub-score breakdown.
    pub breakdown: SignalBreakdown,
    /// Concrete signals found in the text.
    pub signals: Vec<SlopSignal>,
    /// Human-readable one-line verdict.
    pub summary: String,
    /// Actionable self-awareness coaching tip (tailored to sent vs. received).
    pub self_awareness_tip: String,
    /// Privacy-safe, truncated preview (`<= 140` chars) for the UI feed.
    pub redacted_preview: String,
}

/// Stateless, thread-safe detector for AI slop and Slop Grenades.
#[derive(Debug, Clone, Default)]
pub struct SlopDetector;

const OPENING_CLICHES: &[(&str, u8)] = &[
    ("i hope this email finds you well", 18),
    ("i hope this message finds you well", 18),
    ("i hope this note finds you well", 16),
    ("i hope this finds you thriving", 18),
    ("i hope your week is going well", 14),
    ("thank you for reaching out", 8),
    ("thank you for bringing this to my attention", 12),
    ("please do not hesitate to reach out", 14),
    ("please feel free to reach out", 10),
    ("as per your request", 12),
];

const AI_BUZZWORDS: &[(&str, u8)] = &[
    ("delve", 12),
    ("tapestry", 14),
    ("testament to", 12),
    ("underscores", 10),
    ("pivotal", 9),
    ("multifaceted", 12),
    ("foster", 8),
    ("fostering", 9),
    ("spearhead", 10),
    ("synerg", 11),
    ("holistic", 10),
    ("paradigm", 11),
    ("seamless", 8),
    ("seamlessly", 9),
    ("transformative", 11),
    ("evolving landscape", 15),
    ("fast-paced", 11),
    ("beacon", 12),
    ("catalyze", 11),
    ("streamline", 8),
    ("actionable insights", 12),
    ("key takeaways", 14),
    ("comprehensive overview", 13),
    ("strategic alignment", 12),
    ("cross-functional", 9),
    ("unlock", 7),
    ("elevate", 7),
    ("leverage", 7),
    ("robust", 7),
    ("north star", 9),
];

const FORMULAIC_TRANSITIONS: &[(&str, u8)] = &[
    ("furthermore,", 10),
    ("moreover,", 10),
    ("additionally,", 10),
    ("in conclusion,", 14),
    ("to summarize,", 12),
    ("it is important to note that", 14),
    ("it is worth noting that", 13),
    ("at its core,", 12),
    ("not only", 6),
    ("in summary,", 11),
];

const PASSIVE_HANDOFF_PHRASES: &[(&str, u8)] = &[
    ("asked copilot to", 28),
    ("asked ai to", 28),
    ("had ai take a swing", 32),
    ("had copilot take a pass", 30),
    ("quick first pass from ai", 32),
    ("quick first pass from copilot", 32),
    ("unedited ai", 34),
    ("here is a polished draft", 28),
    ("certainly! here is", 34),
    ("sure! here's a", 32),
    ("as an ai", 35),
    ("for reaction", 12),
    ("[insert ", 26),
];

/// Stock phrases assistants put into business mail and chat. Matched on lower-case text with
/// curly quotes folded to ASCII.
const AI_PHRASES: &[(&str, u8)] = &[
    ("i hope you're doing well", 12),
    ("i hope you are doing well", 12),
    ("i hope you're having a great", 12),
    ("i hope you had a great", 10),
    ("i hope all is well", 10),
    ("i trust this", 12),
    ("i wanted to reach out", 10),
    ("i'm reaching out to", 10),
    ("i am reaching out to", 10),
    ("i wanted to follow up", 8),
    ("i wanted to touch base", 10),
    ("i wanted to take a moment", 14),
    ("i wanted to share", 6),
    ("thank you for your email", 8),
    ("thank you for sharing", 8),
    ("thank you for the update", 6),
    ("thank you so much for", 6),
    ("i appreciate your", 8),
    ("i really appreciate", 6),
    ("it's great to see", 8),
    ("it is great to see", 8),
    ("great to see", 4),
    ("exciting to see", 8),
    ("excited to share", 10),
    ("thrilled to", 10),
    ("delighted to", 8),
    ("let me know if you have any questions", 12),
    ("if you have any questions", 8),
    ("if you have any further questions", 12),
    ("please let me know if", 8),
    ("don't hesitate to", 10),
    ("do not hesitate to", 12),
    ("feel free to reach out", 10),
    ("feel free to let me know", 10),
    ("looking forward to", 6),
    ("i look forward to", 8),
    ("happy to discuss", 10),
    ("happy to help", 8),
    ("happy to jump on", 8),
    ("happy to walk through", 8),
    ("thank you for your patience", 10),
    ("thank you for your understanding", 10),
    ("rest assured", 12),
    ("warm regards", 8),
    ("best regards", 4),
    ("kind regards", 4),
    ("plays a crucial role", 14),
    ("a crucial role", 10),
    ("plays a key role", 10),
    ("pave the way", 10),
    ("in today's", 10),
    ("ever-changing", 12),
    ("ever-evolving", 12),
    ("key insights", 10),
    ("valuable insights", 12),
    ("best practices", 6),
    ("value proposition", 8),
    ("drive value", 8),
    ("deliver value", 8),
    ("deep dive", 6),
    ("moving forward", 6),
    ("going forward", 5),
    ("that said,", 6),
    ("that being said", 8),
    ("with that in mind", 8),
    ("in essence", 10),
    ("in a nutshell", 8),
    ("overall,", 6),
    ("ultimately,", 6),
    ("notably,", 8),
    ("importantly,", 8),
    ("consequently,", 7),
    ("as a result,", 5),
    ("in other words,", 5),
    ("align with", 6),
    ("aligns with", 8),
    ("aligned with", 5),
    ("well-positioned", 10),
    ("on track to", 4),
    ("solid progress", 8),
    ("great progress", 4),
    ("next steps", 5),
    ("action items", 6),
    ("a few thoughts", 6),
    ("a few observations", 10),
    ("a few key", 8),
    ("to ensure a smooth", 10),
    ("key milestones", 6),
    ("resource allocation", 6),
    ("let me know your availability", 8),
    ("great catch!", 12),
    ("you're absolutely right", 16),
    ("you're right", 6),
    ("great point", 8),
    ("great work, team", 8),
];

/// Single words assistants over-use. Matched at the start of a word.
const AI_WORDS: &[(&str, u8)] = &[
    ("ensure", 4),
    ("ensuring", 5),
    ("enhance", 6),
    ("enhancing", 7),
    ("optimize", 5),
    ("optimizing", 6),
    ("empower", 9),
    ("navigate", 7),
    ("navigating", 8),
    ("landscape", 8),
    ("realm", 12),
    ("crucial", 8),
    ("vital", 7),
    ("essential", 5),
    ("comprehensive", 8),
    ("nuanced", 10),
    ("intricate", 10),
    ("innovative", 7),
    ("cutting-edge", 10),
    ("game-changer", 12),
    ("utilize", 8),
    ("utilizing", 8),
    ("facilitate", 7),
    ("impactful", 9),
    ("proactive", 6),
    ("proactively", 6),
    ("insightful", 8),
    ("invaluable", 10),
    ("meticulous", 12),
    ("commendable", 12),
    ("noteworthy", 10),
    ("showcase", 8),
    ("showcasing", 8),
    ("streamlined", 7),
    ("embark", 12),
    ("harness", 9),
    ("harnessing", 9),
    ("bolster", 11),
    ("resonate", 9),
    ("resonates", 9),
    ("unparalleled", 14),
    ("revolutionize", 12),
    ("elevating", 8),
    ("empowering", 9),
    ("strategic", 4),
    ("stakeholders", 4),
    ("scalable", 4),
    ("alignment", 5),
    ("additionally", 6),
    ("furthermore", 6),
    ("moreover", 6),
    ("thus", 5),
    ("hence", 6),
    ("therefore", 4),
    ("aligns", 8),
];

/// Assistant voice left in a pasted answer (offers, templates, chatbot openers).
const ASSISTANT_VOICE: &[(&str, u8)] = &[
    ("would you like me to", 30),
    ("let me know if you'd like me to", 28),
    ("let me know if you would like me to", 28),
    ("if you'd like, i can", 24),
    ("if you would like, i can", 24),
    ("i can also help", 16),
    ("i can also draft", 22),
    ("i can help you", 10),
    ("here's a revised", 30),
    ("here is a revised", 30),
    ("here's an updated", 26),
    ("here is an updated", 26),
    ("here's a draft", 26),
    ("here is a draft", 26),
    ("here's a summary", 18),
    ("here is a summary", 18),
    ("here's a quick summary", 18),
    ("here's a quick", 10),
    ("here's a breakdown", 18),
    ("here is a breakdown", 18),
    ("here are the key", 16),
    ("here are some", 12),
    ("here's what", 8),
    ("below is a", 10),
    ("below are the", 8),
    ("outlined below", 14),
    ("summarized below", 14),
    ("[your name]", 34),
    ("[name]", 26),
    ("<insert", 26),
    ("[recipient", 26),
    ("[company", 26),
    ("feel free to adjust", 24),
    ("feel free to modify", 24),
    ("feel free to tweak", 24),
    ("i hope this helps", 16),
    ("hope this helps", 10),
    ("great question", 16),
    ("absolutely!", 12),
    ("of course!", 10),
    ("certainly!", 14),
    ("certainly,", 8),
    ("as an ai language model", 40),
    ("as of my last", 30),
    ("knowledge cutoff", 30),
    ("it's not just", 10),
    ("it is not just", 10),
    ("isn't just", 8),
    ("it's not about", 10),
    ("whether you're", 10),
    ("whether it's", 6),
    ("the result?", 10),
    ("why does this matter", 14),
    ("here's the thing", 10),
    ("let's dive", 16),
    ("let's explore", 12),
    ("let's break", 10),
    ("this email outlines", 14),
    ("this message outlines", 14),
    ("i've outlined", 12),
    ("i have outlined", 12),
    ("key highlights", 12),
    ("tl;dr", 6),
    ("to recap", 6),
    ("quick recap", 6),
];

/// Casual words people type and assistants rarely produce. Matched as whole words.
const HUMAN_SLANG: &[&str] = &[
    "lol",
    "lmao",
    "haha",
    "hahaha",
    "thx",
    "pls",
    "plz",
    "btw",
    "tbh",
    "imo",
    "imho",
    "idk",
    "np",
    "ty",
    "kk",
    "yep",
    "yup",
    "nope",
    "gonna",
    "wanna",
    "gotta",
    "ya",
    "yeah",
    "nah",
    "ugh",
    "hmm",
    "oops",
    "lgtm",
    "wfh",
    "omg",
    "ok",
    "okay",
    "k",
    "cool",
    "sure thing",
    "will do",
    "no worries",
];

/// Text emoticons (lower-case).
const EMOTICONS: &[&str] = &[
    ":)",
    ":-)",
    ":(",
    ":-(",
    ":d",
    ";)",
    ":p",
    "xd",
    "^^",
    "<3",
];

impl SlopDetector {
    /// Create a new [`SlopDetector`].
    pub fn new() -> Self {
        Self
    }

    /// Analyze a [`MessageSample`] deterministically and produce a [`SlopReport`].
    pub fn analyze(&self, sample: &MessageSample) -> SlopReport {
        let words: Vec<&str> = sample.body.split_whitespace().collect();
        let word_count = words.len();
        let monitor_side = match sample.direction {
            MessageDirection::Received => MonitorSide::Left,
            MessageDirection::Sent => MonitorSide::Right,
        };

        // Machine-generated and automated responses are always classified as the Sparkle (`human`) tier.
        if is_automated_or_machine_generated(sample) {
            return SlopReport {
                message_id: sample.message_id.clone(),
                app: sample.app,
                direction: sample.direction,
                sender: sample.sender.clone(),
                subject_or_topic: sample.subject_or_topic.clone(),
                timestamp: sample.timestamp.clone(),
                word_count,
                slop_score: 4,
                heuristic_score: 4,
                luna_score: None,
                tier: AnimationTier::HumanSparkle,
                is_slop_grenade: false,
                monitor_side,
                breakdown: SignalBreakdown {
                    lexical_score: 0,
                    structural_score: 0,
                    burstiness_score: 0,
                    handoff_score: 0,
                    luna_score: None,
                },
                signals: Vec::new(),
                summary: "Automated / machine-generated response classified as sparkle (human)."
                    .to_string(),
                self_awareness_tip:
                    "Automated system or calendar response — classified as sparkle.".to_string(),
                redacted_preview: redact_preview(&sample.body),
            };
        }

        let lower = fold_typographic_quotes(&sample.body.to_lowercase());
        let lines: Vec<&str> = sample.body.lines().map(str::trim).collect();
        let is_teams = sample.app == M365App::Teams;
        let mut signals = Vec::new();

        // 1. Lexical clichés, stock assistant phrasing & AI vocabulary
        let lexical_score = score_lexical(&lower, &mut signals);

        // 2. Structural symmetry (bullet walls, headings, em dashes, emoji bullets, list rhythm)
        let (structural_score, bold_bullet_count) =
            score_structure(&sample.body, &lower, &lines, is_teams, &mut signals);

        // 3. Burstiness: flat sentence cadence plus a prior for uniformly polished prose
        let segments = sentence_segments(&sample.body);
        let human_marks = count_human_fingerprints(&sample.body, &lower, &segments, word_count);
        let cadence = compute_low_burstiness_score(&sample.body, word_count, &mut signals);
        let polish = compute_polish_prior(
            &words,
            &segments,
            word_count,
            is_teams,
            human_marks == 0,
            &mut signals,
        );
        let burstiness_score = cadence.saturating_add(polish).min(36);

        // 4. Passive handoffs, assistant voice, prompt bleed, and channel mismatch
        let handoff_score = score_handoff(
            &lower,
            sample.app,
            word_count,
            bold_bullet_count,
            &mut signals,
        );

        // Combine signal families into a calibrated 0..=100 heuristic score. Human typing
        // fingerprints earn back up to 24 points. Crossing into SlopGrenade (>= 80) requires
        // structural slop or assistant voice; pure single-paragraph buzzwords cap at 79.
        let human_credit = (human_marks * 6).min(24) as u16;
        let raw_combined = (u16::from(lexical_score.min(74))
            + u16::from(structural_score)
            + u16::from(burstiness_score)
            + u16::from(handoff_score))
        .saturating_sub(human_credit);

        let heuristic_score = if structural_score == 0 && handoff_score == 0 {
            raw_combined.min(79) as u8
        } else {
            raw_combined.min(100) as u8
        };
        let tier = AnimationTier::from_score(heuristic_score);
        let monitor_side = match sample.direction {
            MessageDirection::Received => MonitorSide::Left,
            MessageDirection::Sent => MonitorSide::Right,
        };

        let breakdown = SignalBreakdown {
            lexical_score,
            structural_score,
            burstiness_score,
            handoff_score,
            luna_score: None,
        };

        let summary = build_summary(tier, heuristic_score, sample.direction, sample.app);
        let self_awareness_tip = build_coaching_tip(tier, sample.direction, &signals, word_count);

        SlopReport {
            message_id: sample.message_id.clone(),
            app: sample.app,
            direction: sample.direction,
            sender: sample.sender.clone(),
            subject_or_topic: sample.subject_or_topic.clone(),
            timestamp: sample.timestamp.clone(),
            word_count,
            slop_score: heuristic_score,
            heuristic_score,
            luna_score: None,
            tier,
            is_slop_grenade: tier == AnimationTier::SlopGrenade,
            monitor_side,
            breakdown,
            signals,
            summary,
            self_awareness_tip,
            redacted_preview: redact_preview(&sample.body),
        }
    }

    /// Merge a semantic [`LunaJudgment`] from GitHub GPT Luna (`gpt-5.6-luna`) into a [`SlopReport`].
    pub fn merge_luna_judgment(
        &self,
        mut report: SlopReport,
        judgment: &LunaJudgment,
    ) -> SlopReport {
        if report
            .summary
            .starts_with("Automated / machine-generated response")
        {
            return report;
        }
        let clamped_luna = judgment.slop_score.min(100);
        // Blend heuristic and GPT Luna scores (55% GPT Luna + 45% deterministic heuristics,
        // while preserving high-confidence grenade detections from either source).
        let blended = ((u16::from(clamped_luna) * 55 + u16::from(report.heuristic_score) * 45)
            / 100)
            .max(if report.heuristic_score >= 82 || clamped_luna >= 85 {
                82
            } else {
                0
            })
            .min(100) as u8;

        report.luna_score = Some(clamped_luna);
        report.breakdown.luna_score = Some(clamped_luna);
        report.slop_score = blended;
        report.tier = AnimationTier::from_score(blended);
        report.is_slop_grenade = report.tier == AnimationTier::SlopGrenade;
        report.signals.push(SlopSignal {
            category: SlopSignalCategory::LunaSemantic,
            label: format!(
                "GPT Luna ({}) semantic evaluation: {}",
                judgment.model, judgment.reasoning
            ),
            weight: clamped_luna / 3,
            excerpt: judgment.model.clone(),
        });
        report.summary =
            build_summary(report.tier, report.slop_score, report.direction, report.app);
        if !judgment.coaching_tip.trim().is_empty() {
            report.self_awareness_tip = judgment.coaching_tip.trim().to_string();
        }
        report
    }
}

/// Determine whether a communication is an automated system notification or machine-generated
/// auto-response (which must always be classified as [`AnimationTier::HumanSparkle`]).
pub fn is_automated_or_machine_generated(sample: &MessageSample) -> bool {
    let sender = sample.sender.to_lowercase();
    let subject = sample.subject_or_topic.to_lowercase();
    let body = sample.body.to_lowercase();

    let automated_sender_markers = [
        "no-reply",
        "noreply",
        "do-not-reply",
        "donotreply",
        "mailer-daemon",
        "postmaster",
        "microsoft viva",
        "viva-noreply",
        "sharepoint online",
        "azuredevops",
        "azure monitor",
        "servicenow",
        "[bot]",
        "automated",
        "notification@",
        "alerts@",
    ];
    if automated_sender_markers.iter().any(|m| sender.contains(m)) {
        return true;
    }

    let automated_subject_prefixes = [
        "automatic reply:",
        "auto-reply:",
        "autoreply:",
        "out of office",
        "accepted:",
        "declined:",
        "tentative:",
        "canceled:",
        "cancelled:",
        "undeliverable:",
    ];
    if automated_subject_prefixes
        .iter()
        .any(|p| subject.starts_with(p) || subject.contains(p))
    {
        return true;
    }

    let automated_body_markers = [
        "this is an automated message",
        "this is an automatically generated",
        "please do not reply to this email",
        "do not reply to this message",
        "unsubscribe from these notifications",
        "generated automatically by",
        "microsoft viva briefing",
    ];
    automated_body_markers.iter().any(|m| body.contains(m))
}

/// Add one evidence signal and return its weight for the family subtotal.
fn record_signal(
    signals: &mut Vec<SlopSignal>,
    category: SlopSignalCategory,
    label: String,
    weight: u8,
    excerpt: String,
) -> u16 {
    signals.push(SlopSignal {
        category,
        label,
        weight,
        excerpt,
    });
    u16::from(weight)
}

/// Lower-case text with curly quotes and non-breaking spaces folded to ASCII.
fn fold_typographic_quotes(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\u{2018}' | '\u{2019}' => '\'',
            '\u{201C}' | '\u{201D}' => '"',
            '\u{00A0}' => ' ',
            other => other,
        })
        .collect()
}

fn add_phrase_hits(
    lower: &str,
    table: &[(&'static str, u8)],
    matched: &mut Vec<&'static str>,
    signals: &mut Vec<SlopSignal>,
    label: impl Fn(&str) -> String,
) -> u16 {
    let mut raw: u16 = 0;
    for &(phrase, weight) in table {
        if lower.contains(phrase) && !matched.contains(&phrase) {
            matched.push(phrase);
            raw = raw.saturating_add(record_signal(
                signals,
                SlopSignalCategory::LexicalCliche,
                label(phrase),
                weight,
                phrase.to_string(),
            ));
        }
    }
    raw
}

fn score_lexical(lower: &str, signals: &mut Vec<SlopSignal>) -> u8 {
    let mut matched = Vec::new();
    let mut raw = add_phrase_hits(lower, OPENING_CLICHES, &mut matched, signals, |_| {
        "Formulaic AI opening/closing cliché".to_string()
    });
    raw = raw.saturating_add(add_phrase_hits(
        lower,
        AI_BUZZWORDS,
        &mut matched,
        signals,
        |word| format!("High-frequency AI buzzword '{word}'"),
    ));
    raw = raw.saturating_add(add_phrase_hits(
        lower,
        FORMULAIC_TRANSITIONS,
        &mut matched,
        signals,
        |_| "Formulaic LLM transition phrase".to_string(),
    ));
    raw = raw.saturating_add(add_phrase_hits(
        lower,
        AI_PHRASES,
        &mut matched,
        signals,
        |_| "Stock AI assistant phrasing".to_string(),
    ));
    for &(word, weight) in AI_WORDS {
        let overlaps = matched
            .iter()
            .any(|seen| seen.contains(word) || word.contains(*seen));
        if !overlaps && has_word_start(lower, word) {
            matched.push(word);
            raw = raw.saturating_add(record_signal(
                signals,
                SlopSignalCategory::LexicalCliche,
                format!("AI-favoured word '{word}'"),
                weight,
                word.to_string(),
            ));
        }
    }
    raw.min(100) as u8
}

fn score_structure(
    body: &str,
    lower: &str,
    lines: &[&str],
    is_teams: bool,
    signals: &mut Vec<SlopSignal>,
) -> (u8, usize) {
    let structure = SlopSignalCategory::StructuralSymmetry;
    let mut raw: u16 = 0;

    let bold_bullet_count = lines
        .iter()
        .filter(|line| {
            is_bullet(line) && line.contains("**") && (line.contains(":**") || line.contains("**:"))
        })
        .count();
    if bold_bullet_count >= 2 {
        let weight = (bold_bullet_count * 14).min(56) as u8;
        raw += record_signal(
            signals,
            structure,
            format!(
                "Bolded bullet-header wall ({bold_bullet_count} symmetrical `- **Header:**` items)"
            ),
            weight,
            "- **Heading:** ...".to_string(),
        );
    }

    let heading_count = lines
        .iter()
        .filter(|line| {
            line.starts_with('#')
                || (line.starts_with("**") && line.ends_with("**") && line.chars().count() > 4)
        })
        .count();
    if heading_count >= 2 {
        let weight = (heading_count * 10).min(30) as u8;
        raw += record_signal(
            signals,
            structure,
            format!("Multi-section essay headings ({heading_count} sections)"),
            weight,
            "### Section Header".to_string(),
        );
    } else if heading_count == 1 {
        raw += record_signal(
            signals,
            structure,
            "Markdown section heading".to_string(),
            6,
            "### Heading".to_string(),
        );
    }

    let em_dash_count = body.matches('\u{2014}').count()
        + body.matches(" -- ").count()
        + body.matches(" \u{2013} ").count();
    if em_dash_count > 0 {
        let weight = if is_teams {
            (6 + 4 * em_dash_count).min(26)
        } else {
            (2 + 4 * em_dash_count).min(20)
        };
        raw += record_signal(
            signals,
            structure,
            format!("Em-dash rhetorical style ({em_dash_count} occurrences)"),
            weight as u8,
            "\u{2014}".to_string(),
        );
    }

    let bullet_count = lines.iter().filter(|line| is_bullet(line)).count();
    if bold_bullet_count < 2 && bullet_count >= 3 {
        let base: u8 = if is_teams { 14 } else { 10 };
        let long_list: u8 = if bullet_count >= 5 { 4 } else { 0 };
        raw += record_signal(
            signals,
            structure,
            format!("Formatted bullet list ({bullet_count} items)"),
            base + long_list,
            "- item".to_string(),
        );
    } else if bold_bullet_count < 2 && bullet_count == 2 {
        raw += record_signal(
            signals,
            structure,
            "Two-item bullet list".to_string(),
            4,
            "- item".to_string(),
        );
    }

    let bold_spans = body.matches("**").count() / 2;
    if bold_bullet_count < 2 && heading_count == 0 && bold_spans >= 1 {
        let weight = (8 + 3 * (bold_spans - 1)).min(16) as u8;
        raw += record_signal(
            signals,
            structure,
            format!("Markdown bold emphasis ({bold_spans} spans)"),
            weight,
            "**bold**".to_string(),
        );
    }

    let emoji_lines = lines.iter().filter(|line| starts_with_emoji(line)).count();
    if emoji_lines >= 2 {
        raw += record_signal(
            signals,
            structure,
            format!("Emoji-led bullet lines ({emoji_lines})"),
            18,
            "\u{2705} ...".to_string(),
        );
    }

    if is_teams {
        let curly_quotes = body
            .chars()
            .filter(|c| matches!(c, '\u{2018}' | '\u{2019}' | '\u{201C}' | '\u{201D}'))
            .count();
        if curly_quotes > 0 {
            let weight = if curly_quotes >= 3 { 8 } else { 6 };
            raw += record_signal(
                signals,
                structure,
                "Typographic curly quotes in a chat message".to_string(),
                weight,
                "\u{2019}".to_string(),
            );
        }
        let paragraphs = count_paragraphs(lines, 8);
        if paragraphs >= 3 {
            raw += record_signal(
                signals,
                structure,
                format!("Essay paragraphs in a chat message ({paragraphs})"),
                10,
                "multi-paragraph chat".to_string(),
            );
        }
    }

    let list_lead_in = lines.iter().enumerate().any(|(index, line)| {
        line.ends_with(':')
            && (lines.get(index + 1).is_some_and(|next| is_bullet(next))
                || (lines.get(index + 1).is_some_and(|next| next.is_empty())
                    && lines.get(index + 2).is_some_and(|next| is_bullet(next))))
    });
    if list_lead_in {
        raw += record_signal(
            signals,
            structure,
            "Colon lead-in introducing a list".to_string(),
            6,
            "...:".to_string(),
        );
    }

    let triples = count_rule_of_three(lower);
    if triples > 0 {
        let weight = if triples >= 2 { 8 } else { 4 };
        raw += record_signal(
            signals,
            structure,
            format!("Rule-of-three list rhythm ({triples})"),
            weight,
            ", and ".to_string(),
        );
    }

    (raw.min(100) as u8, bold_bullet_count)
}

fn score_handoff(
    lower: &str,
    app: M365App,
    word_count: usize,
    bold_bullet_count: usize,
    signals: &mut Vec<SlopSignal>,
) -> u8 {
    let mut raw: u16 = 0;
    let mut matched: Vec<&str> = Vec::new();
    for (table, label) in [
        (
            PASSIVE_HANDOFF_PHRASES,
            "Unreviewed AI handoff / prompt-bleed phrase",
        ),
        (ASSISTANT_VOICE, "Assistant voice left in the message"),
    ] {
        for &(phrase, weight) in table {
            if lower.contains(phrase) && !matched.iter().any(|seen| seen.contains(phrase)) {
                matched.push(phrase);
                raw = raw.saturating_add(record_signal(
                    signals,
                    SlopSignalCategory::PassiveHandoff,
                    label.to_string(),
                    weight,
                    phrase.to_string(),
                ));
            }
        }
    }

    if lower
        .lines()
        .any(|line| line.trim_start().starts_with("subject:"))
    {
        raw = raw.saturating_add(record_signal(
            signals,
            SlopSignalCategory::PassiveHandoff,
            "Pasted email draft (Subject: line inside the body)".to_string(),
            20,
            "Subject:".to_string(),
        ));
    }

    if app == M365App::Teams && (word_count >= 140 || bold_bullet_count >= 3) {
        let weight = if word_count >= 220 { 24 } else { 16 };
        raw = raw.saturating_add(record_signal(
            signals,
            SlopSignalCategory::ChannelMismatch,
            format!(
                "Teams channel norm violation ({word_count} words / {bold_bullet_count} bold bullets in chat)"
            ),
            weight,
            format!("{word_count} words in Teams chat"),
        ));
    } else if matches!(app, M365App::Outlook | M365App::Gmail)
        && word_count >= 280
        && bold_bullet_count >= 3
    {
        raw = raw.saturating_add(record_signal(
            signals,
            SlopSignalCategory::ChannelMismatch,
            format!(
                "Overstuffed email wall ({word_count} words with {bold_bullet_count} bolded bullet blocks)"
            ),
            16,
            format!(
                "{word_count} words in {}",
                if app == M365App::Gmail {
                    "Gmail"
                } else {
                    "Outlook"
                }
            ),
        ));
    }
    raw.min(100) as u8
}

/// `true` when `needle` occurs at the start of a word (not inside a longer word).
fn has_word_start(haystack: &str, needle: &str) -> bool {
    haystack.match_indices(needle).any(|(start, _)| {
        !matches!(haystack[..start].chars().next_back(), Some(c) if c.is_alphanumeric())
    })
}

/// `true` when `word` occurs as a whole word (used for casual slang).
fn contains_whole_word(haystack: &str, word: &str) -> bool {
    haystack.match_indices(word).any(|(start, _)| {
        let before = haystack[..start].chars().next_back();
        let after = haystack[start + word.len()..].chars().next();
        !matches!(before, Some(c) if c.is_alphanumeric())
            && !matches!(after, Some(c) if c.is_ascii_lowercase())
    })
}

/// `true` when a stand-alone lower-case "i" appears (as in "i think" or "i'm").
fn has_lowercase_i(body: &str) -> bool {
    body.match_indices('i').any(|(start, _)| {
        let before = body[..start].chars().next_back();
        let after = body[start + 1..].chars().next();
        !matches!(before, Some(c) if !c.is_whitespace())
            && !matches!(after, Some(c) if !(c.is_whitespace() || c == '\'' || c == '\u{2019}'))
    })
}

fn contains_emoticon(lower: &str, emoticon: &str) -> bool {
    let word_like = emoticon.starts_with(|c: char| c.is_alphanumeric());
    lower.match_indices(emoticon).any(|(start, _)| {
        let before = lower[..start].chars().next_back();
        let after = lower[start + emoticon.len()..].chars().next();
        let clean_before = !word_like || !matches!(before, Some(c) if c.is_alphanumeric());
        clean_before && !matches!(after, Some(c) if c.is_alphanumeric())
    })
}

/// Bullet or numbered list line (`- `, `* `, `• `, `1. `, `2) ` and similar markers).
fn is_bullet(line: &str) -> bool {
    const MARKERS: [&str; 10] = [
        "- ",
        "* ",
        "\u{2022} ",
        "\u{00B7} ",
        "\u{25AA} ",
        "\u{25E6} ",
        "\u{2013} ",
        "\u{2023} ",
        "\u{25BA} ",
        "\u{2192} ",
    ];
    if MARKERS.iter().any(|marker| line.starts_with(marker)) {
        return true;
    }
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if !(1..=2).contains(&digits) {
        return false;
    }
    let rest = &line[digits..];
    rest.starts_with(". ") || rest.starts_with(") ")
}

fn starts_with_emoji(line: &str) -> bool {
    line.chars().next().is_some_and(|c| {
        let code = u32::from(c);
        (0x1F300..=0x1FAFF).contains(&code) || (0x2600..=0x27BF).contains(&code) || code == 0x2B50
    })
}

/// Blank-line separated blocks with at least `min_words` words.
fn count_paragraphs(lines: &[&str], min_words: usize) -> usize {
    let mut paragraphs = 0;
    let mut words_in_block = 0;
    for line in lines.iter().chain(std::iter::once(&"")) {
        if line.is_empty() {
            if words_in_block >= min_words {
                paragraphs += 1;
            }
            words_in_block = 0;
        } else {
            words_in_block += line.split_whitespace().count();
        }
    }
    paragraphs
}

/// Count "x, y, and z" style triplets inside one sentence.
fn count_rule_of_three(lower: &str) -> usize {
    [", and ", ", or "]
        .iter()
        .map(|joiner| {
            lower
                .match_indices(joiner)
                .filter(|&(start, _)| {
                    let window_start = lower[..start]
                        .char_indices()
                        .rev()
                        .nth(59)
                        .map_or(0, |(index, _)| index);
                    let window = &lower[window_start..start];
                    window.contains(", ") && !window.contains(['.', '!', '?', '\n'])
                })
                .count()
        })
        .sum()
}

/// Sentence-like segments: split after `.`, `!` or `?` followed by whitespace, and at line
/// breaks. Only segments with at least two words are kept.
fn sentence_segments(body: &str) -> Vec<String> {
    fn keep(segments: &mut Vec<String>, current: &str) {
        let trimmed = current.trim();
        if trimmed.split_whitespace().count() >= 2 {
            segments.push(trimmed.to_string());
        }
    }
    let mut segments = Vec::new();
    let mut current = String::new();
    let mut previous = '\n';
    for c in body.chars() {
        if c == '\n' || (c.is_whitespace() && matches!(previous, '.' | '!' | '?')) {
            keep(&mut segments, &current);
            current.clear();
        } else {
            current.push(c);
        }
        previous = c;
    }
    keep(&mut segments, &current);
    segments
}

/// Count human typing fingerprints that assistants almost never produce.
fn count_human_fingerprints(
    body: &str,
    lower: &str,
    segments: &[String],
    word_count: usize,
) -> usize {
    let mut marks = 0;
    if segments.iter().any(|segment| {
        segment
            .chars()
            .next()
            .is_some_and(|c| c.is_alphabetic() && c.is_lowercase())
    }) {
        marks += 1;
    }
    if has_lowercase_i(body) {
        marks += 1;
    }
    marks += HUMAN_SLANG
        .iter()
        .filter(|slang| {
            if slang.contains(' ') {
                lower.contains(*slang)
            } else {
                contains_whole_word(lower, slang)
            }
        })
        .count();
    if body.contains("??") || body.contains("!!") || body.contains("...") {
        marks += 1;
    }
    if EMOTICONS
        .iter()
        .any(|emoticon| contains_emoticon(lower, emoticon))
    {
        marks += 1;
    }
    let unfinished = segments
        .iter()
        .rev()
        .find(|segment| segment.split_whitespace().count() >= 4)
        .and_then(|segment| segment.chars().next_back())
        .is_some_and(char::is_alphanumeric);
    if word_count < 60 && unfinished {
        marks += 1;
    }
    marks
}

/// Prior for uniformly tidy, formal prose: every sentence capitalised and punctuated, no
/// typing quirks, long words, and essay length in chat.
fn compute_polish_prior(
    words: &[&str],
    segments: &[String],
    word_count: usize,
    is_teams: bool,
    no_human_marks: bool,
    signals: &mut Vec<SlopSignal>,
) -> u8 {
    let sentences: Vec<&String> = segments
        .iter()
        .filter(|segment| segment.split_whitespace().count() >= 3)
        .collect();
    let tidy = sentences
        .iter()
        .filter(|segment| {
            segment
                .chars()
                .next()
                .is_some_and(|c| c.is_uppercase() || !c.is_alphabetic())
        })
        .count();
    let mut prior: u8 = 0;
    if word_count >= 20
        && no_human_marks
        && !sentences.is_empty()
        && tidy * 100 >= sentences.len() * 85
    {
        prior = if word_count >= 120 {
            20
        } else if word_count >= 60 {
            16
        } else if word_count >= 35 {
            12
        } else {
            8
        };
    }

    let letter_lengths: Vec<usize> = words
        .iter()
        .map(|word| word.chars().filter(char::is_ascii_alphabetic).count())
        .filter(|&len| len > 0)
        .collect();
    if word_count >= 20 && !letter_lengths.is_empty() {
        let long = letter_lengths.iter().filter(|&&len| len >= 9).count();
        if long * 100 > letter_lengths.len() * 22 {
            prior += 8;
        } else if long * 100 > letter_lengths.len() * 16 {
            prior += 4;
        }
    }

    if is_teams {
        prior += if word_count >= 100 {
            10
        } else if word_count >= 60 {
            6
        } else {
            0
        };
    }

    if prior > 0 {
        signals.push(SlopSignal {
            category: SlopSignalCategory::LowBurstiness,
            label: "Uniformly polished, formal prose with no human typing quirks".to_string(),
            weight: prior,
            excerpt: format!("{word_count} tidy words"),
        });
    }
    prior
}

fn compute_low_burstiness_score(
    body: &str,
    word_count: usize,
    signals: &mut Vec<SlopSignal>,
) -> u8 {
    if word_count < 25 {
        return 0;
    }
    let sentence_lengths: Vec<usize> = body
        .split(['.', '!', '?', '\n'])
        .map(|s| s.split_whitespace().count())
        .filter(|&len| len >= 3)
        .collect();

    if sentence_lengths.len() < 3 {
        return 0;
    }

    let total: usize = sentence_lengths.iter().sum();
    let mean = total as f64 / sentence_lengths.len() as f64;
    let variance = sentence_lengths
        .iter()
        .map(|&len| {
            let diff = len as f64 - mean;
            diff * diff
        })
        .sum::<f64>()
        / sentence_lengths.len() as f64;
    let std_dev = variance.sqrt();

    // AI sentences hover uniformly around 10-30 words with low relative standard deviation.
    let coeff_of_variation = if mean > 0.0 { std_dev / mean } else { 1.0 };
    if !(10.0..=30.0).contains(&mean) {
        return 0;
    }
    let weight = if sentence_lengths.len() >= 5 {
        if coeff_of_variation < 0.28 {
            20
        } else if coeff_of_variation < 0.38 {
            12
        } else if coeff_of_variation < 0.48 {
            6
        } else {
            0
        }
    } else if coeff_of_variation < 0.28 {
        10
    } else if coeff_of_variation < 0.38 {
        6
    } else {
        0
    };
    if weight > 0 {
        signals.push(SlopSignal {
            category: SlopSignalCategory::LowBurstiness,
            label: format!(
                "Robotic sentence cadence (avg {:.1} words/sentence, CV {:.2})",
                mean, coeff_of_variation
            ),
            weight,
            excerpt: "Uniform sentence lengths".to_string(),
        });
    }
    weight
}

fn build_summary(
    tier: AnimationTier,
    score: u8,
    direction: MessageDirection,
    app: M365App,
) -> String {
    let dir_label = match direction {
        MessageDirection::Received => "Incoming",
        MessageDirection::Sent => "Your outgoing",
    };
    let app_label = match app {
        M365App::Teams => "Teams message",
        M365App::Outlook => "Outlook email",
        M365App::Gmail => "Gmail email",
        M365App::SharePoint => "SharePoint post",
        M365App::Word => "Word comment",
        M365App::CopilotChat => "Copilot share",
        M365App::Other => "M365 message",
    };

    match tier {
        AnimationTier::HumanSparkle => format!(
            "{dir_label} {app_label} scored {score}/100 — authentic human voice! Triggering subtle sparkle plumes."
        ),
        AnimationTier::PeacefulCloud => format!(
            "{dir_label} {app_label} scored {score}/100 — lightly polished prose. Drifting a peaceful cloud."
        ),
        AnimationTier::InnocentFruit => format!(
            "{dir_label} {app_label} scored {score}/100 — moderate AI template assist. Launching an innocent fruit."
        ),
        AnimationTier::SlopSplat => format!(
            "{dir_label} {app_label} scored {score}/100 — heavy AI corporate-speak detected! Triggering a warning slop splat."
        ),
        AnimationTier::SlopGrenade => format!(
            "SLOP GRENADE ALERT ({score}/100)! {dir_label} {app_label} is an unedited AI wall—launching hand grenade & squishy goop splat!"
        ),
    }
}

fn build_coaching_tip(
    tier: AnimationTier,
    direction: MessageDirection,
    signals: &[SlopSignal],
    word_count: usize,
) -> String {
    match (direction, tier) {
        (MessageDirection::Sent, AnimationTier::SlopGrenade) => format!(
            "Pause before throwing this grenade ({word_count} words)! Strip the `- **Bold:**` bullet wall, delete the opening cliché, and state your actual ask in 2–3 plain human sentences."
        ),
        (MessageDirection::Sent, AnimationTier::SlopSplat) => {
            "Your draft leans heavily on AI buzzwords. Replace abstract phrases ('strategic alignment', 'delve', 'foster') with concrete team nouns and a direct question.".to_string()
        }
        (MessageDirection::Sent, AnimationTier::InnocentFruit) => {
            "Harmless AI polish detected in your message. Trim one transition word ('Furthermore', 'Additionally') to sound more like yourself.".to_string()
        }
        (MessageDirection::Sent, AnimationTier::PeacefulCloud | AnimationTier::HumanSparkle) => {
            "Clean, human-scale message! You respected your colleagues' cognitive bandwidth.".to_string()
        }
        (MessageDirection::Received, AnimationTier::SlopGrenade) => {
            let first_signal = signals
                .first()
                .map(|s| s.label.as_str())
                .unwrap_or("Unreviewed AI dump");
            format!(
                "Colleague threw a Slop Grenade ({first_signal}). Ask them for a 2-bullet human TL;DR of what decision they actually need from you."
            )
        }
        (MessageDirection::Received, AnimationTier::SlopSplat) => {
            "Heavy AI corporate-speak received. Skim past the boilerplate opener and check the last paragraph for the real question.".to_string()
        }
        (MessageDirection::Received, _) => {
            "Low cognitive tax—easy to read and respond to directly.".to_string()
        }
    }
}

fn redact_preview(body: &str) -> String {
    let single_line = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = single_line.chars();
    let preview: String = chars.by_ref().take(120).collect();
    if chars.next().is_some() {
        format!("{preview}…")
    } else {
        preview
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_gmail_email_uses_the_same_overstuffed_wall_penalty_as_outlook() {
        let body = (0..4)
            .map(|_| format!("- **Section:** {}", "detail ".repeat(68)))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(body.split_whitespace().count(), 280);
        let detector = SlopDetector::new();
        for direction in [MessageDirection::Sent, MessageDirection::Received] {
            let mut message = sample(M365App::Outlook, direction, &body);
            let mut outlook = detector.analyze(&message);
            let full_score = outlook.slop_score;
            assert!(
                full_score >= 80,
                "a 280-word bold-bullet email wall is a grenade, got {full_score}"
            );
            assert_eq!(outlook.breakdown.handoff_score, 16);
            message.app = M365App::Gmail;
            let gmail = detector.analyze(&message);
            assert_eq!(
                gmail.slop_score, full_score,
                "Gmail must not miss the email penalty"
            );
            assert_eq!(gmail.breakdown, outlook.breakdown);
            assert!(gmail.signals.iter().any(|signal| signal.category
                == SlopSignalCategory::ChannelMismatch
                && signal.weight == 16));
            outlook.app = M365App::Gmail;
            outlook.summary = outlook.summary.replace("Outlook email", "Gmail email");
            for signal in &mut outlook.signals {
                signal.excerpt = signal.excerpt.replace("words in Outlook", "words in Gmail");
            }
            assert_eq!(gmail, outlook);

            // Preserve the original 280-word threshold for both email sources.
            let shorter = body.replacen("detail ", "", 1);
            message.body = shorter;
            let gmail_short = detector.analyze(&message);
            message.app = M365App::Outlook;
            let outlook_short = detector.analyze(&message);
            assert_eq!(gmail_short.word_count, 279);
            assert_eq!(
                u16::from(gmail_short.slop_score) + 16,
                u16::from(full_score),
                "only the 16-point email wall penalty depends on the 280-word threshold"
            );
            assert_eq!(gmail_short.slop_score, outlook_short.slop_score);
            assert_eq!(gmail_short.breakdown.handoff_score, 0);
        }
    }

    #[test]
    fn gmail_has_email_scoring_parity_and_roundtrips_without_schema_changes() {
        let detector = SlopDetector::new();
        for preset in [
            "human_sparkle",
            "peaceful_cloud",
            "innocent_fruit",
            "slop_splat",
            "slop_grenade",
        ] {
            let mut sample = crate::presets::build_preset_sample(preset, 1);
            sample.app = M365App::Outlook;
            let mut outlook = detector.analyze(&sample);
            sample.app = M365App::Gmail;
            let gmail = detector.analyze(&sample);
            outlook.app = M365App::Gmail;
            outlook.summary = outlook.summary.replace("Outlook email", "Gmail email");
            assert_eq!(gmail, outlook);
            let json = serde_json::to_value(&gmail).unwrap();
            assert_eq!(json["app"], "gmail");
            assert!(json.get("slopScore").is_some());
            assert!(json.get("slop_score").is_none());
            assert_eq!(serde_json::from_value::<SlopReport>(json).unwrap(), gmail);
            let encoded = serde_json::to_string(&sample).unwrap();
            assert_eq!(
                serde_json::from_str::<MessageSample>(&encoded).unwrap(),
                sample
            );
        }
    }

    #[test]
    fn every_score_maps_to_unchanged_tier_boundaries() {
        for score in 0..=100 {
            let expected = match score {
                0..=19 => AnimationTier::HumanSparkle,
                20..=39 => AnimationTier::PeacefulCloud,
                40..=59 => AnimationTier::InnocentFruit,
                60..=79 => AnimationTier::SlopSplat,
                _ => AnimationTier::SlopGrenade,
            };
            assert_eq!(AnimationTier::from_score(score), expected);
        }
    }

    fn sample(app: M365App, direction: MessageDirection, body: &str) -> MessageSample {
        MessageSample {
            message_id: "msg-001".to_string(),
            app,
            direction,
            sender: "alex@contoso.com".to_string(),
            subject_or_topic: "Q4 Architecture Sync".to_string(),
            body: body.to_string(),
            timestamp: "2026-10-23T14:30:00Z".to_string(),
        }
    }

    #[test]
    fn authentic_human_message_triggers_subtle_sparkles() {
        let detector = SlopDetector::new();
        let msg = sample(
            M365App::Teams,
            MessageDirection::Received,
            "Hey Sam, I fixed the Cosmos partition key bug in PR #48. Can you sanity check line 92 before standup?",
        );
        let report = detector.analyze(&msg);

        assert!(
            report.slop_score <= 19,
            "expected score <= 19, got {}",
            report.slop_score
        );
        assert_eq!(report.tier, AnimationTier::HumanSparkle);
        assert!(!report.is_slop_grenade);
        assert_eq!(report.monitor_side, MonitorSide::Left);
    }

    #[test]
    fn lightly_formal_message_triggers_peaceful_cloud() {
        let detector = SlopDetector::new();
        let msg = sample(
            M365App::Outlook,
            MessageDirection::Sent,
            "Hi team, I hope your week is going well. Additionally, I uploaded the updated SQL benchmark spreadsheet to the shared folder so we can review the numbers tomorrow morning.",
        );
        let report = detector.analyze(&msg);

        assert!(
            (20..=39).contains(&report.slop_score),
            "expected PeacefulCloud score 20..=39, got {}",
            report.slop_score
        );
        assert_eq!(report.tier, AnimationTier::PeacefulCloud);
        assert_eq!(report.monitor_side, MonitorSide::Right);
    }

    #[test]
    fn moderate_ai_polish_triggers_innocent_fruit() {
        let detector = SlopDetector::new();
        let msg = sample(
            M365App::Outlook,
            MessageDirection::Received,
            "Thank you for reaching out about the migration timeline. We want to ensure a seamless handoff for the engineering group next sprint, so I have shared the updated test plan. Let me know if you have any questions.",
        );
        let report = detector.analyze(&msg);

        assert!(
            (40..=59).contains(&report.slop_score),
            "expected InnocentFruit score 40..=59, got {}",
            report.slop_score
        );
        assert_eq!(report.tier, AnimationTier::InnocentFruit);
        assert!(!report.is_slop_grenade);
    }

    #[test]
    fn heavy_corporate_buzzwords_trigger_slop_splat() {
        let detector = SlopDetector::new();
        let msg = sample(
            M365App::Outlook,
            MessageDirection::Sent,
            "I hope this email finds you well. In today's fast-paced evolving landscape, it is important to note that fostering cross-functional strategic alignment is pivotal. Furthermore, we must delve into holistic actionable insights to streamline our paradigm.",
        );
        let report = detector.analyze(&msg);

        assert!(
            (60..=79).contains(&report.slop_score),
            "expected SlopSplat score 60..=79, got {}",
            report.slop_score
        );
        assert_eq!(report.tier, AnimationTier::SlopSplat);
        assert!(report.self_awareness_tip.contains("buzzwords"));
    }

    #[test]
    fn unedited_ai_wall_in_teams_triggers_full_slop_grenade() {
        let detector = SlopDetector::new();
        let msg = sample(
            M365App::Teams,
            MessageDirection::Received,
            "I hope this message finds you well! Quick first pass from Copilot for reaction as we delve into the evolving landscape of Q4:\n\n\
             ### Key Takeaways\n\
             - **Strategic Alignment:** Fostering holistic cross-functional synergy across all pivotal workstreams.\n\
             - **Transformative Paradigm:** Leveraging seamless, robust architectures to catalyze actionable insights.\n\
             - **Operational Excellence:** Streamlining our multifaceted roadmap—not only for speed, but also for scale.\n\
             - **Next Steps:** Please do not hesitate to reach out as we spearhead this beacon of innovation.\n\n\
             In conclusion, it is important to note that this comprehensive overview underscores our north star.",
        );
        let report = detector.analyze(&msg);

        assert!(
            report.slop_score >= 80,
            "expected SlopGrenade score >= 80, got {}",
            report.slop_score
        );
        assert_eq!(report.tier, AnimationTier::SlopGrenade);
        assert!(report.is_slop_grenade);
        assert!(report
            .signals
            .iter()
            .any(|s| s.category == SlopSignalCategory::StructuralSymmetry));
        assert!(report
            .signals
            .iter()
            .any(|s| s.category == SlopSignalCategory::PassiveHandoff));
    }

    #[test]
    fn outgoing_user_slop_grenade_provides_direct_self_awareness_coaching() {
        let detector = SlopDetector::new();
        let msg = sample(
            M365App::Teams,
            MessageDirection::Sent,
            "Certainly! Here is a polished draft for the channel. I hope this message finds you well:\n\
             - **Holistic Synergy:** Delve into the multifaceted tapestry of our evolving landscape.\n\
             - **Key Takeaways:** Furthermore, it is worth noting that strategic alignment underscores our north star.\n\
             - **Actionable Insights:** Seamless cross-functional transformation across every paradigm.",
        );
        let report = detector.analyze(&msg);

        assert_eq!(report.tier, AnimationTier::SlopGrenade);
        assert_eq!(report.monitor_side, MonitorSide::Right);
        assert!(report
            .self_awareness_tip
            .contains("Pause before throwing this grenade"));
    }

    #[test]
    fn merging_luna_judgment_updates_score_and_preserves_grenade_threshold() {
        let detector = SlopDetector::new();
        let msg = sample(
            M365App::Outlook,
            MessageDirection::Received,
            "Here is a long synthetic update that looks subtle on the surface but is 100% unedited AI output.",
        );
        let initial = detector.analyze(&msg);
        let luna = LunaJudgment {
            slop_score: 92,
            model: "gpt-5.6-luna".to_string(),
            reasoning: "Unedited LLM output with zero human grounding".to_string(),
            coaching_tip: "Ask the sender for the single concrete decision needed.".to_string(),
        };

        let merged = detector.merge_luna_judgment(initial, &luna);
        assert_eq!(merged.luna_score, Some(92));
        assert!(merged.slop_score >= 80);
        assert_eq!(merged.tier, AnimationTier::SlopGrenade);
        assert!(merged.is_slop_grenade);
    }

    #[test]
    fn machine_generated_and_automated_responses_always_classify_as_sparkle() {
        let detector = SlopDetector::new();
        let auto_reply = MessageSample {
            message_id: "auto-1".to_string(),
            app: M365App::Outlook,
            direction: MessageDirection::Received,
            sender: "no-reply@contoso.com".to_string(),
            subject_or_topic: "Automatic reply: Q4 Strategy".to_string(),
            body: "This is an automated message. I am currently Out of Office:\n- **Key Takeaways:** Fostering holistic synergy.\n- **Strategic Alignment:** Delving into our evolving landscape.".to_string(),
            timestamp: "2026-10-23T15:00:00Z".to_string(),
        };

        let report = detector.analyze(&auto_reply);
        assert_eq!(report.tier, AnimationTier::HumanSparkle);
        assert!(!report.is_slop_grenade);
        assert!(report.slop_score <= 19);
    }

    #[test]
    fn stock_opener_with_buzzwords_is_heavy_ai_not_light_polish() {
        let detector = SlopDetector::new();
        let msg = sample(
            M365App::Outlook,
            MessageDirection::Received,
            "I hope this email finds you well. Thank you for reaching out regarding the migration timeline. Furthermore, we want to ensure a seamless transition and unlock value for the engineering group next sprint.",
        );
        let report = detector.analyze(&msg);
        assert!(
            (60..=79).contains(&report.slop_score),
            "expected SlopSplat score 60..=79, got {}",
            report.slop_score
        );
    }

    #[test]
    fn copilot_style_chat_reply_without_classic_buzzwords_is_a_grenade() {
        let detector = SlopDetector::new();
        let msg = sample(
            M365App::Teams,
            MessageDirection::Sent,
            "Great question! Here's a quick summary of where we landed:\n\n\
             - **Timeline:** We're on track to ship the pilot by Friday.\n\
             - **Risks:** The data migration still needs a final review.\n\
             - **Next steps:** I'll sync with Priya to confirm resource allocation.\n\n\
             Would you like me to draft a note for the wider team?",
        );
        let report = detector.analyze(&msg);
        assert!(
            report.slop_score >= 80,
            "expected SlopGrenade, got {}",
            report.slop_score
        );
        assert!(report
            .signals
            .iter()
            .any(|s| s.category == SlopSignalCategory::PassiveHandoff
                && s.excerpt == "would you like me to"));
    }

    #[test]
    fn polished_ai_email_with_numbered_observations_is_flagged() {
        let detector = SlopDetector::new();
        let msg = sample(
            M365App::Outlook,
            MessageDirection::Sent,
            "Hi Mark,\n\nThank you for sharing the draft proposal. I reviewed it in detail and have a few observations:\n\n\
             1. The executive summary clearly outlines the value proposition, but it could benefit from a stronger call to action.\n\
             2. The pricing section aligns with our strategy; however, we should ensure the discount tiers are consistent.\n\
             3. The timeline is ambitious, so it would be helpful to highlight key milestones and dependencies.\n\n\
             Overall, this is a solid foundation. Let me know if you'd like me to make these edits directly.\n\nBest regards,\nJean",
        );
        let report = detector.analyze(&msg);
        assert!(
            report.slop_score >= 60,
            "expected an AI-written score, got {}",
            report.slop_score
        );
    }

    #[test]
    fn emoji_checklist_recap_in_chat_is_a_grenade() {
        let detector = SlopDetector::new();
        let msg = sample(
            M365App::Teams,
            MessageDirection::Received,
            "Absolutely! Here\u{2019}s a quick recap of today\u{2019}s sync:\n\n\
             \u{2705} Pilot is on track for Friday\n\
             \u{2705} Data migration complete\n\
             \u{26A0}\u{FE0F} Licensing still pending\n\n\
             Let me know if you\u{2019}d like me to schedule a follow-up.",
        );
        let report = detector.analyze(&msg);
        assert!(
            report.slop_score >= 80,
            "expected SlopGrenade, got {}",
            report.slop_score
        );
    }

    #[test]
    fn casual_human_chat_stays_in_the_human_tier() {
        let detector = SlopDetector::new();
        for body in [
            "lol yeah that build is cursed, will look after lunch",
            "can you send me the deck? need it before 3",
            "ok cool, thx!",
            "Running 5 min late, start without me",
            "Fixed the null pointer in the auth retry loop. PR #142 is ready for a quick look.",
        ] {
            let report = detector.analyze(&sample(M365App::Teams, MessageDirection::Sent, body));
            assert!(
                report.slop_score <= 19,
                "{body:?} should read as human, got {}",
                report.slop_score
            );
        }
    }

    #[test]
    fn human_typing_fingerprints_lower_the_score() {
        let detector = SlopDetector::new();
        let polished = detector.analyze(&sample(
            M365App::Outlook,
            MessageDirection::Sent,
            "Thanks for sending the updated architecture diagram yesterday. I reviewed the networking section and added two comments about the firewall rules we discussed on Tuesday.",
        ));
        let casual = detector.analyze(&sample(
            M365App::Outlook,
            MessageDirection::Sent,
            "thx for sending the updated architecture diagram yesterday. reviewed the networking section and added two comments about the firewall rules we discussed on tuesday",
        ));
        assert!(polished.slop_score <= 19, "got {}", polished.slop_score);
        assert!(casual.slop_score < polished.slop_score);
    }

    #[test]
    fn curly_quotes_are_folded_before_phrase_matching() {
        let detector = SlopDetector::new();
        let straight = detector.analyze(&sample(
            M365App::Outlook,
            MessageDirection::Received,
            "I hope you're doing well. Let me know if you'd like me to send the slides.",
        ));
        let curly = detector.analyze(&sample(
            M365App::Outlook,
            MessageDirection::Received,
            "I hope you\u{2019}re doing well. Let me know if you\u{2019}d like me to send the slides.",
        ));
        assert_eq!(straight.slop_score, curly.slop_score);
        assert!(curly.slop_score >= 40, "got {}", curly.slop_score);
    }

    #[test]
    fn helper_matchers_respect_word_boundaries() {
        assert!(has_word_start("we must ensure it", "ensure"));
        assert!(!has_word_start("reensure", "ensure"));
        assert!(contains_whole_word("ok, thx", "thx"));
        assert!(!contains_whole_word("okay then", "ok"));
        assert!(!contains_whole_word("bank holiday", "k"));
        assert!(contains_emoticon("nice :)", ":)"));
        assert!(!contains_emoticon("status:done", ":d"));
        assert!(!contains_emoticon("under <30 days", "<3"));
        assert!(has_lowercase_i("yes i can"));
        assert!(has_lowercase_i("i\u{2019}m in"));
        assert!(!has_lowercase_i("I think so, hi there"));
        assert!(is_bullet("- item"));
        assert!(is_bullet("12) item"));
        assert!(!is_bullet("2026. was busy"));
        assert_eq!(count_rule_of_three("speed, quality, and cost"), 1);
        assert_eq!(count_rule_of_three("done. and then, or else"), 0);
        assert_eq!(
            sentence_segments("One two three. Four five\nsix seven! eight"),
            vec!["One two three.", "Four five", "six seven!"]
        );
    }
}
