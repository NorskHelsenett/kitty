# Minimal multi-stage Dockerfile for @norskhelsenett/kitty
# Build stage: use node image to install deps and compile TypeScript
FROM node:20-slim AS build
WORKDIR /app

# install build deps
COPY package.json package-lock.json* ./
RUN npm ci --silent || npm install --silent

# copy source and build
COPY . .
RUN npm run build --silent

# Runtime stage: smaller image
FROM node:20-slim

# Keep build artifacts in /app but default runtime working directory should be /wrk
WORKDIR /app

# Create a non-root user
# use Debian utilities (groupadd/useradd) available in slim images
# create non-root user
RUN groupadd -r app && useradd -r -m -g app app

# Prepare a default work directory that users can mount into at runtime
# If you bind-mount a host dir to /wrk at runtime, the host controls ownership
RUN mkdir -p /wrk && chown app:app /wrk

# Copy built files and production deps
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

USER app

# Default runtime working directory (useful when users mount their repo to /wrk)
WORKDIR /wrk

# Expose nothing by default; TUI runs in interactive terminal
# Use absolute path for the entrypoint so it runs regardless of current working dir
ENTRYPOINT ["node", "/app/dist/index.js"]

# Default command: run TUI (no args) or accept CLI args (e.g. kitty "hello")
CMD []
