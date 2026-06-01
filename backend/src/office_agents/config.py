import json
from typing import Annotated, Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o"
    llm_api_key: str = ""
    nemoclaw_provider: str = "custom"
    nemoclaw_endpoint_url: str = ""
    nemoclaw_model: str = ""
    nemoclaw_api_key: str = ""
    tick_interval: float = 4.0
    db_path: str = "office_agents.db"
    allowed_file_paths: Annotated[list[str], NoDecode] = []
    tavily_api_key: str = ""

    # Path where the live-editable water-cooler topics file is found.
    # Override via OFFICE_AGENTS_WATER_COOLER_TOPICS_PATH on demo hosts.
    water_cooler_topics_path: str = (
        "/home/nvidia/documents/demo-files/water-cooler-topics.md"
    )

    # Reef chat tuning.
    # When the LLM times out / is unreachable, fall back to templated
    # narration so the canvas keeps moving instead of going silent.
    reef_fallback_on_outage: bool = True
    # Per-call timeout for reef chat — generous because the 35B model on
    # Local demo models can warm up slowly on first call.
    reef_chat_timeout: float = 180.0

    # Per-sandbox filesystem layout managed by openshell. These match the
    # NemoClaw/OpenShell host layout; override for local-dev environments.
    sandbox_workspaces_dir: str = "/sandbox/workspaces"
    sandbox_runs_dir: str = "/sandbox/runs"
    # OpenClaw turn timeout for NemoClaw relay runs. Match OpenClaw's CLI
    # default and leave enough room for first-token stalls on demo hardware.
    openclaw_turn_timeout_seconds: int = 600
    # Keep demo relay turns compatible with local vLLM routes. Some routes
    # only advertise `off`; hosts can opt into deeper thinking explicitly.
    openclaw_thinking_level: str = "off"
    # The current GB300 vLLM server is not launched with OpenAI tool-call
    # parsing flags, so OpenClaw must not send model-facing tool schemas.
    openclaw_model_tools_enabled: bool = False
    # Profile preparation installs/filters skills before a turn starts.
    openclaw_profile_timeout_seconds: int = 120
    # Limit concurrent OpenClaw team runs across all sandboxes. Spark-class
    # demo hosts are most reliable at 1; GB300/vLLM deployments can raise this.
    sandbox_max_concurrent_openclaw_runs: int = 1
    # Keep the reef map focused on configured app workspaces. Live-only
    # NemoClaw sandboxes can exist on the host without appearing in the UI.
    show_unregistered_live_sandboxes: bool = False

    # Optional Hermes runner for crab agents. The command is executed inside
    # the OpenShell sandbox with HERMES_TASK, HERMES_AGENT_NAME, HERMES_ROLE,
    # and HERMES_PERSONALITY in the environment. Leave empty to surface an
    # honest hermes_not_configured diagnostic.
    hermes_command: str = ""
    hermes_timeout_seconds: int = 300

    # Extra directories searched by sandbox_runtime._which() when nemoclaw /
    # openshell aren't on PATH. Defaults cover the common NVIDIA demo layout.
    extra_bin_paths: Annotated[list[str], NoDecode] = [
        "/home/nvidia/.local/bin",
        "/usr/local/bin",
    ]

    @field_validator("allowed_file_paths", "extra_bin_paths", mode="before")
    @classmethod
    def parse_path_list(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        text = value.strip()
        if not text:
            return []
        if text.startswith("["):
            return json.loads(text)
        return [part.strip() for part in text.split(",") if part.strip()]

    @field_validator("openclaw_thinking_level", mode="before")
    @classmethod
    def normalize_openclaw_thinking_level(cls, value: Any) -> str:
        allowed = {"off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max"}
        if not isinstance(value, str):
            return "off"
        normalized = value.strip().lower()
        return normalized if normalized in allowed else "off"

    model_config = {
        "env_prefix": "OFFICE_AGENTS_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }


settings = Settings()
