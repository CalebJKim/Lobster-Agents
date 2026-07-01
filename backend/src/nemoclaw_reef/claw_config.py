"""OpenClaw profile and NemoClaw workspace configuration."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class ClawIdentity:
    """Runtime identity for one visible lobster/OpenClaw profile."""

    name: str
    claw_id: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass(frozen=True)
class SandboxWorkspace:
    """Configured NemoClaw workspace shown as one physical reef hut."""

    name: str
    home_room: str
    display_name: str
    source: str = "default"

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


CLAW_IDENTITIES: dict[str, ClawIdentity] = {
    "Clawdia": ClawIdentity(
        name="Clawdia",
        claw_id="clawdia-research",
    ),
    "Shelldon": ClawIdentity(
        name="Shelldon",
        claw_id="shelldon-analysis",
    ),
    "Coraline": ClawIdentity(
        name="Coraline",
        claw_id="coraline-review",
    ),
    "Reefus": ClawIdentity(
        name="Reefus",
        claw_id="reefus-plan",
    ),
    "Pearl": ClawIdentity(
        name="Pearl",
        claw_id="pearl-writer",
    ),
    "Snips": ClawIdentity(
        name="Snips",
        claw_id="snips-code",
    ),
    "Captain Claw": ClawIdentity(
        name="Captain Claw",
        claw_id="captain-claw-lead",
    ),
}

# Four shared starter workspaces — lobsters team up in any of them as needed.
# Dynamic workspaces are stored in SQLite and merged with these defaults at
# runtime. Internal names are machine-agnostic; every new demo device must
# create its own live NemoClaw/OpenShell sandboxes with these names.
SANDBOX_WORKSPACES: tuple[SandboxWorkspace, ...] = (
    SandboxWorkspace("nemoclaw-clawdia-reef",    "sandbox_cove", "Coral Cove"),
    SandboxWorkspace("nemoclaw-captain-bridge",  "sandbox_bridge",       "The Bridge"),
    SandboxWorkspace("nemoclaw-pearl-script",    "sandbox_hollow",     "Quill Hollow"),
    SandboxWorkspace("nemoclaw-snips-workbench", "sandbox_bench",      "Workbench"),
)


def get_claw_identity(agent_name: str) -> ClawIdentity | None:
    """Return configured OpenClaw profile metadata for *agent_name*."""

    return CLAW_IDENTITIES.get(agent_name)


def get_sandbox_workspace(sandbox_name: str) -> SandboxWorkspace | None:
    """Return configured NemoClaw workspace metadata for *sandbox_name*."""

    for workspace in SANDBOX_WORKSPACES:
        if workspace.name == sandbox_name:
            return workspace
    return None


def get_home_room_for_sandbox(sandbox_name: str) -> str | None:
    """Return the physical reef room that represents a NemoClaw sandbox."""

    workspace = get_sandbox_workspace(sandbox_name)
    return workspace.home_room if workspace else None


def get_claw_metadata(agent_name: str) -> dict[str, str]:
    """Return JSON-safe OpenClaw profile metadata."""

    identity = get_claw_identity(agent_name)
    if identity:
        return identity.to_dict()

    slug = (
        agent_name.lower()
        .replace(" ", "-")
        .replace("_", "-")
    )
    return {
        "name": agent_name,
        "claw_id": f"{slug}-claw",
    }
