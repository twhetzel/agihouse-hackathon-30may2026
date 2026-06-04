FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY server/pyproject.toml server/uv.lock ./server/
WORKDIR /app/server
RUN uv sync --frozen --no-dev

WORKDIR /app
COPY server/gwas_prepubmatch_server ./server/gwas_prepubmatch_server
COPY scripts/setup_science_skills.sh ./scripts/
RUN bash scripts/setup_science_skills.sh

ENV PREPUBMATCH_HOST=0.0.0.0
ENV PREPUBMATCH_PORT=8000
ENV PREPUBMATCH_CORS_ORIGINS=*

EXPOSE 8000

WORKDIR /app/server

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=8)"

CMD ["uv", "run", "uvicorn", "gwas_prepubmatch_server.main:app", "--host", "0.0.0.0", "--port", "8000"]
