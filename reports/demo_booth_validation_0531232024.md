# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-demo-e2e-0530182359`
- Stamp: `0531232024`
- Duration: `34.6s`
- Summary: `6 pass / 0 warn / 0 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| readiness and live stack | PASS | 2.1s |  | Health ok=True failing=[]<br>Readiness summary ok=9 warn=3 fail=0 |
| profile builder and crab visual assignment | PASS | 2.3s |  | Created accessorized lobsters plus a Hermes crab.<br>Assigned lobster+crab visual team. |
| run safety edge cases | PASS | 4.2s |  | Unknown profiles, empty tasks, unassigned requested agents, and empty teams are rejected before starting runs. |
| NemoClaw npm policy toggle and OpenShell rules | PASS | 18.9s |  | Toggled npm with dry-run/apply/restore; this validates a non-Brave preset path. |
| web/deep-research credential guard | PASS | 1.4s |  | BRAVE_API_KEY is missing; booth should use local/no-web research or configure Brave before external research demos. |
| sandbox clear/reset keeps policy rule state separate | PASS | 2.0s |  | Clear completed and profiles could be reassigned; OpenShell network rules remained separately visible. |

## Demo Readiness Interpretation

- PASS means the workflow is booth-ready on the current Spark backend.
- WARN means the app surfaced the truth, but the story needs positioning or setup before a visitor can rely on it.
- FAIL means a hard reliability issue that should be fixed before using that workflow live.

## Operator Notes

- Keep the Relay Check and report-writing workflows as the primary executable demo path.
- Use Hermes crabs visually unless `OFFICE_AGENTS_HERMES_COMMAND` is configured.
- Use OpenShell network rules to explain approve-after-deny behavior; approving a rule enables future retries, not replay.
- Do not promise a shareable website URL unless artifact hosting is implemented or the agent reports a working preview command.

## Detailed Evidence

### readiness and live stack

- Status: `pass`
- Run ID: ``

```json
{
  "health": {
    "components": {
      "llm": {
        "endpoint": "http://10.110.23.141:11434",
        "error": null,
        "kind": "ollama",
        "model": "qwen3.6:35b-a3b",
        "model_loaded": true,
        "reachable": true
      },
      "nemoclaw": {
        "error": null,
        "ok": true,
        "path": "/home/nvidia/.local/bin/nemoclaw"
      },
      "openshell": {
        "error": null,
        "ok": true,
        "path": "/home/nvidia/.local/bin/openshell"
      },
      "sandboxes": {
        "available": true,
        "count": 11,
        "default": "nemoclaw-demo-e2e-0530182359",
        "error": null
      }
    },
    "failing": [],
    "ok": true
  },
  "readiness": "{\"checks\": [{\"data\": {}, \"detail\": \"FastAPI is responding.\", \"id\": \"backend\", \"label\": \"Backend API\", \"status\": \"ok\"}, {\"data\": {}, \"detail\": \"qwen3.6:35b-a3b is reachable.\", \"id\": \"llm\", \"label\": \"Model endpoint\", \"status\": \"ok\"}, {\"data\": {}, \"detail\": \"/home/nvidia/.local/bin/openshell\", \"id\": \"openshell\", \"label\": \"OpenShell CLI\", \"status\": \"ok\"}, {\"data\": {}, \"detail\": \"/home/nvidia/.local/bin/nemoclaw\", \"id\": \"nemoclaw\", \"label\": \"NemoClaw CLI\", \"status\": \"ok\"}, {\"data\": {\"count\": 11, \"default\": \"nemoclaw-demo-e2e-0530182359\"}, \"detail\": \"11 live sandboxes detected.\", \"id\": \"live_sandboxes\", \"label\": \"Live sandboxes\", \"status\": \"ok\"}, {\"data\": {\"healthy\": true}, \"detail\": \"healthy_named\", \"id\": \"gateway\", \"label\": \"OpenShell gateway\", \"status\": \"ok\"}, {\"data\": {\"model\": \"qwen3.6:35b-a3b\", \"provider\": \"compatible-endpoint\"}, \"detail\": \"compatible-endpoint / qwen3.6:35b-a3b\", \"id\": \"inference_route\", \"label\": \"NemoClaw inference route\", \"status\": \"ok\"}, {\"data\": {}, \"detail\": \"13 presets available.\", \"id\": \"policy_list\", \"label\": \"Policy command\", \"status\": \"ok\"}, {\"data\": {\"counts\": {\"approved\": 0, \"pending\": 3, \"rejected\": 0}}, \"detail\": \"3 pending rule recommendations.\", \"id\": \"network_rules\", \"label\": \"OpenShell network rules\", \"status\": \"warn\"}, {\"data\": {}, \"detail\": \"1 model entries reachable.\", \"id\": \"sandbox_inference\", \"label\": \"Sandbox to inference.local\", \"st..."
}
```

### profile builder and crab visual assignment

- Status: `pass`
- Run ID: ``

```json
{
  "assignment": {
    "assignments": {
      "nemoclaw-demo-e2e-0530182359": [
        "Booth Researcher 0531232024",
        "Booth Crab 0531232024"
      ]
    },
    "sandbox_name": "nemoclaw-demo-e2e-0530182359",
    "status": "ok"
  },
  "profiles": [
    {
      "color": "#06b6d4",
      "eyewear": "sunglasses",
      "generated_headwear_kind": "party_hat",
      "headwear": "generated",
      "name": "Booth Researcher 0531232024",
      "role": "researcher",
      "runtime": "openclaw",
      "skills": [],
      "species": "lobster"
    },
    {
      "color": "#8b5cf6",
      "eyewear": "none",
      "generated_headwear_kind": "wizard_hat",
      "headwear": "generated",
      "name": "Booth Writer 0531232024",
      "role": "writer",
      "runtime": "openclaw",
      "skills": [],
      "species": "lobster"
    },
    {
      "color": "#10b981",
      "eyewear": "sunglasses",
      "generated_headwear_kind": "beanie",
      "headwear": "generated",
      "name": "Booth Coder 0531232024",
      "role": "coder",
      "runtime": "openclaw",
      "skills": [
        "coding-agent"
      ],
      "species": "lobster"
    },
    {
      "color": "#f59e0b",
      "eyewear": "none",
      "generated_headwear_kind": "top_hat",
      "headwear": "generated",
      "name": "Booth Critic 0531232024",
      "role": "critic",
      "runtime": "openclaw",
      "skills": [],
      "species": "lobster"
    },
    {
      "color": "#2563eb",
      "eyewear": "none",
      "generated_headwear_kind": "crown",
      "headwear": "generated",
      "name": "Booth Crab 0531232024",
      "role": "planner",
      "runtime": "hermes",
      "skills": [],
      "species": "crab"
    }
  ]
}
```

### run safety edge cases

- Status: `pass`
- Run ID: ``

```json
{
  "empty_task": {
    "body": {
      "detail": "Empty task"
    },
    "code": 400
  },
  "no_assigned_agents": {
    "body": {
      "detail": "No lobsters are assigned to nemoclaw-demo-e2e-0530182359."
    },
    "code": 400
  },
  "unassigned_requested_agent": {
    "body": {
      "detail": "Requested agents are not assigned to this sandbox."
    },
    "code": 400
  },
  "unknown_agent_assignment": {
    "body": {
      "detail": "Unknown lobster profile(s): Definitely Missing Booth Agent"
    },
    "code": 404
  }
}
```

### NemoClaw npm policy toggle and OpenShell rules

- Status: `pass`
- Run ID: ``

```json
{
  "after_enabled": [
    "brave",
    "brew",
    "huggingface",
    "local-inference",
    "pypi"
  ],
  "applied": {
    "dry_run": false,
    "enabled": false,
    "error": null,
    "ok": true,
    "output": "Endpoints that would be removed: registry.npmjs.org, registry.yarnpkg.com\n  Narrowing sandbox egress \u2014 removing: registry.npmjs.org, registry.yarnpkg.com\n  Removed preset: npm",
    "preset": "npm",
    "sandbox_name": "nemoclaw-demo-e2e-0530182359"
  },
  "before_enabled": [
    "brave",
    "brew",
    "huggingface",
    "local-inference",
    "npm",
    "pypi"
  ],
  "dry_run": {
    "dry_run": true,
    "enabled": false,
    "error": null,
    "ok": true,
    "output": "Endpoints that would be removed: registry.npmjs.org, registry.yarnpkg.com\n  --dry-run: no changes applied.",
    "preset": "npm",
    "sandbox_name": "nemoclaw-demo-e2e-0530182359"
  },
  "network_rule_counts": {
    "approved": 0,
    "pending": 3,
    "rejected": 0
  },
  "restored": {
    "dry_run": false,
    "enabled": true,
    "error": null,
    "ok": true,
    "output": "Endpoints that would be opened: registry.npmjs.org, registry.yarnpkg.com\n  Widening sandbox egress \u2014 adding: registry.npmjs.org, registry.yarnpkg.com\n  Applied preset: npm",
    "preset": "npm",
    "sandbox_name": "nemoclaw-demo-e2e-0530182359"
  }
}
```

### web/deep-research credential guard

- Status: `pass`
- Run ID: ``

```json
{
  "readiness": {
    "missing": [
      {
        "message": "brave is enabled, but BRAVE_API_KEY is missing.",
        "name": "BRAVE_API_KEY",
        "policy": "brave",
        "present": false,
        "required": true,
        "status": "missing"
      }
    ]
  },
  "task_guard": "UI should block external web tasks when BRAVE_API_KEY is missing."
}
```

### sandbox clear/reset keeps policy rule state separate

- Status: `pass`
- Run ID: ``

```json
{
  "clear": {
    "archive": "/sandbox/archives/clear-20260531T152054Z",
    "archived_count": 20,
    "cleared": [
      "/sandbox/workspaces",
      "/sandbox/runs"
    ],
    "error": null,
    "ok": true,
    "sandbox_name": "nemoclaw-demo-e2e-0530182359"
  },
  "initial_assign": {
    "assignments": {
      "nemoclaw-demo-e2e-0530182359": [
        "Booth Researcher 0531232024",
        "Booth Writer 0531232024"
      ]
    },
    "sandbox_name": "nemoclaw-demo-e2e-0530182359",
    "status": "ok"
  },
  "network_rule_counts_after_clear": {
    "approved": 0,
    "pending": 3,
    "rejected": 0
  },
  "reassign_after_clear": {
    "assignments": {
      "nemoclaw-demo-e2e-0530182359": [
        "Booth Researcher 0531232024"
      ]
    },
    "sandbox_name": "nemoclaw-demo-e2e-0530182359",
    "status": "ok"
  }
}
```
