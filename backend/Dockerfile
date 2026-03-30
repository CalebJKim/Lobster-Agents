FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy project files and install
COPY pyproject.toml .
COPY src/ src/
RUN pip install --no-cache-dir .

# Data directory for SQLite
RUN mkdir -p /data
ENV OFFICE_AGENTS_DB_PATH=/data/office_agents.db

EXPOSE 8001

CMD ["uvicorn", "office_agents.main:app", "--host", "0.0.0.0", "--port", "8001"]
