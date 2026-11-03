"""Speech to text for Slider, on the server itself: Whisper through faster-whisper.

Answers the part of OpenAI's API Slider asks (`GET /v1/models`, `POST /v1/audio/transcriptions`),
so Slider talks to it like to any service. One recording at a time: the model takes all the CPU
it gets, the others wait their turn. Nothing leaves the server – the model lies in the image.
"""

import os
import tempfile
import threading

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from faster_whisper import WhisperModel

MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
MODEL_ID = f"whisper-{MODEL}"
# int8 halves the memory against float16 and costs next to nothing in quality on a CPU.
model = WhisperModel(
    MODEL,
    device=os.environ.get("WHISPER_DEVICE", "cpu"),
    compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"),
    cpu_threads=int(os.environ.get("WHISPER_THREADS", "0")),
    download_root=os.environ.get("WHISPER_MODELS", "/models"),
)
turn = threading.Lock()
# A recording of a few hours, compressed; Slider sends nothing bigger.
MAX_BYTES = 500 * 1024 * 1024

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "local"}]}


# Plain `def`: FastAPI runs it in its thread pool, the lock keeps it to one at a time.
@app.post("/v1/audio/transcriptions")
def transcriptions(
    file: UploadFile = File(...),
    model_name: str = Form(MODEL_ID, alias="model"),
    language: str | None = Form(None),
    prompt: str | None = Form(None),
    response_format: str = Form("json"),
):
    if response_format not in ("json", "text", "verbose_json"):
        raise HTTPException(400, "response_format: json, text or verbose_json")
    with tempfile.NamedTemporaryFile() as audio:
        size = 0
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                raise HTTPException(413, "The recording is too big.")
            audio.write(chunk)
        audio.flush()
        with turn:
            try:
                segments, info = model.transcribe(
                    audio.name,
                    language=language or None,
                    initial_prompt=prompt or None,
                    # Silence skipped: no words made up for it.
                    vad_filter=True,
                )
                segments = list(segments)
            except Exception as error:  # An unreadable file: PyAV cannot decode it.
                raise HTTPException(400, "The recording could not be read.") from error
    text = " ".join(segment.text.strip() for segment in segments).strip()
    if response_format == "text":
        return PlainTextResponse(text)
    if response_format == "json":
        return {"text": text}
    return {
        "task": "transcribe",
        "language": info.language,
        "duration": info.duration,
        "text": text,
        "segments": [
            {"id": index, "start": segment.start, "end": segment.end, "text": segment.text.strip()}
            for index, segment in enumerate(segments)
        ],
    }
