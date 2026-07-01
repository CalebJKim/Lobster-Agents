from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nemoclaw_reef.integrations import nemoclaw
from nemoclaw_reef.integrations.process import CapturedRun
from nemoclaw_reef.integrations.nemoclaw_cli import (
    _parse_network_rule_list,
    _parse_policy_list,
    _redact_sensitive,
)
from nemoclaw_reef.integrations.openclaw_cli import _parse_openclaw_result, _parse_skill_status


def test_openclaw_timeout_preserves_partial_output() -> None:
    payload = {
        "result": {
            "meta": {
                "timedOut": True,
                "promptError": "request timed out | request timed out",
                "finalAssistantVisibleText": "I started the GTM outline.",
            }
        }
    }

    result = _parse_openclaw_result(json.dumps(payload))

    assert result.failed is True
    assert result.mode == "timeout"
    assert result.output == "request timed out | request timed out"
    assert result.diagnostics["timed_out"] is True
    assert result.diagnostics["partial_output"] == "I started the GTM outline."


def test_openclaw_timeout_payload_text_is_timeout_failure() -> None:
    payload = {
        "status": "ok",
        "result": {
            "payloads": [
                {
                    "text": (
                        "Request timed out before a response was generated. "
                        "Please try again, or increase `agents.defaults.timeoutSeconds` in your config."
                    )
                }
            ],
            "meta": {
                "aborted": True,
            },
        },
    }

    result = _parse_openclaw_result(json.dumps(payload))

    assert result.failed is True
    assert result.mode == "timeout"
    assert str(result.output).startswith("Request timed out")
    assert result.diagnostics["timed_out"] is True
    assert result.diagnostics["failure_kind"] == "timeout"
    assert result.diagnostics["partial_output"].startswith("Request timed out")


def test_openclaw_missing_brave_key_is_credential_failure() -> None:
    payload = {
        "result": {
            "meta": {
                "toolMetas": [
                    {
                        "name": "web_search",
                        "error": "missing_brave_api_key",
                    }
                ]
            }
        }
    }

    result = _parse_openclaw_result(json.dumps(payload))

    assert result.failed is False
    assert result.diagnostics["failure_kind"] == "credential_missing"
    assert result.diagnostics["tool_errors"][0]["error"] == "missing_brave_api_key"


def test_skill_status_splits_ready_setup_and_missing() -> None:
    status = _parse_skill_status(
        requested=["summarize", "skill-creator", "missing-skill"],
        skills_raw="\n".join(
            [
                "summarize — needs setup",
                "skill-creator — ready",
            ]
        ),
        install_status_raw="\n".join(
            [
                "INSTALL OK summarize",
                "INSTALL FAIL missing-skill",
            ]
        ),
    )

    assert status["ready"] == ["skill-creator"]
    assert status["needs_setup"] == ["summarize"]
    assert status["missing"] == ["missing-skill"]
    assert status["install_failed"] == ["missing-skill"]


def test_policy_list_parser_handles_enabled_and_disabled() -> None:
    policies = _parse_policy_list(
        "● brave — Brave Search API access\n"
        "○ github - GitHub CLI access\n"
        "not a policy line\n"
    )

    assert policies == [
        {"name": "brave", "description": "Brave Search API access", "enabled": True},
        {"name": "github", "description": "GitHub CLI access", "enabled": False},
    ]


def test_approval_snapshot_redacts_sensitive_fields() -> None:
    redacted = _redact_sensitive(
        {
            "socket": {"path": "/tmp/openclaw.sock", "token": "secret-token"},
            "defaults": {"api_key": "secret-key", "ask": "off"},
        }
    )

    assert redacted["socket"]["path"] == "/tmp/openclaw.sock"
    assert redacted["socket"]["token"] == "<redacted>"
    assert redacted["defaults"]["api_key"] == "<redacted>"
    assert redacted["defaults"]["ask"] == "off"


