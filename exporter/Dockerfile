FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt \
    && useradd --system --uid 10001 --no-create-home exporter
COPY exporter.py ./exporter.py
USER 10001:10001
EXPOSE 9108
CMD ["python", "exporter.py", "--host", "0.0.0.0", "--port", "9108"]
