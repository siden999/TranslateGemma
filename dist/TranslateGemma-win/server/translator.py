"""
TranslateGemma 翻譯器模組

負責載入 GGUF 模型並提供翻譯功能
首次執行時會自動下載模型
"""
import os
from pathlib import Path
import platform
from typing import Optional

from huggingface_hub import hf_hub_download
from llama_cpp import Llama


# 模型設定
MODEL_REPO = "mradermacher/translategemma-4b-it-GGUF"
MODEL_FILENAME = "translategemma-4b-it.Q6_K.gguf"
MODELS_DIR = Path(__file__).parent / "models"

# 語言代碼對應（ISO 639-1）
LANGUAGE_CODES = {
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


class TranslateGemmaTranslator:
    """TranslateGemma 翻譯器"""
    
    def __init__(self, n_ctx: int = 2048, n_gpu_layers: int = -1):
        """
        初始化翻譯器
        
        參數:
            n_ctx: 上下文長度
            n_gpu_layers: GPU 層數，-1 表示全部使用 GPU
        """
        self.model: Optional[Llama] = None
        self.is_loaded = False
        self.n_ctx = n_ctx
        self.n_gpu_layers = n_gpu_layers
        
        # 確保模型目錄存在
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        
        # 載入模型
        self._load_model()
    
    def _download_model(self) -> Path:
        """下載模型（若不存在）"""
        model_path = MODELS_DIR / MODEL_FILENAME
        
        if model_path.exists():
            print(f"✅ 模型已存在: {model_path}")
            return model_path
        
        print(f"📥 正在下載模型 {MODEL_FILENAME}...")
        print(f"   來源: {MODEL_REPO}")
        print(f"   這可能需要幾分鐘，請稍候...")
        
        downloaded_path = hf_hub_download(
            repo_id=MODEL_REPO,
            filename=MODEL_FILENAME,
            local_dir=MODELS_DIR,
            local_dir_use_symlinks=False
        )
        
        print(f"✅ 模型下載完成: {downloaded_path}")
        return Path(downloaded_path)
    
    def _load_model(self):
        """載入 GGUF 模型"""
        model_path = self._download_model()
        
        print(f"🔄 正在載入模型到記憶體...")
        backend = detect_backend()
        if backend == "CPU":
            print("⚙️ 推論模式: CPU")
        else:
            if self.n_gpu_layers == 0:
                print(f"⚙️ 推論模式: CPU (GPU 後端 {backend} 可用，但 n_gpu_layers=0)")
            else:
                print(f"⚙️ 推論模式: {backend} GPU (n_gpu_layers={self.n_gpu_layers})")
        
        self.model = Llama(
            model_path=str(model_path),
            n_ctx=self.n_ctx,
            n_gpu_layers=self.n_gpu_layers,
            verbose=False
        )
        
        self.is_loaded = True
        print("✅ 模型載入完成！")

    def translate(
        self,
        text: str,
        source_lang: str = "en",
        target_lang: str = "zh-TW"
    ) -> str:
        """
        翻譯文字

        參數:
            text: 待翻譯的文字
            source_lang: 來源語言代碼
            target_lang: 目標語言代碼

        回傳:
            翻譯後的文字
        """
        if not self.is_loaded or not self.model:
            raise RuntimeError("模型尚未載入")

        # 取得語言名稱
        source_name = LANGUAGE_CODES.get(source_lang, source_lang)
        target_name = LANGUAGE_CODES.get(target_lang, target_lang)

        # 建構 TranslateGemma 專用的 prompt 格式
        # 參考: https://huggingface.co/google/translategemma-4b-it
        prompt = f"""<start_of_turn>user
Translate the following text from {source_name} to {target_name}:

{text}<end_of_turn>
<start_of_turn>model
"""

        # 進行推論
        response = self.model(
            prompt,
            max_tokens=self.n_ctx,
            stop=["<end_of_turn>", "<eos>"],
            echo=False
        )

        # 提取翻譯結果
        translation = response["choices"][0]["text"].strip()

        return translation


def detect_backend() -> str:
    """Best-effort 檢測可用的 GPU 後端"""
    try:
        import llama_cpp  # 局部匯入避免啟動成本
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
    # 測試翻譯器
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
