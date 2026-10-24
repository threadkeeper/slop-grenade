//! Shared desktop and mobile simulation fixtures.

use crate::slop_detector::{M365App, MessageDirection, MessageSample};

/// Build a realistic sample for any animation tier, defaulting to a grenade.
pub fn build_preset_sample(preset: &str, sequence_hint: u64) -> MessageSample {
    let id = format!("sim-{preset}-{sequence_hint}");
    match preset {
        "human_sparkle" => MessageSample {
            message_id: id,
            app: M365App::Teams,
            direction: MessageDirection::Received,
            sender: "Sarah Chen (Engineering)".to_string(),
            subject_or_topic: "PR #118 — Auth Token Cache".to_string(),
            body: "Hey! Just tested your branch locally—the WorkIQ stdio pipe reconnects cleanly now. LGTM, ship it whenever you're ready.".to_string(),
            timestamp: "2026-10-23T14:35:00Z".to_string(),
        },
        "peaceful_cloud" => MessageSample {
            message_id: id,
            app: M365App::Outlook,
            direction: MessageDirection::Received,
            sender: "David Patel".to_string(),
            subject_or_topic: "Friday Architecture Review Notes".to_string(),
            body: "Hi everyone, I hope your week is going well. Additionally, I have uploaded the slide deck from this morning's review so the team can check the latency numbers before Monday.".to_string(),
            timestamp: "2026-10-23T14:36:00Z".to_string(),
        },
        "innocent_fruit" => MessageSample {
            message_id: id,
            app: M365App::Outlook,
            direction: MessageDirection::Received,
            sender: "Priya Nair".to_string(),
            subject_or_topic: "Sprint 14 Planning Follow-up".to_string(),
            body: "I hope this email finds you well. Thank you for reaching out about the Q4 milestones. Furthermore, we want to ensure a seamless handoff and unlock value for the mobile squad next week.".to_string(),
            timestamp: "2026-10-23T14:37:00Z".to_string(),
        },
        "slop_splat" => MessageSample {
            message_id: id,
            app: M365App::Outlook,
            direction: MessageDirection::Received,
            sender: "Marcus Vance".to_string(),
            subject_or_topic: "Driving Cross-Functional Synergy in Q4".to_string(),
            body: "I hope this email finds you well. In today's fast-paced evolving landscape, it is important to note that fostering cross-functional strategic alignment is pivotal. Furthermore, we must delve into holistic actionable insights to streamline our paradigm.".to_string(),
            timestamp: "2026-10-23T14:38:00Z".to_string(),
        },
        "my_outgoing_grenade" => MessageSample {
            message_id: id,
            app: M365App::Teams,
            direction: MessageDirection::Sent,
            sender: "You (Self-Awareness Mirror)".to_string(),
            subject_or_topic: "Platform Strategy Thread".to_string(),
            body: "Certainly! Here is a polished draft for the team. I hope this message finds you well! Had Copilot take a pass for reaction:\n\
                   - **Strategic Alignment:** Fostering holistic cross-functional synergy across all pivotal workstreams.\n\
                   - **Transformative Paradigm:** Delving into the multifaceted tapestry of our evolving landscape.\n\
                   - **Actionable Insights:** Leveraging seamless, robust architectures to catalyze our north star.\n\
                   In conclusion, please do not hesitate to reach out!".to_string(),
            timestamp: "2026-10-23T14:39:00Z".to_string(),
        },
        _ => MessageSample {
            message_id: id,
            app: M365App::Teams,
            direction: MessageDirection::Received,
            sender: "Chad from Strategy".to_string(),
            subject_or_topic: "Quick Thoughts on Q4 Synergy".to_string(),
            body: "I hope this message finds you thriving! Quick first pass from AI for reaction as we delve into the evolving landscape:\n\n\
                   ### Key Takeaways\n\
                   - **Strategic Alignment:** Fostering holistic cross-functional synergy across all pivotal workstreams.\n\
                   - **Transformative Paradigm:** Leveraging seamless, robust architectures to catalyze actionable insights.\n\
                   - **Operational Excellence:** Streamlining our multifaceted roadmap—not only for speed, but also for scale.\n\
                   - **Next Steps:** Please do not hesitate to reach out as we spearhead this beacon of innovation.\n\n\
                   In conclusion, it is important to note that this comprehensive overview underscores our north star.".to_string(),
            timestamp: "2026-10-23T14:40:00Z".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slop_detector::{AnimationTier, SlopDetector};

    #[test]
    fn all_presets_keep_desktop_tiers() {
        for (preset, tier) in [
            ("human_sparkle", AnimationTier::HumanSparkle),
            ("peaceful_cloud", AnimationTier::PeacefulCloud),
            ("innocent_fruit", AnimationTier::InnocentFruit),
            ("slop_splat", AnimationTier::SlopSplat),
            ("slop_grenade", AnimationTier::SlopGrenade),
            ("my_outgoing_grenade", AnimationTier::SlopGrenade),
        ] {
            let sample = build_preset_sample(preset, 7);
            assert_eq!(sample.message_id, format!("sim-{preset}-7"));
            assert_eq!(SlopDetector::new().analyze(&sample).tier, tier, "{preset}");
        }
        assert_eq!(
            build_preset_sample("unknown", 1).body,
            build_preset_sample("slop_grenade", 1).body
        );
    }
}
