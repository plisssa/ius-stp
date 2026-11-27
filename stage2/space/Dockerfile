# Hugging Face Spaces (Docker): приложение, сервер инструментов и модель в одном контейнере.
FROM ollama/ollama:0.35.0
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /home/user/app && chown -R 1000:1000 /home/user \
 && (id -u 1000 >/dev/null 2>&1 || useradd -u 1000 -d /home/user user)
USER 1000
ENV HOME=/home/user OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS=/home/user/models \
    STP_MODEL=qwen2.5:0.5b PYTHONPATH=/home/user/app PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# Веса модели скачиваются один раз при сборке образа.
RUN ollama serve >/tmp/ollama.log 2>&1 & \
    for i in $(seq 1 60); do ollama list >/dev/null 2>&1 && break; sleep 1; done; \
    ollama pull "$STP_MODEL"
WORKDIR /home/user/app
COPY --chown=1000:1000 . .
EXPOSE 7860
ENTRYPOINT []
CMD ["bash", "start.sh"]
