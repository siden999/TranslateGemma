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
LAUNCHER_LOG = LAUNCHER_DIR / "launcher.log"

if os.name == "nt":
    LAUNCHER_PYTHON = LAUNCHER_DIR / ".venv" / "Scripts" / "python.exe"
    LAUNCHER_BACKGROUND_PYTHON = LAUNCHER_PYTHON
    HOST_MANIFEST_PATH = LAUNCHER_DIR / f"{HOST_NAME}.json"
else:
    LAUNCHER_PYTHON = LAUNCHER_DIR / ".venv" / "bin" / "python"
    LAUNCHER_BACKGROUND_PYTHON = LAUNCHER_PYTHON
    HOST_MANIFEST_PATH = Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "NativeMessagingHosts" / f"{HOST_NAME}.json"
    PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LAUNCH_LABEL}.plist"
    LAUNCH_DOMAIN = f"gui/{os.getuid()}"


def log_line(message: str) -> None:
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    try:
        LAUNCHER_LOG.parent.mkdir(parents=True, exist_ok=True)
        with LAUNCHER_LOG.open("a", encoding="utf-8") as handle:
            handle.write(f"{timestamp} [native-host] {message}\n")
    except Exception:
        pass


def tail_log(max_lines: int = 30) -> str:
    try:
        if not LAUNCHER_LOG.exists():
            return ""
        lines = LAUNCHER_LOG.read_text(encoding="utf-8", errors="ignore").splitlines()
        return "\n".join(lines[-max_lines:])
    except Exception:
        return ""


def configure_binary_stdio() -> None:
    if os.name != "nt":
        return
    try:
        import msvcrt  # pylint: disable=import-error

        binary_mode = getattr(os, "O_BINARY", 0)
        msvcrt.setmode(sys.stdin.fileno(), binary_mode)
        msvcrt.setmode(sys.stdout.fileno(), binary_mode)
    except Exception as exc:
        log_line(f"Failed to enable binary stdio: {exc}")


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
    if os.name == "nt":
        return
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
    python_path = LAUNCHER_BACKGROUND_PYTHON if LAUNCHER_BACKGROUND_PYTHON.exists() else LAUNCHER_PYTHON
    if not python_path.exists():
        python_path = Path(sys.executable)

    kwargs = {
        "cwd": str(LAUNCHER_DIR),
        "stdin": subprocess.DEVNULL,
    }
    if os.name == "nt":
        creationflags = (
            getattr(subprocess, "CREATE_NO_WINDOW", 0)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        )
        kwargs["creationflags"] = creationflags
    else:
        kwargs["start_new_session"] = True

    with LAUNCHER_LOG.open("a", encoding="utf-8") as log_handle:
        subprocess.Popen(
            [str(python_path), str(LAUNCHER_SCRIPT), "--no-tray"],
            stdout=log_handle,
            stderr=log_handle,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
            **kwargs,
        )
    log_line(f"Spawned launcher directly using {python_path}")


def wait_for_launcher(timeout_ms: int, status: str) -> dict:
    deadline = time.time() + (timeout_ms / 1000)
    while time.time() < deadline:
        if check_launcher_status():
            return {
                "ok": True,
                "launched": True,
                "status": status,
                "log_path": str(LAUNCHER_LOG),
                "manifest_path": str(HOST_MANIFEST_PATH),
                "root_dir": str(ROOT_DIR),
            }
        time.sleep(POLL_INTERVAL_MS / 1000)
    return {
        "ok": False,
        "error": "Launcher did not become reachable on 127.0.0.1:18181",
        "log_path": str(LAUNCHER_LOG),
        "launcher_log_tail": tail_log(),
        "manifest_path": str(HOST_MANIFEST_PATH),
        "root_dir": str(ROOT_DIR),
    }


def ensure_launcher(timeout_ms: int) -> dict:
    if check_launcher_status():
        return {
            "ok": True,
            "launched": False,
            "status": "already_running",
            "log_path": str(LAUNCHER_LOG),
            "manifest_path": str(HOST_MANIFEST_PATH),
            "root_dir": str(ROOT_DIR),
        }

    if os.name == "nt":
        start_launcher_directly()
        return wait_for_launcher(timeout_ms, "direct_spawn_started")

    run_launchctl()
    launchctl_result = wait_for_launcher(timeout_ms, "launch_agent_started")
    if launchctl_result.get("ok"):
        return launchctl_result

    start_launcher_directly()
    return wait_for_launcher(timeout_ms, "direct_spawn_started")


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
            "platform": sys.platform,
            "log_path": str(LAUNCHER_LOG),
            "launcher_log_tail": tail_log(),
            "manifest_path": str(HOST_MANIFEST_PATH),
            "root_dir": str(ROOT_DIR),
        }

    return {
        "ok": False,
        "error": f"Unsupported action: {action}",
        "log_path": str(LAUNCHER_LOG),
        "manifest_path": str(HOST_MANIFEST_PATH),
    }


def main() -> None:
    configure_binary_stdio()
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
                "launcher_log_tail": tail_log(),
                "manifest_path": str(HOST_MANIFEST_PATH),
            }
        )