def test_network_rule_parser_handles_ansi_pending_approved_rejected() -> None:
    parsed = _parse_network_rule_list(
        "\x1b[1m\x1b[36mNetwork Rules:\x1b[39m\x1b[0m  (version 7, 3 chunks)\n\n"
        "  \x1b[2mChunk:\x1b[0m pending-id\n"
        "  \x1b[2mStatus:\x1b[0m \x1b[33mpending\x1b[39m\n"
        "  \x1b[2mRule:\x1b[0m allow_example_com_443\n"
        "  \x1b[2mBinary:\x1b[0m /usr/local/bin/node\n"
        "  \x1b[2mConfidence:\x1b[0m 65%\n"
        "  \x1b[2mRationale:\x1b[0m Allow node to connect to example.com:443 (HTTPS).\n"
        "  \x1b[2mEndpoints:\x1b[0m example.com:443 [L4]\n"
        "  \x1b[2mBinaries:\x1b[0m /usr/local/bin/node\n"
        "  \x1b[2mHits:\x1b[0m 2 (first seen 2026-05-29 02:52:18, last seen 2026-05-29 05:20:38)\n\n"
        "  Chunk: approved-id\n"
        "  Status: approved\n"
        "  Rule: allow_api_example_com_443\n"
        "  Binary: /usr/bin/python3\n"
        "  Confidence: 80%\n"
        "  Endpoints: api.example.com:443 [L4]\n"
        "  Hits: 1\n\n"
        "  Chunk: rejected-id\n"
        "  Status: rejected\n"
        "  Rule: allow_bad_example_com_443\n"
        "  Binary: /usr/bin/curl\n"
        "  Endpoints: bad.example.com:443 [L4]\n"
        "  Hits: 3\n",
        sandbox_name="demo",
    )

    assert parsed["version"] == 7
    assert parsed["expected_count"] == 3
    assert parsed["counts"] == {"pending": 1, "approved": 1, "rejected": 1}
    assert [rule["id"] for rule in parsed["rules"]] == [
        "pending-id",
        "approved-id",
        "rejected-id",
    ]
    pending = parsed["rules"][0]
    assert pending["status"] == "pending"
    assert pending["rule_name"] == "allow_example_com_443"
    assert pending["confidence"] == 65
    assert pending["endpoints"] == ["example.com:443 [L4]"]
    assert pending["hit_count"] == 2
    assert pending["first_seen"] == "2026-05-29 02:52:18"
    assert pending["last_seen"] == "2026-05-29 05:20:38"


def test_network_rule_parser_handles_no_rules() -> None:
    parsed = _parse_network_rule_list("Network Rules: (version 2, 0 chunks)\n\nNo rules.\n")

    assert parsed["version"] == 2
    assert parsed["expected_count"] == 0
    assert parsed["rules"] == []
    assert parsed["counts"] == {"pending": 0, "approved": 0, "rejected": 0}


def test_get_network_rules_builds_status_command(monkeypatch) -> None:
    calls: list[tuple[str, ...]] = []

    async def fake_run_capture(*cmd: str, timeout_seconds: float, cwd: str | None = None) -> CapturedRun:
        calls.append(cmd)
        return CapturedRun(
            returncode=0,
            stdout="Network Rules: (version 1, 0 chunks)\n",
            stderr="",
            timed_out=False,
        )

    monkeypatch.setattr(nemoclaw, "_which", lambda command: f"/bin/{command}")
    monkeypatch.setattr(nemoclaw, "run_capture", fake_run_capture)

    result = asyncio.run(nemoclaw.get_network_rules("demo-sandbox", status="pending"))

    assert result["error"] is None
    assert calls == [("/bin/openshell", "rule", "get", "--status", "pending", "demo-sandbox")]


def test_network_rule_decision_rejects_unsafe_ids(monkeypatch) -> None:
    monkeypatch.setattr(nemoclaw, "_which", lambda command: f"/bin/{command}")

    result = asyncio.run(
        nemoclaw.decide_network_rule(
            "demo-sandbox",
            "bad;id",
            decision="approve",
        )
    )

    assert result["ok"] is False
    assert result["error"] == "Invalid network rule chunk id"


def test_network_rule_actions_build_expected_commands(monkeypatch) -> None:
    calls: list[tuple[str, ...]] = []

    async def fake_run_capture(*cmd: str, timeout_seconds: float, cwd: str | None = None) -> CapturedRun:
        calls.append(cmd)
        return CapturedRun(returncode=0, stdout="OK", stderr="", timed_out=False)

    monkeypatch.setattr(nemoclaw, "_which", lambda command: f"/bin/{command}")
    monkeypatch.setattr(nemoclaw, "run_capture", fake_run_capture)

    asyncio.run(nemoclaw.decide_network_rule("demo-sandbox", "abc-123", decision="reject"))
    asyncio.run(nemoclaw.approve_all_network_rules("demo-sandbox", include_security_flagged=True))
    asyncio.run(nemoclaw.clear_pending_network_rules("demo-sandbox"))

    assert calls == [
        ("/bin/openshell", "rule", "reject", "demo-sandbox", "--chunk-id", "abc-123"),
        ("/bin/openshell", "rule", "approve-all", "demo-sandbox", "--include-security-flagged"),
        ("/bin/openshell", "rule", "clear", "demo-sandbox"),
    ]
