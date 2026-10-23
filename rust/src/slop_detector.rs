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

    /// Human-readable title displayed in the UI and overlay badge.
    pub fn display_name(self) -> &'static str {
        match self {
            Self::HumanSparkle => "Human Sparkle Plume",
            Self::PeacefulCloud => "Peaceful Cloud",
            Self::InnocentFruit => "Innocent Fruit",
            Self::SlopSplat => "Slop Splat",
            Self::SlopGrenade => "SLOP GRENADE",
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

/// Microsoft 365 source application where the communication originated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum M365App {
    /// Microsoft Teams chat or channel message.
    Teams,
    /// Microsoft Outlook email message.
    Outlook,
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
    /// Score from flat sentence length cadence (low human burstiness).
    pub burstiness_score: u8,
    /// Score from passive AI handoffs, prompt bleed, or channel length mismatch.
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

impl SlopDetector {
    /// Create a new [`SlopDetector`].
    pub fn new() -> Self {
        Self
    }

    /// Analyze a [`MessageSample`] deterministically and produce a [`SlopReport`].
    pub fn analyze(&self, sample: &MessageSample) -> SlopReport {
        let lower = sample.body.to_lowercase();
        let words: Vec<&str> = sample.body.split_whitespace().collect();
        let word_count = words.len();
        let mut signals = Vec::new();

        // 1. Lexical clichés & AI vocabulary
        let mut lexical_raw: u16 = 0;
        for &(phrase, weight) in OPENING_CLICHES {
            if lower.contains(phrase) {
                lexical_raw = lexical_raw.saturating_add(u16::from(weight));
                signals.push(SlopSignal {
                    category: SlopSignalCategory::LexicalCliche,
                    label: "Formulaic AI opening/closing cliché".to_string(),
                    weight,
                    excerpt: phrase.to_string(),
                });
            }
        }
        for &(word, weight) in AI_BUZZWORDS {
            if lower.contains(word) {
                lexical_raw = lexical_raw.saturating_add(u16::from(weight));
                signals.push(SlopSignal {
                    category: SlopSignalCategory::LexicalCliche,
                    label: format!("High-frequency AI buzzword '{word}'"),
                    weight,
                    excerpt: word.to_string(),
                });
            }
        }
        for &(transition, weight) in FORMULAIC_TRANSITIONS {
            if lower.contains(transition) {
                lexical_raw = lexical_raw.saturating_add(u16::from(weight));
                signals.push(SlopSignal {
                    category: SlopSignalCategory::LexicalCliche,
                    label: "Formulaic LLM transition phrase".to_string(),
                    weight,
                    excerpt: transition.to_string(),
                });
            }
        }
        let lexical_score = lexical_raw.min(100) as u8;

        // 2. Structural symmetry (bolded bullet walls, markdown headers, em-dash density)
        let mut structural_raw: u16 = 0;
        let lines: Vec<&str> = sample.body.lines().map(str::trim).collect();
        let bold_bullet_count = lines
            .iter()
            .filter(|line| {
                let is_list = line.starts_with("- ")
                    || line.starts_with("* ")
                    || line.starts_with("• ")
                    || line
                        .chars()
                        .next()
                        .is_some_and(|c| c.is_ascii_digit() && line.contains(". "));
                is_list && line.contains("**") && (line.contains(":**") || line.contains("**:"))
            })
            .count();

        if bold_bullet_count >= 2 {
            let weight = ((bold_bullet_count as u16) * 14).min(56) as u8;
            structural_raw = structural_raw.saturating_add(u16::from(weight));
            signals.push(SlopSignal {
                category: SlopSignalCategory::StructuralSymmetry,
                label: format!(
                    "Bolded bullet-header wall ({bold_bullet_count} symmetrical `- **Header:**` items)"
                ),
                weight,
                excerpt: "- **Heading:** ...".to_string(),
            });
        }

        let heading_count = lines
            .iter()
            .filter(|line| {
                line.starts_with('#') || (line.starts_with("**") && line.ends_with("**"))
            })
            .count();
        if heading_count >= 2 {
            let weight = ((heading_count as u16) * 10).min(30) as u8;
            structural_raw = structural_raw.saturating_add(u16::from(weight));
            signals.push(SlopSignal {
                category: SlopSignalCategory::StructuralSymmetry,
                label: format!("Multi-section essay headings ({heading_count} sections)"),
                weight,
                excerpt: "### Section Header".to_string(),
            });
        }

        let em_dash_count = sample.body.matches('—').count() + sample.body.matches(" -- ").count();
        if em_dash_count >= 3 {
            let weight = ((em_dash_count as u16) * 5).min(20) as u8;
            structural_raw = structural_raw.saturating_add(u16::from(weight));
            signals.push(SlopSignal {
                category: SlopSignalCategory::StructuralSymmetry,
                label: format!("High em-dash rhetorical density ({em_dash_count} occurrences)"),
                weight,
                excerpt: "—".to_string(),
            });
        }
        let structural_score = structural_raw.min(100) as u8;

        // 3. Burstiness & uniform cadence
        let burstiness_score = compute_low_burstiness_score(&sample.body, word_count, &mut signals);

        // 4. Passive handoff disclaimers, prompt bleed, and channel mismatch
        let mut handoff_raw: u16 = 0;
        for &(phrase, weight) in PASSIVE_HANDOFF_PHRASES {
            if lower.contains(phrase) {
                handoff_raw = handoff_raw.saturating_add(u16::from(weight));
                signals.push(SlopSignal {
                    category: SlopSignalCategory::PassiveHandoff,
                    label: "Unreviewed AI handoff / prompt-bleed phrase".to_string(),
                    weight,
                    excerpt: phrase.to_string(),
                });
            }
        }

        if sample.app == M365App::Teams && (word_count >= 140 || bold_bullet_count >= 3) {
            let weight = if word_count >= 220 { 24 } else { 16 };
            handoff_raw = handoff_raw.saturating_add(u16::from(weight));
            signals.push(SlopSignal {
                category: SlopSignalCategory::ChannelMismatch,
                label: format!(
                    "Teams channel norm violation ({word_count} words / {bold_bullet_count} bold bullets in chat)"
                ),
                weight,
                excerpt: format!("{word_count} words in Teams chat"),
            });
        } else if sample.app == M365App::Outlook && word_count >= 280 && bold_bullet_count >= 3 {
            let weight = 16;
            handoff_raw = handoff_raw.saturating_add(u16::from(weight));
            signals.push(SlopSignal {
                category: SlopSignalCategory::ChannelMismatch,
                label: format!(
                    "Overstuffed email wall ({word_count} words with {bold_bullet_count} bolded bullet blocks)"
                ),
                weight,
                excerpt: format!("{word_count} words in Outlook"),
            });
        }
        let handoff_score = handoff_raw.min(100) as u8;

        // Combine signal families into a calibrated 0..=100 heuristic score.
        // Crossing into SlopGrenade (>= 80) deterministically requires structural slop
        // (bullet walls / multi-section headers) or a passive handoff / channel violation;
        // pure single-paragraph buzzwords cap at 78 (SlopSplat).
        let raw_combined = u16::from(lexical_score.min(74))
            + u16::from(structural_score)
            + u16::from(burstiness_score)
            + u16::from(handoff_score);

        let heuristic_score = if structural_score == 0 && handoff_score == 0 {
            raw_combined.min(78) as u8
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

fn compute_low_burstiness_score(
    body: &str,
    word_count: usize,
    signals: &mut Vec<SlopSignal>,
) -> u8 {
    if word_count < 35 {
        return 0;
    }
    let sentence_lengths: Vec<usize> = body
        .split(['.', '!', '?'])
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

    // AI sentences often hover uniformly around 14-24 words with low relative standard deviation.
    let coeff_of_variation = if mean > 0.0 { std_dev / mean } else { 1.0 };
    if (12.0..=28.0).contains(&mean) && coeff_of_variation < 0.28 {
        let weight = 26;
        signals.push(SlopSignal {
            category: SlopSignalCategory::LowBurstiness,
            label: format!(
                "Robotic sentence cadence (avg {:.1} words/sentence, CV {:.2})",
                mean, coeff_of_variation
            ),
            weight,
            excerpt: "Uniform sentence lengths".to_string(),
        });
        weight
    } else if (12.0..=28.0).contains(&mean) && coeff_of_variation < 0.38 {
        14
    } else {
        0
    }
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
            "Hey Jean, I fixed the Cosmos partition key bug in PR #48. Can you sanity check line 92 before standup?",
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
            "I hope this email finds you well. Thank you for reaching out regarding the migration timeline. Furthermore, we want to ensure a seamless transition and unlock value for the engineering group next sprint.",
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
}
