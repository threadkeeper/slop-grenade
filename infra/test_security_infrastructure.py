"""Static security and software-assurance checks for Slop Grenade infrastructure and supply chain."""

from __future__ import annotations

import unittest
from pathlib import Path


class SecurityInfrastructureTests(unittest.TestCase):
    """Keep private-tenant deployment, container runtime, and supply-chain controls fail-closed."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.infra_dir = Path(__file__).resolve().parent
        cls.repo_root = cls.infra_dir.parent
        cls.bicep = (cls.infra_dir / "main.bicep").read_text(encoding="utf-8")
        cls.dockerfile = (cls.repo_root / "Dockerfile").read_text(encoding="utf-8")
        cls.deny_toml = (cls.repo_root / "rust" / "deny.toml").read_text(encoding="utf-8")
        cls.dependabot = (cls.repo_root / ".github" / "dependabot.yml").read_text(
            encoding="utf-8"
        )
        cls.assurance = (
            cls.repo_root / ".github" / "workflows" / "assurance.yml"
        ).read_text(encoding="utf-8")
        cls.macos_workflow = (
            cls.repo_root / ".github" / "workflows" / "macos.yml"
        ).read_text(encoding="utf-8")

    def test_bicep_defaults_to_internal_private_tenant_ingress_and_https_only(self) -> None:
        self.assertIn("param externalIngress bool = false", self.bicep)
        self.assertIn("external: externalIngress", self.bicep)
        self.assertIn("allowInsecure: false", self.bicep)
        self.assertIn("type: 'SystemAssigned'", self.bicep)
        self.assertIn("path: '/api/v1/health'", self.bicep)

    def test_dockerfile_builds_from_locked_manifests_and_runs_as_non_root(self) -> None:
        self.assertIn("npm --prefix web ci", self.dockerfile)
        self.assertIn(
            "cargo build --manifest-path rust/Cargo.toml --release --locked",
            self.dockerfile,
        )
        self.assertIn("useradd --create-home --uid 10001 appuser", self.dockerfile)
        self.assertIn("USER appuser", self.dockerfile)

    def test_cargo_deny_policy_rejects_vulnerabilities_wildcards_openssl_and_untrusted_sources(
        self,
    ) -> None:
        self.assertIn('yanked = "deny"', self.deny_toml)
        self.assertIn('wildcards = "deny"', self.deny_toml)
        self.assertIn('unknown-registry = "deny"', self.deny_toml)
        self.assertIn('unknown-git = "deny"', self.deny_toml)
        self.assertIn('name = "openssl"', self.deny_toml)

    def test_dependabot_and_assurance_pipeline_cover_all_manifests_for_on_the_go_prs(
        self,
    ) -> None:
        for ecosystem in (
            "package-ecosystem: github-actions",
            "package-ecosystem: cargo",
            "package-ecosystem: npm",
            "package-ecosystem: gradle",
            "package-ecosystem: docker",
        ):
            self.assertIn(ecosystem, self.dependabot)

        for cargo_dir in (
            "directory: /core",
            "directory: /rust",
            "directory: /mobile/rust-bridge",
        ):
            self.assertIn(cargo_dir, self.dependabot)

        self.assertIn("pull_request:", self.assurance)
        self.assertIn("rustsec/audit-check@", self.assurance)
        self.assertIn("EmbarkStudios/cargo-deny-action@", self.assurance)
        self.assertIn("--audit-level=low", self.assurance)

    def test_macos_workflow_builds_locked_universal_bundle_and_sha256_checksum(
        self,
    ) -> None:
        self.assertIn("aarch64-apple-darwin", self.macos_workflow)
        self.assertIn("x86_64-apple-darwin", self.macos_workflow)
        self.assertIn("cargo build --locked --manifest-path rust/Cargo.toml --release", self.macos_workflow)
        self.assertIn("slop-grenade-macos-universal.tar.gz.sha256", self.macos_workflow)
        self.assertIn("gh release upload", self.macos_workflow)


if __name__ == "__main__":
    unittest.main()
