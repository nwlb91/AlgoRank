FROM python:3.12-slim

WORKDIR /app

COPY ingest/pyproject.toml ingest/pyproject.toml
COPY ingest/algorank_ingest ingest/algorank_ingest
COPY db db

RUN pip install --no-cache-dir ./ingest

# Default: show status. Override with e.g. `backfill all --max-minutes 340`.
ENTRYPOINT ["algorank"]
CMD ["status"]
