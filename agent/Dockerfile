# nowagent agent container.
FROM node:22-alpine

WORKDIR /app

# npm ci + committed lockfile for reproducible installs (CODING_STANDARDS.md,
# NOW-8/NOW-10 lesson: npm install without a lockfile is non-deterministic).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src

# The Fluent workspace is a separate now-sdk project (its own package.json,
# now.config.json, tsconfig) that the agent shells out to for now-sdk build
# validation (and, later, now-sdk install for deploy). devDependencies are
# needed here — now-sdk build/install are dev tools, not runtime code.
COPY fluent-workspace/package.json fluent-workspace/package-lock.json ./fluent-workspace/
RUN cd fluent-workspace && npm ci --no-audit --no-fund
COPY fluent-workspace ./fluent-workspace

# Documented high port, matches docker-compose.yml.
EXPOSE 8791

CMD ["node", "src/server.js"]
