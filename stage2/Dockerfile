FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/srv/stp
WORKDIR /srv/stp
RUN mkdir /state /ipc && chown 10001:10001 /state /ipc
COPY app.py classifier.py mcp_stdio.py data.json sla.json tools.json ./
COPY web ./web
COPY ml/model.json ml/metrics.json ./ml/
COPY server/team_app.py server/mcp_service.py ./server/
USER 10001:10001
CMD ["python", "server/team_app.py"]
