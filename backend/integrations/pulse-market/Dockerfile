FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global gmgn-cli@1.4.9

WORKDIR /app

COPY pulse_market_worker.py run_worker_forever.py ./

ENV PYTHONUNBUFFERED=1
ENV PULSE_POLL_INTERVAL_SECONDS=60
ENV PULSE_POLL_WINDOW_MINUTES=1
ENV PULSE_GMGN_CONCURRENCY=3

CMD ["python3", "run_worker_forever.py"]
