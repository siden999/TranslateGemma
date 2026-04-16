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
MODELS_DIR = SERVER_DIR / "models"
HF_DOWNLOAD_DIR = MODELS_DIR / ".cache" / "huggingface" / "download"
LOG_DIR = SERVER_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "server.log"

STATE_DIR = ROOT_DIR / "state"
RUNTIME_CONFIG_PATH = STATE_DIR / "runtime_config.json"

MODEL_REPO = "mradermacher/translategemma-4b-it-GGUF"
MODEL_VARIANTS = {
    "q4_k_s": {
        "key": "q4_k_s",
        "display_name": "TranslateGemma 4B (Q4_K_S)",
        "parameter_size": "4B",
        "quantization": "Q4_K_S",
        "filename": "translategemma-4b-it.Q4_K_S.gguf",
        "model_id": "translategemma-4b-it-Q4_K_S",
        "repo_id": MODEL_REPO,
        "download_size_bytes": 2_300_000_000,
        "description": "最快，品質略降"
    },
    "q4_k_m": {
        "key": "q4_k_m",
        "display_name": "TranslateGemma 4B (Q4_K_M)",
        "parameter_size": "4B",
        "quantization": "Q4_K_M",
        "filename": "translategemma-4b-it.Q4_K_M.gguf",
        "model_id": "translategemma-4b-it-Q4_K_M",
        "repo_id": MODEL_REPO,
        "download_size_bytes": 2_490_000_000,
        "description": "平衡推薦"
    },
    "q5_k_m": {
        "key": "q5_k_m",
        "display_name": "TranslateGemma 4B (Q5_K_M)",
        "parameter_size": "4B",
        "quantization": "Q5_K_M",
        "filename": "translategemma-4b-it.Q5_K_M.gguf",
        "model_id": "translategemma-4b-it-Q5_K_M",
        "repo_id": MODEL_REPO,
        "download_size_bytes": 2_900_000_000,
        "description": "較高品質"
    },
    "q6_k": {
        "key": "q6_k",
        "display_name": "TranslateGemma 4B (Q6_K)",
        "parameter_size": "4B",
        "quantization": "Q6_K",
        "filename": "translategemma-4b-it.Q6_K.gguf",
        "model_id": "translategemma-4b-it-Q6_K",
        "repo_id": MODEL_REPO,
        "download_size_bytes": 3_190_000_000,
        "description": "品質最高，較慢"
    },
}

CONTROL_PORT = int(os.environ.get("TG_CONTROL_PORT", "18181"))
SERVER_URL = os.environ.get("TG_SERVER_URL", "http://127.0.0.1:8080")
AUTO_START = os.environ.get("TG_AUTO_START", "0") != "0"

DEFAULT_RUNTIME_CONFIG = {
    "model_key": "q4_k_m",
    "n_ctx": 2048,
    "n_gpu_layers": -1,
    "n_threads": 0,
    "n_batch": 512,
}

APP_STATE: dict[str, object] = {}


def shutil_which(cmd: str) -> bool:
    return any(
        os.access(os.path.join(path, cmd), os.X_OK)
        for path in os.environ.get("PATH", "").split(os.pathsep)
    )


def clamp_int(value, default: int, minimum: int, maximum: int) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, normalized))


def backend_hint() -> str:
    if platform.system() == "Darwin":
        return "Metal"
    if platform.system() == "Windows":
        return "CUDA / CPU"
    return "CPU"


class ServerManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._log_handle = None
        self._last_error: str | None = None

    def _cleanup_exited_process(self) -> None:
        if self._proc and self._proc.poll() is not None:
            self._proc = None
            if self._log_handle:
                try:
                    self._log_handle.close()
                except Exception:
                    pass
                self._log_handle = None

    def _venv_python(self) -> Path:
        if platform.system() == "Windows":
            return VENV_DIR / "Scripts" / "python.exe"
        return VENV_DIR / "bin" / "python"

    def _system_python(self) -> str:
        if sys.executable and Path(sys.executable).exists():
            return sys.executable
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

    def _load_runtime_config(self) -> dict:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        data = {}
        if RUNTIME_CONFIG_PATH.exists():
            try:
                data = json.loads(RUNTIME_CONFIG_PATH.read_text(encoding="utf-8"))
            except Exception:
                data = {}
        config = dict(DEFAULT_RUNTIME_CONFIG)
        if isinstance(data, dict):
            config.update(data)

        max_threads = max(os.cpu_count() or 8, 1)
        model_key = str(config.get("model_key", DEFAULT_RUNTIME_CONFIG["model_key"])).lower()
        if model_key not in MODEL_VARIANTS:
            model_key = DEFAULT_RUNTIME_CONFIG["model_key"]

        normalized = {
            "model_key": model_key,
            "n_ctx": clamp_int(config.get("n_ctx"), DEFAULT_RUNTIME_CONFIG["n_ctx"], 512, 8192),
            "n_gpu_layers": clamp_int(config.get("n_gpu_layers"), DEFAULT_RUNTIME_CONFIG["n_gpu_layers"], -1, 999),
            "n_threads": clamp_int(config.get("n_threads"), DEFAULT_RUNTIME_CONFIG["n_threads"], 0, max_threads),
            "n_batch": clamp_int(config.get("n_batch"), DEFAULT_RUNTIME_CONFIG["n_batch"], 64, 2048),
        }
        normalized["n_batch"] = min(normalized["n_batch"], normalized["n_ctx"])

        try:
            RUNTIME_CONFIG_PATH.write_text(
                json.dumps(normalized, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass
        return normalized

    def _save_runtime_config(self, updates: dict | None) -> dict:
        config = self._load_runtime_config()
        if isinstance(updates, dict):
            config.update(updates)
        try:
            RUNTIME_CONFIG_PATH.write_text(
                json.dumps(config, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as exc:
            self._last_error = f"save config failed: {exc}"
        return self._load_runtime_config()

    def _selected_model(self, runtime_config: dict | None = None) -> dict:
        runtime = runtime_config or self._load_runtime_config()
        return dict(MODEL_VARIANTS[runtime["model_key"]])

    def _runtime_env(self, runtime_config: dict) -> dict:
        model = self._selected_model(runtime_config)
        return {
            "TG_MODEL_REPO": model["repo_id"],
            "TG_MODEL_FILENAME": model["filename"],
            "TG_MODEL_ID": model["model_id"],
            "TG_N_CTX": str(runtime_config["n_ctx"]),
            "TG_N_GPU_LAYERS": str(runtime_config["n_gpu_layers"]),
            "TG_N_THREADS": str(runtime_config["n_threads"]),
            "TG_N_BATCH": str(runtime_config["n_batch"]),
        }

    def _model_path(self, runtime_config: dict | None = None) -> Path:
        model = self._selected_model(runtime_config)
        return MODELS_DIR / model["filename"]

    def _largest_incomplete_download(self) -> Path | None:
        if not HF_DOWNLOAD_DIR.exists():
            return None
        try:
            candidates = sorted(
                HF_DOWNLOAD_DIR.glob("*.incomplete"),
                key=lambda path: path.stat().st_size,
                reverse=True,
            )
        except OSError:
            return None
        return candidates[0] if candidates else None

    def _available_models(self, runtime_config: dict | None = None) -> list[dict]:
        runtime = runtime_config or self._load_runtime_config()
        selected_key = runtime["model_key"]
        models = []
        for key, model in MODEL_VARIANTS.items():
            model_path = MODELS_DIR / model["filename"]
            installed = model_path.exists()
            models.append({
                **model,
                "selected": key == selected_key,
                "installed": installed,
                "installed_bytes": model_path.stat().st_size if installed else 0,
            })
        return models

    def start(self) -> dict:
        with self._lock:
            self._cleanup_exited_process()
            if self._proc and self._proc.poll() is None:
                return self.status()

            runtime_config = self._load_runtime_config()
            venv_python = self.ensure_venv()
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            env.update(self._runtime_env(runtime_config))

            self._log_handle = open(LOG_FILE, "a", encoding="utf-8")
            try:
                self._proc = subprocess.Popen(
                    [str(venv_python), "main.py"],
                    cwd=str(SERVER_DIR),
                    stdout=self._log_handle,
                    stderr=self._log_handle,
                    env=env,
                )
                self._last_error = None
            except Exception as exc:
                self._last_error = str(exc)
                self._proc = None
            return self.status()

    def stop(self) -> dict:
        with self._lock:
            self._cleanup_exited_process()
            if not self._proc:
                return self.status()

            self._proc.terminate()
            try:
                self._proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self._proc.kill()
            self._cleanup_exited_process()
            return self.status()

    def restart(self) -> dict:
        self.stop()
        return self.start()

    def update_runtime(self, payload: dict) -> dict:
        with self._lock:
            restart_if_running = bool(payload.get("restart_if_running", False))
            updates = {
                "model_key": payload.get("model_key"),
                "n_ctx": payload.get("n_ctx"),
                "n_gpu_layers": payload.get("n_gpu_layers"),
                "n_threads": payload.get("n_threads"),
                "n_batch": payload.get("n_batch"),
            }
            self._save_runtime_config(updates)
            if restart_if_running and self.is_running():
                self.stop()
                self.start()
            return self.status()

    def delete_model(self, model_key: str | None = None) -> dict:
        with self._lock:
            runtime = self._load_runtime_config()
            target_key = str(model_key or runtime["model_key"]).lower()
            if target_key not in MODEL_VARIANTS:
                self._last_error = f"unknown model key: {target_key}"
                return self.status()

            if self.is_running() and runtime["model_key"] == target_key:
                self.stop()

            model = MODEL_VARIANTS[target_key]
            model_path = MODELS_DIR / model["filename"]
            try:
                if model_path.exists():
                    model_path.unlink()
                self._last_error = None
            except Exception as exc:
                self._last_error = f"delete model failed: {exc}"
            return self.status()

    def is_running(self) -> bool:
        self._cleanup_exited_process()
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

    def startup_status(self, runtime_config: dict, running: bool, ready: bool) -> dict:
        model = self._selected_model(runtime_config)
        model_path = MODELS_DIR / model["filename"]
        incomplete_path = self._largest_incomplete_download()
        total_bytes = int(model.get("download_size_bytes") or 0)
        model_exists = model_path.exists()
        downloaded_bytes = 0
        if model_exists:
            downloaded_bytes = model_path.stat().st_size
        elif incomplete_path is not None:
            downloaded_bytes = incomplete_path.stat().st_size

        progress_percent = None
        if downloaded_bytes > 0 and total_bytes > 0:
            ratio = downloaded_bytes / total_bytes
            progress_percent = int(ratio * 100)
            if model_exists:
                progress_percent = 100
            else:
                progress_percent = min(progress_percent, 99)

        if ready:
            phase = "ready"
            message = "模型已載入，可開始翻譯"
        elif running and incomplete_path is not None:
            phase = "downloading"
            message = "首次啟動正在下載模型，可能需要幾分鐘"
        elif running and model_exists:
            phase = "loading"
            message = "模型下載完成，正在載入到記憶體"
        elif running:
            phase = "starting"
            message = "正在準備模型啟動環境"
        elif model_exists:
            phase = "stopped"
            message = "模型已下載，按下啟動即可使用"
        else:
            phase = "stopped"
            message = "首次啟動需下載模型，請保持網路連線"

        return {
            "phase": phase,
            "message": message,
            "model_exists": model_exists,
            "first_run_required": not model_exists,
            "downloaded_bytes": downloaded_bytes,
            "total_bytes": total_bytes,
            "progress_percent": progress_percent,
        }

    def status(self) -> dict:
        runtime = self._load_runtime_config()
        model = self._selected_model(runtime)
        running = self.is_running()
        ready = self.health() if running else False
        active_mode = self.detect_mode()
        return {
            "server_running": running,
            "server_ready": ready,
            "server_pid": self._proc.pid if running and self._proc else None,
            "server_url": SERVER_URL,
            "mode": active_mode,
            "last_error": self._last_error,
            "model": model,
            "models": self._available_models(runtime),
            "runtime": {
                "config": runtime,
                "backend_hint": backend_hint(),
                "active_mode": active_mode,
                "config_path": str(RUNTIME_CONFIG_PATH),
            },
            "startup": self.startup_status(runtime, running, ready),
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

    def _read_json(self) -> dict:
        try:
            content_length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            content_length = 0
        if content_length <= 0:
            return {}
        raw = self.rfile.read(content_length)
        if not raw:
            return {}
        try:
            payload = json.loads(raw.decode("utf-8"))
            return payload if isinstance(payload, dict) else {}
        except Exception:
            return {}

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
        payload = self._read_json()
        if self.path == "/start":
            self._send_json(200, self.manager.start())
            return
        if self.path == "/stop":
            self._send_json(200, self.manager.stop())
            return
        if self.path == "/restart":
            self._send_json(200, self.manager.restart())
            return
        if self.path == "/runtime_config":
            self._send_json(200, self.manager.update_runtime(payload))
            return
        if self.path == "/delete_model":
            self._send_json(200, self.manager.delete_model(payload.get("model_key")))
            return
        if self.path == "/quit":
            self._send_json(200, {"ok": True})
            threading.Thread(target=shutdown_app, daemon=True).start()
            return
        self._send_json(404, {"error": "not found"})

    def log_message(self, format, *args):
        return


def run_control_server(manager: ServerManager) -> ThreadingHTTPServer:
    handler = ControlHandler
    handler.manager = manager
    httpd = ThreadingHTTPServer(("127.0.0.1", CONTROL_PORT), handler)
    APP_STATE["manager"] = manager
    APP_STATE["httpd"] = httpd
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


def shutdown_app():
    manager = APP_STATE.get("manager")
    httpd = APP_STATE.get("httpd")
    if isinstance(manager, ServerManager):
        manager.stop()
    if isinstance(httpd, ThreadingHTTPServer):
        try:
            httpd.shutdown()
        except Exception:
            pass
    os._exit(0)


def main():
    parser = argparse.ArgumentParser(description="TranslateGemma Launcher")
    parser.add_argument("--tray", action="store_true", help="Enable tray UI")
    parser.add_argument("--no-tray", action="store_true", help="Disable tray UI")
    parser.add_argument("--no-auto-start", action="store_true", help="Do not auto start server")
    args = parser.parse_args()

    manager = ServerManager()
    httpd = run_control_server(manager)

    def _shutdown(signum=None, frame=None):
        shutdown_app()

    for sig in (getattr(signal, "SIGINT", None), getattr(signal, "SIGTERM", None)):
        if sig is not None:
            signal.signal(sig, _shutdown)

    if AUTO_START and not args.no_auto_start:
        manager.start()

    use_tray_env = os.environ.get("TG_TRAY", "0") == "1"
    use_tray = args.tray or use_tray_env
    if args.no_tray:
        use_tray = False

    if not use_tray:
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
