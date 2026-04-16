"""
TranslateGemma 翻譯器模組

負責載入 GGUF 模型並提供翻譯功能
首次執行時會自動下載模型
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math
import os
from pathlib import Path
import platform
import re
import sqlite3
import threading
import time
from typing import Optional

from huggingface_hub import hf_hub_download
from llama_cpp import Llama


DEFAULT_MODEL_REPO = "mradermacher/translategemma-4b-it-GGUF"
DEFAULT_MODEL_FILENAME = "translategemma-4b-it.Q4_K_M.gguf"
DEFAULT_MODEL_ID = "translategemma-4b-it-Q4_K_M"
MODELS_DIR = Path(__file__).parent / "models"
CACHE_DIR = Path(__file__).parent / "cache"
CACHE_DB = CACHE_DIR / "translation_cache.sqlite3"

LANGUAGE_CODES = {
    "auto": "Auto-detect",
    "en": "English",
    "zh": "Chinese",
    "zh-TW": "Traditional Chinese",
    "zh-CN": "Simplified Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "ar": "Arabic",
    "th": "Thai",
    "vi": "Vietnamese",
}

FILENAME_PATTERN = r"\b[\w./-]+\.(?:py|js|ts|tsx|jsx|json|md|rst|txt|sh|bash|zsh|css|html|xml|yaml|yml|toml|ini|cfg|lock|sql|csv)\b"
PATH_PATTERN = r"\b(?:[\w.-]+/)+[\w./-]+\b"
TOKEN_PATTERNS = [
    re.compile(r"`[^`\n]+`"),
    re.compile(r"https?://\S+"),
    re.compile(FILENAME_PATTERN),
    re.compile(PATH_PATTERN),
    re.compile(r"\$[A-Z_][A-Z0-9_]*"),
    re.compile(r"--[a-zA-Z0-9][\w-]*"),
]


@dataclass(frozen=True)
class TranslationOptions:
    source_lang: str = "auto"
    target_lang: str = "zh-TW"
    site: str = "generic"
    content_type: str = "text"
    translation_mode: str = "balanced"
    preserve_formatting: bool = False
    glossary: tuple[tuple[str, str], ...] = ()


class TranslationCache:
    def __init__(self, db_path: Path, model_id: str) -> None:
        self.db_path = db_path
        self.model_id = model_id
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS translations (
                cache_key TEXT PRIMARY KEY,
                model_id TEXT NOT NULL,
                source_lang TEXT NOT NULL,
                target_lang TEXT NOT NULL,
                site TEXT NOT NULL,
                content_type TEXT NOT NULL,
                translation_mode TEXT NOT NULL,
                text_hash TEXT NOT NULL,
                text TEXT NOT NULL,
                translation TEXT NOT NULL,
                created_at REAL NOT NULL,
                last_hit_at REAL NOT NULL,
                hit_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        self._conn.commit()

    def _cache_key(self, text: str, options: TranslationOptions) -> str:
        payload = "\n".join([
            self.model_id,
            options.source_lang,
            options.target_lang,
            options.site,
            options.content_type,
            options.translation_mode,
            "1" if options.preserve_formatting else "0",
            repr(options.glossary),
            text,
        ])
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def get(self, text: str, options: TranslationOptions) -> str | None:
        cache_key = self._cache_key(text, options)
        with self._lock:
            row = self._conn.execute(
                "SELECT translation FROM translations WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
            if not row:
                return None
            self._conn.execute(
                "UPDATE translations SET hit_count = hit_count + 1, last_hit_at = ? WHERE cache_key = ?",
                (time.time(), cache_key),
            )
            self._conn.commit()
        return str(row[0])

    def set(self, text: str, translation: str, options: TranslationOptions) -> None:
        cache_key = self._cache_key(text, options)
        now = time.time()
        with self._lock:
            self._conn.execute(
                """
                INSERT OR REPLACE INTO translations (
                    cache_key, model_id, source_lang, target_lang, site, content_type,
                    translation_mode, text_hash, text, translation, created_at, last_hit_at, hit_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(
                    (SELECT hit_count FROM translations WHERE cache_key = ?), 0
                ))
                """,
                (
                    cache_key,
                    self.model_id,
                    options.source_lang,
                    options.target_lang,
                    options.site,
                    options.content_type,
                    options.translation_mode,
                    hashlib.sha256(text.encode("utf-8")).hexdigest(),
                    text,
                    translation,
                    now,
                    now,
                    cache_key,
                ),
            )
            self._conn.commit()

    def stats(self) -> dict:
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(hit_count), 0) FROM translations"
            ).fetchone()
        return {
            "entries": int(row[0] or 0),
            "hits": int(row[1] or 0),
            "db_size_bytes": self.db_path.stat().st_size if self.db_path.exists() else 0,
        }

    def clear(self) -> dict:
        with self._lock:
            self._conn.execute("DELETE FROM translations")
            self._conn.commit()
        return self.stats()


class TranslateGemmaTranslator:
    """TranslateGemma 翻譯器"""

    def __init__(
        self,
        model_repo: str | None = None,
        model_filename: str | None = None,
        model_id: str | None = None,
        n_ctx: int | None = None,
        n_gpu_layers: int | None = None,
        n_threads: int | None = None,
        n_batch: int | None = None,
    ):
        self.model_repo = model_repo or os.environ.get("TG_MODEL_REPO", DEFAULT_MODEL_REPO)
        self.model_filename = model_filename or os.environ.get("TG_MODEL_FILENAME", DEFAULT_MODEL_FILENAME)
        self.model_id = model_id or os.environ.get("TG_MODEL_ID", DEFAULT_MODEL_ID)
        self.model: Optional[Llama] = None
        self.is_loaded = False
        self.n_ctx = int(n_ctx if n_ctx is not None else os.environ.get("TG_N_CTX", "2048"))
        self.n_gpu_layers = int(n_gpu_layers if n_gpu_layers is not None else os.environ.get("TG_N_GPU_LAYERS", "-1"))
        self.n_threads = int(n_threads if n_threads is not None else os.environ.get("TG_N_THREADS", "0"))
        self.n_batch = int(n_batch if n_batch is not None else os.environ.get("TG_N_BATCH", "512"))
        self.cache = TranslationCache(CACHE_DB, model_id=self.model_id)

        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        self._load_model()

    def _site_instructions(self, options: TranslationOptions) -> str:
        instructions = {
            "youtube": "Keep the tone natural and spoken. For subtitles, prefer short readable phrasing.",
            "article": "Use polished article-style translation and keep the meaning precise.",
            "wikipedia": "Use a neutral encyclopedic tone. Preserve named entities and section meaning.",
            "github": "Preserve Markdown meaning, inline code, commands, file paths, and technical terminology.",
            "reddit": "Preserve informal tone, slang, and emphasis without over-formalizing.",
            "selection": "Return a concise direct translation suitable for a quick popup.",
            "generic": "Keep the translation faithful and readable.",
        }
        content_notes = {
            "title": "Make the translation compact and headline-friendly.",
            "heading": "Keep the structure concise like a heading.",
            "subtitle": "Keep it short enough to read quickly on screen.",
            "comment": "Preserve conversational tone and punctuation.",
            "list": "Preserve list-item brevity and structure.",
            "paragraph": "Preserve full meaning and sentence flow.",
            "selection": "Keep the result concise and direct.",
        }
        parts = [instructions.get(options.site, instructions["generic"])]
        note = content_notes.get(options.content_type)
        if note:
            parts.append(note)
        return " ".join(parts)

    def _mode_instruction(self, options: TranslationOptions) -> str:
        if options.translation_mode == "speed":
            return "Prioritize literal and fast translation. Avoid stylistic rewrites."
        if options.translation_mode == "quality":
            return "Prioritize fidelity, nuance, tone, and natural target-language phrasing."
        return "Balance speed, clarity, and natural phrasing."

    def _language_instruction(self, options: TranslationOptions) -> str:
        source_name = LANGUAGE_CODES.get(options.source_lang, options.source_lang)
        target_name = LANGUAGE_CODES.get(options.target_lang, options.target_lang)
        if options.source_lang == "auto":
            return f"Detect the source language automatically and translate into {target_name}."
        return f"Translate from {source_name} to {target_name}."

    def _glossary_instruction(self, options: TranslationOptions) -> str:
        if not options.glossary:
            return ""
        items = [f"{src} -> {dst}" for src, dst in options.glossary]
        return "Preferred terminology: " + "; ".join(items) + "."

    def _formatting_instruction(self, options: TranslationOptions) -> str:
        if options.preserve_formatting or options.site == "github":
            return "Preserve formatting, placeholders, technical tokens, and any protected text exactly."
        return "Do not add explanations or extra commentary."

    def _build_prompt(self, text: str, options: TranslationOptions) -> str:
        return f"""<start_of_turn>user
