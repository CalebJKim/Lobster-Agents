#!/usr/bin/env python3
"""Bridge a host-loopback OpenAI-compatible server onto a Docker bridge IP."""

from __future__ import annotations

import argparse
import asyncio


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def _handle(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
    *,
    upstream_host: str,
    upstream_port: int,
) -> None:
    try:
        upstream_reader, upstream_writer = await asyncio.open_connection(
            upstream_host,
            upstream_port,
        )
    except Exception:
        client_writer.close()
        await client_writer.wait_closed()
        return

    await asyncio.gather(
        _pipe(client_reader, upstream_writer),
        _pipe(upstream_reader, client_writer),
    )


async def _main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind-host", default="172.18.0.1")
    parser.add_argument("--bind-port", type=int, default=8000)
    parser.add_argument("--upstream-host", default="127.0.0.1")
    parser.add_argument("--upstream-port", type=int, default=8000)
    args = parser.parse_args()

    server = await asyncio.start_server(
        lambda reader, writer: _handle(
            reader,
            writer,
            upstream_host=args.upstream_host,
            upstream_port=args.upstream_port,
        ),
        args.bind_host,
        args.bind_port,
        reuse_address=True,
    )
    sockets = ", ".join(str(sock.getsockname()) for sock in server.sockets or [])
    print(
        f"vLLM bridge listening on {sockets}; "
        f"forwarding to {args.upstream_host}:{args.upstream_port}",
        flush=True,
    )
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(_main())
