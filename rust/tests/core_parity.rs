//! Compatibility checks for the desktop public paths after core extraction.

use slop_grenade::event_bus::AnimationEventBus;
use slop_grenade::ledger::AwarenessLedger;
use slop_grenade::scanner_daemon::build_preset_sample;
use slop_grenade::slop_detector::{MessageSample, SlopDetector, SlopReport};

#[test]
fn old_public_paths_are_the_same_core_types_and_keep_presets_identical() {
    let detector: slop_grenade_core::slop_detector::SlopDetector = SlopDetector::new();
    let ledger: slop_grenade_core::ledger::AwarenessLedger = AwarenessLedger::new();
    let bus: slop_grenade_core::event_bus::AnimationEventBus = AnimationEventBus::new();
    for preset in [
        "human_sparkle",
        "peaceful_cloud",
        "innocent_fruit",
        "slop_splat",
        "slop_grenade",
        "my_outgoing_grenade",
    ] {
        let desktop: MessageSample = build_preset_sample(preset, 1);
        let core = slop_grenade_core::presets::build_preset_sample(preset, 1);
        assert_eq!(desktop, core);
        let report: SlopReport = detector.analyze(&desktop);
        assert_eq!(report, SlopDetector::new().analyze(&core));
        let serialized = serde_json::to_value(&report).unwrap();
        ledger.record(report.clone());
        assert_eq!(
            serde_json::to_value(bus.publish(report)).unwrap()["report"],
            serialized
        );
    }
    let scorecard = ledger.scorecard();
    assert_eq!(scorecard.received_by_me.total_messages, 5);
    assert_eq!(scorecard.sent_by_me.total_messages, 1);
    assert_eq!(scorecard.sent_by_me.slop_grenades, 1);
}
