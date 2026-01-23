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
from pydantic import BaseModel

from translator import TranslateGemmaTranslator


# 全域翻譯器實例
translator: Optional[TranslateGemmaTranslator] = None


class TranslateRequest(BaseModel):
    """翻譯請求模型"""
    text: str
    source_lang: str = "en"  # ISO 639-1 語言代碼
    target_lang: str = "zh-TW"  # 預設繁體中文


class TranslateResponse(BaseModel):
    """翻譯回應模型"""
    translation: str
    source_lang: str
    target_lang: str
    model: str = "translategemma-4b-it-Q6_K"


class HealthResponse(BaseModel):
    """健康檢查回應"""
    status: str
    model_loaded: bool


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
        model_loaded=translator is not None and translator.is_loaded
    )


@app.post("/translate", response_model=TranslateResponse)
async def translate(request: TranslateRequest):
    """
    翻譯文字
    
    - **text**: 待翻譯的文字
    - **source_lang**: 來源語言代碼 (ISO 639-1)，如 en, ja, ko
    - **target_lang**: 目標語言代碼，預設 zh-TW（繁體中文）
    """
    if not translator or not translator.is_loaded:
        raise HTTPException(status_code=503, detail="模型尚未載入完成")
    
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="翻譯文字不能為空")
    
    try:
        translation = translator.translate(
            text=request.text,
            source_lang=request.source_lang,
            target_lang=request.target_lang
        )
        
        return TranslateResponse(
            translation=translation,
            source_lang=request.source_lang,
            target_lang=request.target_lang
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"翻譯失敗: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    
    # 取得 port，預設 8080
    port = int(os.environ.get("PORT", 8080))
    
    print(f"🌐 啟動 TranslateGemma 伺服器於 http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
