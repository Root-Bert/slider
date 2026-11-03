# rembg for the AI's „Hintergrund entfernen“ (optional, docs/self-hosting.md → „Freistellen“).
# Built here instead of rembg's own image: that one is amd64 only, this one builds on arm64 too.
FROM python:3.12-slim

RUN pip install --no-cache-dir "rembg[cpu,cli]==2.0.86"

# The model goes into the image, fetched by cutting out a blank picture the way Slider asks:
# no download when the first picture comes.
ENV U2NET_HOME=/models
ARG REMBG_MODEL=isnet-general-use
RUN python -c "from PIL import Image; Image.new('RGB', (64, 64), 'white').save('/tmp/blank.png')" \
  && rembg i -m "$REMBG_MODEL" -dc /tmp/blank.png /tmp/cut.png \
  && rm /tmp/blank.png /tmp/cut.png

# One picture at a time on two cores; Slider queues the rest.
ENV OMP_NUM_THREADS=2
EXPOSE 7000
CMD ["rembg", "s", "--host", "0.0.0.0", "--port", "7000", "--no-ui", "--threads", "1"]
