#!/usr/bin/env python3
"""
TranslateGemma Launcher
- 背景啟動翻譯伺服器
- 提供本地控制 API (127.0.0.1:18181)
- 可選托盤控制
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

ROOT_DIR = Path(__file__).resolve().parents[1]
SERVER_DIR = ROOT_DIR / "server"
VENV_DIR = SERVER_DIR / ".venv"
LOG_DIR = SERVER_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "server.log"

CONTROL_PORT = int(os.environ.get("TG_CONTROL_PORT", "18181"))
SERVER_URL = os.environ.get("TG_SERVER_URL", "http://127.0.0.1:8080")
AUTO_START = os.environ.get("TG_AUTO_START", "1") != "0"


class ServerManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._last_error: str | None = None

    def _venv_python(self) -> Path:
        if platform.system() == "Windows":
            return VENV_DIR / "Scripts" / "python.exe"
        return VENV_DIR / "bin" / "python"

    def _system_python(self) -> str:
        for candidate in ("python3", "python"):
            if shutil_which(candidate):
                return candidate
        return sys.executable

    def ensure_venv(self) -> Path:
        venv_python = self._venv_python()
        if venv_python.exists():
            return venv_python

        py = self._system_python()
        try:
            subprocess.check_call([py, "-m", "venv", str(VENV_DIR)])
            subprocess.check_call([str(venv_python), "-m", "pip", "install", "--upgrade", "pip"])
            subprocess.check_call([str(venv_python), "-m", "pip", "install", "-r", str(SERVER_DIR / "requirements.txt")])
        except subprocess.CalledProcessError as exc:
            self._last_error = f"venv setup failed: {exc}"
        if venv_python.exists():
            return venv_python
        return Path(py)

    def start(self) -> dict:
        with self._lock:
            if self._proc and self._proc.poll() is None:
                return self.status()

            venv_python = self.ensure_venv()
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"

            log_file = open(LOG_FILE, "a", encoding="utf-8")
            try:
                self._proc = subprocess.Popen(
                    [str(venv_python), "main.py"],
                    cwd=str(SERVER_DIR),
                    stdout=log_file,
                    stderr=log_file,
                    env=env,
                )
                self._last_error = None
            except Exception as exc:
                self._last_error = str(exc)
            return self.status()

    def stop(self) -> dict:
        with self._lock:
            if not self._proc or self._proc.poll() is not None:
                return self.status()

            self._proc.terminate()
            try:
                self._proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self._proc.kill()
            return self.status()

    def is_running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def health(self) -> bool:
        if not self.is_running():
            return False
        try:
            with urlopen(f"{SERVER_URL}/health", timeout=1.5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("status") == "ok" and data.get("model_loaded") is True
        except Exception:
            return False

    def detect_mode(self) -> str | None:
        if not LOG_FILE.exists():
            return None
        try:
            lines = LOG_FILE.read_text(encoding="utf-8", errors="ignore").splitlines()[-200:]
        except Exception:
            return None
        for line in reversed(lines):
            if "推論模式" in line:
                parts = line.split(":", 1)
                if len(parts) == 2:
                    return parts[1].strip()
        return None

    def status(self) -> dict:
        running = self.is_running()
        return {
            "server_running": running,
            "server_ready": self.health() if running else False,
            "server_pid": self._proc.pid if running and self._proc else None,
            "server_url": SERVER_URL,
            "mode": self.detect_mode(),
            "last_error": self._last_error,
        }


class ControlHandler(BaseHTTPRequestHandler):
    manager: ServerManager | None = None

    def _send_json(self, code: int, payload: dict):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/status":
            if not self.manager:
                self._send_json(500, {"error": "manager missing"})
                return
            self._send_json(200, self.manager.status())
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if not self.manager:
            self._send_json(500, {"error": "manager missing"})
            return
        if self.path == "/start":
            self._send_json(200, self.manager.start())
            return
        if self.path == "/stop":
            self._send_json(200, self.manager.stop())
            return
        self._send_json(404, {"error": "not found"})

    def log_message(self, format, *args):
        return


def shutil_which(cmd: str) -> bool:
    return any(
        os.access(os.path.join(path, cmd), os.X_OK)
        for path in os.environ.get("PATH", "").split(os.pathsep)
    )


def run_control_server(manager: ServerManager) -> ThreadingHTTPServer:
    handler = ControlHandler
    handler.manager = manager
    httpd = ThreadingHTTPServer(("127.0.0.1", CONTROL_PORT), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def load_tray_image():
    try:
        from PIL import Image
    except Exception:
        return None

    icon_path = ROOT_DIR / "extension" / "icons" / "icon128.png"
    if icon_path.exists():
        return Image.open(icon_path)
    return None


def run_tray(manager: ServerManager, httpd: ThreadingHTTPServer):
    try:
        import pystray
    except Exception:
        return False

    image = load_tray_image()
    title = "TranslateGemma"

    def on_start(icon, item):
        manager.start()

    def on_stop(icon, item):
        manager.stop()

    def on_quit(icon, item):
        manager.stop()
        httpd.shutdown()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("Start Server", on_start),
        pystray.MenuItem("Stop Server", on_stop),
        pystray.MenuItem("Quit", on_quit),
    )

    icon = pystray.Icon("TranslateGemma", image, title, menu)
    icon.run()
    return True


def main():
    parser = argparse.ArgumentParser(description="TranslateGemma Launcher")
    parser.add_argument("--no-tray", action="store_true", help="Disable tray UI")
    parser.add_argument("--no-auto-start", action="store_true", help="Do not auto start server")
    args = parser.parse_args()

    manager = ServerManager()
    httpd = run_control_server(manager)

    def _shutdown(signum=None, frame=None):
        manager.stop()
        try:
            httpd.shutdown()
        except Exception:
            pass
        sys.exit(0)

    for sig in (getattr(signal, "SIGINT", None), getattr(signal, "SIGTERM", None)):
        if sig is not None:
            signal.signal(sig, _shutdown)

    if AUTO_START and not args.no_auto_start:
        manager.start()

    if args.no_tray:
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            manager.stop()
            httpd.shutdown()
        return

    tray_ok = run_tray(manager, httpd)
    if not tray_ok:
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            manager.stop()
            httpd.shutdown()


if __name__ == "__main__":
    main()
