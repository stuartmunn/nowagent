# Minimal container shell for the nowagent agent (NOW-8).
# No now-sdk / Claude SDK dependencies yet — those land with the
# business logic in later stories.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Documented high port, matches docker-compose.yml.
EXPOSE 8791

CMD ["node", "src/server.js"]
