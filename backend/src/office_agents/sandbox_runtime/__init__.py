"""NemoClaw sandbox runtime — assignments, task runs, policies.

Import the manager directly from `office_agents.sandbox_runtime.manager`
rather than re-exporting from this package init. `agents.base` imports
`sandbox_runtime.openclaw`, and a top-level re-export of `SandboxManager`
here would trigger a circular import via `manager.py` importing `Agent`.
"""
