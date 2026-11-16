FROM python:3.12-slim

WORKDIR /app
COPY backend/telegram-user/requirements.txt /app/requirements.txt
COPY backend/telegram-user/lunch/requirements.txt /app/lunch-requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt -r /app/lunch-requirements.txt

COPY backend/telegram-user/dzhura /app/dzhura
COPY podoroguem-listener /app/podoroguem-listener

CMD ["python", "/app/podoroguem-listener/main.py"]
