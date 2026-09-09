FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends x11vnc novnc websockify fluxbox util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY service/package*.json ./service/
RUN npm ci --prefix service --omit=dev
COPY manifest.json ./
COPY src ./src
COPY service ./service
RUN mkdir -p /data /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix && chown 1000:1000 /data
USER 1000:1000
ENV DATA_DIR=/data HOME=/data/home
ENTRYPOINT ["/app/service/entrypoint.sh"]
CMD ["run"]
