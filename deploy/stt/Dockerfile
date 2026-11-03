# Speech to text for Slider (optional, docs/self-hosting.md → „Sprache zu Text“): Whisper through
# faster-whisper, answering OpenAI's transcription API. Builds on amd64 and arm64.
FROM python:3.12-slim

# PyAV brings its own FFmpeg: no system packages. av pinned – newer ones drop an argument
# faster-whisper still passes.
RUN pip install --no-cache-dir \
  "faster-whisper==1.2.1" "av==16.1.0" \
  "fastapi==0.142.2" "uvicorn==0.54.0" "python-multipart==0.0.32"

# The model goes into the image: no download when the first recording comes. large-v3-turbo:
# ~100 languages, close to large-v3 in quality, ~2 GB RAM with int8.
ENV WHISPER_MODELS=/models HF_HUB_DISABLE_TELEMETRY=1
ARG WHISPER_MODEL=large-v3-turbo
ENV WHISPER_MODEL=$WHISPER_MODEL
RUN python -c "import os; from faster_whisper import download_model; download_model(os.environ['WHISPER_MODEL'], cache_dir=os.environ['WHISPER_MODELS'])"
# From here on offline: the model is in the image.
ENV HF_HUB_OFFLINE=1

WORKDIR /app
COPY server.py .
RUN useradd --system --no-create-home stt
USER stt
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