You are a translation engine. Return only the translated text.
{self._language_instruction(options)}
{self._mode_instruction(options)}
{self._site_instructions(options)}
{self._formatting_instruction(options)}
{self._glossary_instruction(options)}

Text:
{text}<end_of_turn>
<start_of_turn>model
"""

    def _batch_token_cap(self, texts: list[str], options: TranslationOptions) -> int:
        estimated = sum(self._max_output_tokens(text, options) for text in texts) + (32 * len(texts))
        return min(max(256, estimated), max(384, min(self.n_ctx, 1536)))

    def _build_batch_prompt(self, texts: list[str], options: TranslationOptions) -> str:
        examples = []
        items = []
        for index, text in enumerate(texts):
            examples.append(
                f"<<<TG_OUTPUT_{index}>>>\ntranslation {index + 1}\n<<<TG_END_OUTPUT_{index}>>>"
            )
            items.append(
                f"<<<TG_INPUT_{index}>>>\n{text}\n<<<TG_END_INPUT_{index}>>>"
            )

        return f"""<start_of_turn>user
You are a translation engine. Translate every item and return only translated items.
{self._language_instruction(options)}
{self._mode_instruction(options)}
{self._site_instructions(options)}
{self._formatting_instruction(options)}
{self._glossary_instruction(options)}
Return the result using the exact wrappers shown below, with one block for every input item and no extra commentary.

