#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

HOST_NAME = "com.translategemma.launcher"
LAUNCH_LABEL = "com.translategemma.launcher"
CONTROL_URL = "http://127.0.0.1:18181/status"
DEFAULT_TIMEOUT_MS = 15000
POLL_INTERVAL_MS = 500

LAUNCHER_DIR = Path(__file__).resolve().parent
ROOT_DIR = LAUNCHER_DIR.parent
LAUNCHER_SCRIPT = LAUNCHER_DIR / "launcher.py"
LAUNCHER_PYTHON = LAUNCHER_DIR / ".venv" / "bin" / "python"
LAUNCHER_LOG = LAUNCHER_DIR / "launcher.log"
PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LAUNCH_LABEL}.plist"
LAUNCH_DOMAIN = f"gui/{os.getuid()}"


def log_line(message: str) -> None:
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    try:
        with LAUNCHER_LOG.open("a", encoding="utf-8") as handle:
            handle.write(f"{timestamp} [native-host] {message}\n")
    except Exception:
        pass


def read_message() -> dict | None:
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    if len(raw_length) != 4:
        raise RuntimeError("incomplete native message length")
    message_length = struct.unpack("@I", raw_length)[0]
    payload = sys.stdin.buffer.read(message_length)
    if len(payload) != message_length:
        raise RuntimeError("incomplete native message payload")
    return json.loads(payload.decode("utf-8"))


def write_message(payload: dict) -> None:
    data = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def check_launcher_status(timeout: float = 1.0) -> bool:
    try:
        with urlopen(CONTROL_URL, timeout=timeout) as response:
            if response.status != 200:
                return False
            data = json.loads(response.read().decode("utf-8"))
            return isinstance(data, dict)
    except Exception:
        return False


def run_launchctl() -> None:
    if not PLIST.exists():
        log_line(f"LaunchAgent plist not found at {PLIST}")
        return

    commands = [
        ["launchctl", "bootstrap", LAUNCH_DOMAIN, str(PLIST)],
        ["launchctl", "enable", f"{LAUNCH_DOMAIN}/{LAUNCH_LABEL}"],
        ["launchctl", "kickstart", "-k", f"{LAUNCH_DOMAIN}/{LAUNCH_LABEL}"],
    ]

    for command in commands:
        try:
            subprocess.run(
                command,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as exc:
            log_line(f"launchctl command failed: {' '.join(command)} ({exc})")


def start_launcher_directly() -> None:
    python_path = LAUNCHER_PYTHON if LAUNCHER_PYTHON.exists() else Path(sys.executable)
    with LAUNCHER_LOG.open("a", encoding="utf-8") as log_handle:
        subprocess.Popen(
            [str(python_path), str(LAUNCHER_SCRIPT), "--no-tray"],
            cwd=str(LAUNCHER_DIR),
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )
    log_line(f"Spawned launcher directly using {python_path}")


def ensure_launcher(timeout_ms: int) -> dict:
    if check_launcher_status():
        return {
            "ok": True,
            "launched": False,
            "status": "already_running",
            "log_path": str(LAUNCHER_LOG),
        }

    run_launchctl()
    deadline = time.time() + (timeout_ms / 1000)
    while time.time() < deadline:
        if check_launcher_status():
            return {
                "ok": True,
                "launched": True,
                "status": "launch_agent_started",
                "log_path": str(LAUNCHER_LOG),
            }
        time.sleep(POLL_INTERVAL_MS / 1000)

    start_launcher_directly()
    deadline = time.time() + (timeout_ms / 1000)
    while time.time() < deadline:
        if check_launcher_status():
            return {
                "ok": True,
                "launched": True,
                "status": "direct_spawn_started",
                "log_path": str(LAUNCHER_LOG),
            }
        time.sleep(POLL_INTERVAL_MS / 1000)

    return {
        "ok": False,
        "error": "Launcher did not become reachable on 127.0.0.1:18181",
        "log_path": str(LAUNCHER_LOG),
        "plist_path": str(PLIST),
    }


def handle_message(message: dict) -> dict:
    action = str(message.get("action") or "ensure_launcher").lower()
    timeout_ms = int(message.get("timeout_ms") or DEFAULT_TIMEOUT_MS)
    timeout_ms = max(1000, min(timeout_ms, 60000))

    if action in {"ensure_launcher", "ensurelauncher", "launch"}:
        return ensure_launcher(timeout_ms)

    if action == "status":
        return {
            "ok": True,
            "running": check_launcher_status(),
            "log_path": str(LAUNCHER_LOG),
            "plist_path": str(PLIST),
            "root_dir": str(ROOT_DIR),
        }

    return {
        "ok": False,
        "error": f"Unsupported action: {action}",
        "log_path": str(LAUNCHER_LOG),
    }


def main() -> None:
    log_line(f"Native host invoked with argv={sys.argv[1:]}")
    message = read_message()
    if message is None:
        return
    response = handle_message(message)
    write_message(response)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        log_line(f"Native host crashed: {exc}")
        write_message(
            {
                "ok": False,
                "error": str(exc),
                "log_path": str(LAUNCHER_LOG),
            }
        )
