#!/usr/bin/env python3
"""End-to-end test for NemoClaw Reef via WebSocket."""

import asyncio
import json
import time
import urllib.request

import websockets


async def e2e_test():
    uri = "ws://127.0.0.1:8001/ws"

    print("=" * 60)
    print("E2E TEST: NemoClaw Reef")
    print("=" * 60)

    # 1. Connect via WebSocket
    print("\n[1] Connecting to WebSocket...")
    async with websockets.connect(uri) as ws:
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        msg = json.loads(raw)
        assert msg["type"] == "full_state", f"Expected full_state, got {msg['type']}"
        agents = msg.get("agents", [])
        print(f"    OK - connected, received full_state with {len(agents)} agents")
        for a in agents:
            print(f"       {a['name']:8s} | {a['state']:12s} | {a['location']}")

        # 2. Send reset
        print("\n[2] Sending reset...")
        await ws.send(json.dumps({"type": "reset"}))
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        msg = json.loads(raw)
        assert msg["type"] == "full_state", f"Expected full_state after reset, got {msg['type']}"
        for a in msg.get("agents", []):
            assert a["location"].startswith("desk_"), f"{a['name']} not at desk: {a['location']}"
        print("    OK - all agents reset to desks")

        # 3. Submit query
        print()
        query = "What are the 3 best hiking trails near San Francisco?"
        print(f'[3] Submitting query: "{query}"')
        t_submit = time.time()
        await ws.send(json.dumps({"type": "query", "query": query}))

        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        msg = json.loads(raw)
        assert msg["type"] == "query_accepted", f"Expected query_accepted, got {msg['type']}"
        t_accepted = time.time()
        print(f"    OK - query accepted in {t_accepted - t_submit:.2f}s")

        # 4. Collect events until whiteboard is written or timeout
        print("\n[4] Watching agent activity (timeout 5 min)...")
        events_by_type: dict[str, int] = {}
        agents_seen_active: set[str] = set()
        search_count = 0
        speak_count = 0
        whiteboard_content = None
        query_cleared = False

        try:
            deadline = time.time() + 300
            while time.time() < deadline:
                raw = await asyncio.wait_for(ws.recv(), timeout=90)
                msg = json.loads(raw)
                mtype = msg.get("type", "?")
                events_by_type[mtype] = events_by_type.get(mtype, 0) + 1

                if mtype == "full_state":
                    # Periodic state snapshot — count active agents
                    fs_agents = msg.get("agents", [])
                    active = [a for a in fs_agents if a.get("state") != "idle"]
                    locs = {a["name"]: a["location"] for a in fs_agents}
                    in_war = sum(1 for l in locs.values() if l == "war_room")
                    if active:
                        names = ", ".join(f"{a['name']}={a['state']}" for a in active)
                        print(f"    [{time.time()-t_submit:5.1f}s]  SYNC     {in_war}/7 in war room, active: {names}")
                    else:
                        print(f"    [{time.time()-t_submit:5.1f}s]  SYNC     {in_war}/7 in war room, all idle")

                elif mtype == "agent_action":
                    agent = msg.get("agent", "?")
                    action = msg.get("action", "?")
                    content = (msg.get("content") or "")[:80]
                    state = msg.get("state", "?")

                    if state not in ("idle",):
                        agents_seen_active.add(agent)

                    if action == "research":
                        search_count += 1
                        print(f"    [{time.time()-t_submit:5.1f}s] {agent:8s} SEARCH: {content}")
                    elif action == "speak":
                        speak_count += 1
                        print(f"    [{time.time()-t_submit:5.1f}s] {agent:8s} SPEAK:  {content}")
                    elif action == "write_whiteboard":
                        whiteboard_content = msg.get("content", "")
                        print(
                            f"    [{time.time()-t_submit:5.1f}s] {agent:8s} WHITEBOARD WRITTEN ({len(whiteboard_content)} chars)"
                        )
                    elif action == "move_to":
                        dest = (msg.get("content") or "")[:30]
                        print(f"    [{time.time()-t_submit:5.1f}s] {agent:8s} MOVE -> {dest}")
                    elif action == "think":
                        print(f"    [{time.time()-t_submit:5.1f}s] {agent:8s} THINK:  {content}")
                    elif action == "idle":
                        pass  # skip idle spam
                    else:
                        print(f"    [{time.time()-t_submit:5.1f}s] {agent:8s} {action:12s} {content}")

                elif mtype == "query_received" and msg.get("query") == "":
                    query_cleared = True
                    print(f"    [{time.time()-t_submit:5.1f}s] === QUERY COMPLETED ===")
                    try:
                        for _ in range(3):
                            await asyncio.wait_for(ws.recv(), timeout=2)
                    except Exception:
                        pass
                    break

        except asyncio.TimeoutError:
            print("    (no events for 90s, stopping)")

        t_done = time.time()
        elapsed = t_done - t_submit

        # 5. Results
        print()
        print("=" * 60)
        print("RESULTS")
        print("=" * 60)
        active_names = ", ".join(sorted(agents_seen_active))
        print(f"  Total time:        {elapsed:.1f}s")
        print(f"  Agents active:     {len(agents_seen_active)} ({active_names})")
        print(f"  Web searches:      {search_count}")
        print(f"  Speak messages:    {speak_count}")
        print(f"  Query completed:   {'YES' if query_cleared else 'NO (timed out)'}")
        print(f"  Whiteboard:        {'YES' if whiteboard_content else 'NO'}")
        print(f"  Events received:   {dict(events_by_type)}")

        if whiteboard_content:
            print()
            print("--- WHITEBOARD CONTENT ---")
            print(whiteboard_content[:1200])
            if len(whiteboard_content) > 1200:
                print(f"... ({len(whiteboard_content)} chars total)")
            print("--- END ---")

        # 6. Assertions
        print()
        print("[5] Assertions...")
        ok = True

        def check(name: str, cond: bool) -> None:
            nonlocal ok
            status = "PASS" if cond else "FAIL"
            if not cond:
                ok = False
            print(f"    [{status}] {name}")

        check("Query was accepted", True)
        check("At least 1 web search performed", search_count >= 1)
        check("Multiple agents were active", len(agents_seen_active) >= 3)
        check("Sam was involved", "Sam" in agents_seen_active)
        check("Maya was involved", "Maya" in agents_seen_active)
        check("Whiteboard was written", whiteboard_content is not None)
        check("Query was marked complete", query_cleared)
        check(
            "Whiteboard has substantial content",
            whiteboard_content is not None and len(whiteboard_content) > 100,
        )
        check("Completed under 5 minutes", elapsed < 300)

        # 7. Verify state via HTTP
        print("\n[6] Verifying final state via HTTP API...")

        state_raw = urllib.request.urlopen("http://127.0.0.1:8001/state").read()
        state_data = json.loads(state_raw)
        check("No active query in state", state_data.get("current_query") is None)

        wb_raw = urllib.request.urlopen("http://127.0.0.1:8001/whiteboard").read()
        wb = json.loads(wb_raw)
        check("Whiteboard endpoint has entries", len(wb.get("entries", [])) > 0)

        agents_raw = urllib.request.urlopen("http://127.0.0.1:8001/agents").read()
        agents_data = json.loads(agents_raw)
        check("All 7 agents present", len(agents_data.get("agents", [])) == 7)

        # 8. Test frontend proxy (nginx)
        print("\n[7] Verifying frontend nginx proxy...")
        try:
            fe_raw = urllib.request.urlopen("http://127.0.0.1:4454/agents").read()
            fe_data = json.loads(fe_raw)
            check("Frontend proxies /agents to backend", len(fe_data.get("agents", [])) == 7)
        except Exception as e:
            check(f"Frontend proxies /agents to backend (error: {e})", False)

        try:
            fe_html = urllib.request.urlopen("http://127.0.0.1:4454/").read().decode()
            check("Frontend serves index.html", "Office" in fe_html)
        except Exception as e:
            check(f"Frontend serves index.html (error: {e})", False)

        print()
        if ok:
            print("ALL TESTS PASSED")
        else:
            print("SOME TESTS FAILED")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(e2e_test())