Output format:
{chr(10).join(examples)}

Items:
{chr(10).join(items)}<end_of_turn>
<start_of_turn>model
"""

    def _max_output_tokens(self, text: str, options: TranslationOptions) -> int:
        char_count = len(text)
        base = min(768, max(96, math.ceil(char_count * 0.75)))
        if options.translation_mode == "quality":
            return min(1024, base + 80)
        if options.content_type == "subtitle":
            return min(192, base)
        if options.content_type in {"title", "heading", "selection"}:
            return min(256, base)
        return base

    def _normalize_glossary(self, glossary: list[str] | tuple[str, ...] | None) -> tuple[tuple[str, str], ...]:
        if not glossary:
            return ()
        pairs: list[tuple[str, str]] = []
        for item in glossary:
            line = str(item).strip()
            if not line:
                continue
            if "=" in line:
                source, target = line.split("=", 1)
            elif "->" in line:
                source, target = line.split("->", 1)
            else:
                continue
            source = source.strip()
            target = target.strip()
            if source and target:
                pairs.append((source, target))
        return tuple(pairs)

    def _build_options(
        self,
        source_lang: str,
        target_lang: str,
        site: str,
        content_type: str,
        translation_mode: str,
        preserve_formatting: bool,
        glossary: list[str] | tuple[str, ...] | None,
    ) -> TranslationOptions:
        normalized_mode = translation_mode if translation_mode in {"speed", "balanced", "quality"} else "balanced"
        return TranslationOptions(
            source_lang=source_lang or "auto",
            target_lang=target_lang or "zh-TW",
            site=(site or "generic").lower(),
            content_type=(content_type or "text").lower(),
            translation_mode=normalized_mode,
            preserve_formatting=preserve_formatting,
            glossary=self._normalize_glossary(glossary),
        )

    def _preserve_tokens(self, text: str, options: TranslationOptions) -> tuple[str, list[tuple[str, str]]]:
        if not (options.preserve_formatting or options.site == "github"):
            return text, []

        placeholders: list[tuple[str, str]] = []
        protected = text

        def replacer(match: re.Match[str]) -> str:
            token = f"<TGKEEP{len(placeholders)}>"
            placeholders.append((token, match.group(0)))
            return token

        for pattern in TOKEN_PATTERNS:
            protected = pattern.sub(replacer, protected)
        return protected, placeholders

    def _restore_tokens(self, text: str, placeholders: list[tuple[str, str]]) -> str:
        restored = text
        for token, original in placeholders:
            restored = restored.replace(token, original)
        return restored

    def _run_inference(self, prompt: str, max_tokens: int) -> str:
        if not self.model:
            raise RuntimeError("模型尚未載入")
        response = self.model(
            prompt,
            max_tokens=max_tokens,
            stop=["<end_of_turn>", "<eos>"],
            temperature=0,
            echo=False,
        )
        return response["choices"][0]["text"].strip()

    def _should_use_group_batch(self, texts: list[str], options: TranslationOptions) -> bool:
        if len(texts) < 2:
            return False
        total_chars = sum(len(text) for text in texts)
        longest = max(len(text) for text in texts)
        if longest > 1200:
            return False
        if total_chars > 2600:
            return False
        if options.translation_mode == "quality" and total_chars > 1800:
            return False
        return True

    def _parse_batch_output(self, output: str, expected_count: int) -> list[str] | None:
        results = []
        for index in range(expected_count):
            start_tag = f"<<<TG_OUTPUT_{index}>>>"
            end_tag = f"<<<TG_END_OUTPUT_{index}>>>"
            match = re.search(
                rf"{re.escape(start_tag)}\s*(.*?)\s*{re.escape(end_tag)}",
                output,
                flags=re.DOTALL,
            )
            if not match:
                return None
            results.append(match.group(1).strip())
        return results

    def _translate_uncached_single(self, text: str, options: TranslationOptions) -> str:
        protected_text, placeholders = self._preserve_tokens(text, options)
        prompt = self._build_prompt(protected_text, options)
        translation = self._run_inference(prompt, self._max_output_tokens(text, options))
        return self._restore_tokens(translation, placeholders)

    def _translate_uncached_group(self, texts: list[str], options: TranslationOptions) -> list[str]:
        protected_payloads = []
        placeholder_groups = []
        for text in texts:
            protected_text, placeholders = self._preserve_tokens(text, options)
            protected_payloads.append(protected_text)
            placeholder_groups.append(placeholders)

        prompt = self._build_batch_prompt(protected_payloads, options)
        output = self._run_inference(prompt, self._batch_token_cap(texts, options))
        parsed = self._parse_batch_output(output, len(texts))
        if not parsed:
            raise ValueError("batch output parse failed")

        return [
            self._restore_tokens(translation, placeholders)
            for translation, placeholders in zip(parsed, placeholder_groups)
        ]

    def cache_stats(self) -> dict:
        return self.cache.stats()

    def clear_cache(self) -> dict:
        return self.cache.clear()

    def runtime_info(self) -> dict:
        return {
            "model_id": self.model_id,
            "model_repo": self.model_repo,
            "model_filename": self.model_filename,
            "n_ctx": self.n_ctx,
            "n_gpu_layers": self.n_gpu_layers,
            "n_threads": self.n_threads,
            "n_batch": self.n_batch,
        }

    def _download_model(self) -> Path:
        model_path = MODELS_DIR / self.model_filename
        if model_path.exists():
            print(f"✅ 模型已存在: {model_path}")
            return model_path

        print(f"📥 正在下載模型 {self.model_filename}...")
        print(f"   來源: {self.model_repo}")
        print("   這可能需要幾分鐘，請稍候...")

        downloaded_path = hf_hub_download(
            repo_id=self.model_repo,
            filename=self.model_filename,
            local_dir=MODELS_DIR,
            local_dir_use_symlinks=False,
        )
        print(f"✅ 模型下載完成: {downloaded_path}")
        return Path(downloaded_path)

    def _load_model(self):
        model_path = self._download_model()
        print("🔄 正在載入模型到記憶體...")
        backend = detect_backend()
        if backend == "CPU":
            print("⚙️ 推論模式: CPU")
        elif self.n_gpu_layers == 0:
            print(f"⚙️ 推論模式: CPU (GPU 後端 {backend} 可用，但 n_gpu_layers=0)")
        else:
            print(f"⚙️ 推論模式: {backend} GPU (n_gpu_layers={self.n_gpu_layers})")

        llama_kwargs = {
            "model_path": str(model_path),
            "n_ctx": self.n_ctx,
            "n_gpu_layers": self.n_gpu_layers,
            "n_batch": min(self.n_batch, self.n_ctx, 1024),
            "verbose": False,
        }
        if self.n_threads > 0:
            llama_kwargs["n_threads"] = self.n_threads

        self.model = Llama(**llama_kwargs)
        self.is_loaded = True
        print(f"✅ 模型載入完成！目前模型: {self.model_id}")

    def translate(
        self,
        text: str,
        source_lang: str = "auto",
        target_lang: str = "zh-TW",
        site: str = "generic",
        content_type: str = "text",
        translation_mode: str = "balanced",
        preserve_formatting: bool = False,
        glossary: list[str] | tuple[str, ...] | None = None,
    ) -> str:
        if not self.is_loaded or not self.model:
            raise RuntimeError("模型尚未載入")

        options = self._build_options(
            source_lang=source_lang,
            target_lang=target_lang,
            site=site,
            content_type=content_type,
            translation_mode=translation_mode,
            preserve_formatting=preserve_formatting,
            glossary=glossary,
        )

        cached = self.cache.get(text, options)
        if cached is not None:
            return cached

        translation = self._translate_uncached_single(text, options)
        self.cache.set(text, translation, options)
        return translation

    def translate_batch(
        self,
        texts: list[str],
        source_lang: str = "auto",
        target_lang: str = "zh-TW",
        site: str = "generic",
        content_types: list[str] | None = None,
        translation_mode: str = "balanced",
        preserve_formatting: bool = False,
        glossary: list[str] | tuple[str, ...] | None = None,
    ) -> list[str]:
        if not self.is_loaded or not self.model:
            raise RuntimeError("模型尚未載入")

        results = [""] * len(texts)
        grouped: dict[TranslationOptions, list[tuple[int, str]]] = {}

        for index, text in enumerate(texts):
            content_type = content_types[index] if content_types and index < len(content_types) else "text"
            options = self._build_options(
                source_lang=source_lang,
                target_lang=target_lang,
                site=site,
                content_type=content_type,
                translation_mode=translation_mode,
                preserve_formatting=preserve_formatting,
                glossary=glossary,
            )

            cached = self.cache.get(text, options)
            if cached is not None:
                results[index] = cached
                continue

            grouped.setdefault(options, []).append((index, text))

        for options, entries in grouped.items():
            pending_texts = [text for _, text in entries]
            try:
                if self._should_use_group_batch(pending_texts, options):
                    translations = self._translate_uncached_group(pending_texts, options)
                else:
                    translations = [self._translate_uncached_single(text, options) for text in pending_texts]
            except Exception:
                translations = [self._translate_uncached_single(text, options) for text in pending_texts]

            for (index, original_text), translation in zip(entries, translations):
                results[index] = translation
                self.cache.set(original_text, translation, options)

        return results


def detect_backend() -> str:
    try:
        import llama_cpp
        lib_dir = Path(llama_cpp.__file__).parent / "lib"
    except Exception:
        return "CPU"

    if platform.system() == "Darwin":
        if (lib_dir / "libggml-metal.dylib").exists():
            return "Metal"

    for pattern in ("*cuda*.dll", "*cuda*.so", "*cuda*.dylib"):
        if any(lib_dir.glob(pattern)):
            return "CUDA"

    return "CPU"


if __name__ == "__main__":
    print("🧪 測試 TranslateGemma 翻譯器")
    translator = TranslateGemmaTranslator()
    test_texts = [
        ("Hello, how are you?", "en", "zh-TW"),
        ("今天天氣很好", "zh-TW", "en"),
    ]
    for text, src, tgt in test_texts:
        print(f"\n📝 原文 ({src}): {text}")
        result = translator.translate(text, src, tgt)
        print(f"📖 譯文 ({tgt}): {result}")
