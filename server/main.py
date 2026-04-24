from __future__ import annotations

"""
TranslateGemma 翻譯伺服器

使用 TranslateGemma-4b-it GGUF 模型提供本地翻譯 API
"""
import os
import sys
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from translator import TranslateGemmaTranslator


# 全域翻譯器實例
translator: Optional[TranslateGemmaTranslator] = None
MODEL_ID = os.environ.get("TG_MODEL_ID", "translategemma-4b-it-Q4_K_M")


class TranslateRequest(BaseModel):
    """翻譯請求模型"""
    text: str
    source_lang: str = "auto"  # ISO 639-1 語言代碼
    target_lang: str = "zh-TW"  # 預設繁體中文
    site: str = "generic"
    content_type: str = "text"
    translation_mode: str = "balanced"
    preserve_formatting: bool = False
    glossary: list[str] = Field(default_factory=list)


class TranslateResponse(BaseModel):
    """翻譯回應模型"""
    translation: str
    source_lang: str
    target_lang: str
    model: str


class TranslateBatchRequest(BaseModel):
    """批次翻譯請求模型"""
    texts: list[str]
    source_lang: str = "auto"
    target_lang: str = "zh-TW"
    site: str = "generic"
    content_types: list[str] = Field(default_factory=list)
    translation_mode: str = "balanced"
    preserve_formatting: bool = False
    glossary: list[str] = Field(default_factory=list)


class TranslateBatchResponse(BaseModel):
    """批次翻譯回應模型"""
    translations: list[str]
    source_lang: str
    target_lang: str
    model: str


class HealthResponse(BaseModel):
    """健康檢查回應"""
    status: str
    model_loaded: bool
    model: Optional[str] = None
    runtime: Optional[dict] = None


class CacheStatsResponse(BaseModel):
    """翻譯快取統計"""
    entries: int
    hits: int
    db_size_bytes: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    """應用程式生命週期管理"""
    global translator
    print("🚀 正在載入 TranslateGemma 模型...")
    translator = TranslateGemmaTranslator()
    print("✅ 模型載入完成！伺服器已就緒")
    yield
    # 清理資源
    if translator:
        del translator
    print("👋 伺服器已關閉")


app = FastAPI(
    title="TranslateGemma API",
    description="本地離線翻譯 API，使用 TranslateGemma-4b-it 模型",
    version="0.1.0",
    lifespan=lifespan
)

# 設定 CORS，允許瀏覽器擴充功能存取
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允許所有來源（擴充功能需要）
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """健康檢查端點"""
    return HealthResponse(
        status="ok",
        model_loaded=translator is not None and translator.is_loaded,
        model=translator.model_id if translator else None,
        runtime=translator.runtime_info() if translator else None,
    )


@app.post("/translate", response_model=TranslateResponse)
async def translate(request: TranslateRequest):
    """
    翻譯文字
    
    - **text**: 待翻譯的文字
    - **source_lang**: 來源語言代碼 (ISO 639-1)，可用 auto 自動偵測
    - **target_lang**: 目標語言代碼，預設 zh-TW（繁體中文）
    - **site**: 內容站點類型，如 youtube / github / wikipedia / reddit
    - **content_type**: 內容類型，如 title / subtitle / paragraph / comment
    - **translation_mode**: speed / balanced / quality
    - **preserve_formatting**: 是否保留格式、技術 token、佔位符
    - **glossary**: 術語偏好，例如 ["LLM=LLM", "prompt=提示詞"]
    """
    if not translator or not translator.is_loaded:
        raise HTTPException(status_code=503, detail="模型尚未載入完成")
    
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="翻譯文字不能為空")
    
    if len(request.text) > 5000:
        raise HTTPException(status_code=400, detail="翻譯文字過長 (上限 5000 字元)")
    
    try:
        translation = translator.translate(
            text=request.text,
            source_lang=request.source_lang,
            target_lang=request.target_lang,
            site=request.site,
            content_type=request.content_type,
            translation_mode=request.translation_mode,
            preserve_formatting=request.preserve_formatting,
            glossary=request.glossary,
        )
        
        return TranslateResponse(
            translation=translation,
            source_lang=request.source_lang,
            target_lang=request.target_lang,
            model=translator.model_id,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"翻譯失敗: {str(e)}")


@app.post("/translate_batch", response_model=TranslateBatchResponse)
async def translate_batch(request: TranslateBatchRequest):
    """
    批次翻譯文字

    - **texts**: 待翻譯的文字陣列
    - **source_lang**: 來源語言代碼，可用 auto 自動偵測
    - **target_lang**: 目標語言代碼
    """
    if not translator or not translator.is_loaded:
        raise HTTPException(status_code=503, detail="模型尚未載入完成")

    if not request.texts:
        raise HTTPException(status_code=400, detail="翻譯文字不能為空")

    if len(request.texts) > 8:
        raise HTTPException(status_code=400, detail="批次翻譯上限為 8 段")

    normalized_texts = [text.strip() for text in request.texts]
    if any(not text for text in normalized_texts):
        raise HTTPException(status_code=400, detail="翻譯文字不能為空")

    total_chars = sum(len(text) for text in normalized_texts)
    if total_chars > 8000:
        raise HTTPException(status_code=400, detail="批次翻譯總字數過長 (上限 8000 字元)")

    try:
        translations = translator.translate_batch(
            texts=normalized_texts,
            source_lang=request.source_lang,
            target_lang=request.target_lang,
            site=request.site,
            content_types=request.content_types,
            translation_mode=request.translation_mode,
            preserve_formatting=request.preserve_formatting,
            glossary=request.glossary,
        )

        return TranslateBatchResponse(
            translations=translations,
            source_lang=request.source_lang,
            target_lang=request.target_lang,
            model=translator.model_id,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"批次翻譯失敗: {str(e)}")


@app.get("/cache_stats", response_model=CacheStatsResponse)
async def cache_stats():
    """取得伺服器端翻譯快取統計"""
    if not translator:
        raise HTTPException(status_code=503, detail="模型尚未載入完成")
    return CacheStatsResponse(**translator.cache_stats())


@app.post("/cache_clear", response_model=CacheStatsResponse)
async def cache_clear():
    """清除伺服器端翻譯快取"""
    if not translator:
        raise HTTPException(status_code=503, detail="模型尚未載入完成")
    return CacheStatsResponse(**translator.clear_cache())


if __name__ == "__main__":
    import uvicorn
    
    # 取得 port，預設 8080
    port = int(os.environ.get("PORT", 8080))
    
    print(f"🌐 啟動 TranslateGemma 伺服器於 http://127.0.0.1:{port}")
    # 資安修正：僅監聽本機介面 (127.0.0.1)，防止外部網路連線
    uvicorn.run(app, host="127.0.0.1", port=port)
