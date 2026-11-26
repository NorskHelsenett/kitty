# Minimal multi-stage Dockerfile for @norskhelsenett/kitty
# Build stage: use node image to install deps and compile TypeScript
# Base image pinned by digest; refresh it deliberately (e.g. via Renovate/Dependabot)
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS build
WORKDIR /app

# install build deps
# The lockfile is required: npm ci fails loudly if it is missing or out of sync
COPY package.json package-lock.json ./
RUN npm ci --silent

# copy source and build
COPY . .
RUN npm run build --silent \
  && npm prune --omit=dev --silent

# Runtime stage: smaller image
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

# Keep build artifacts in /app but default runtime working directory should be /wrk
WORKDIR /app

# Create a non-root user
# use Debian utilities (groupadd/useradd) available in slim images
# create non-root user
RUN groupadd -r app && useradd -r -m -g app app

# Prepare a default work directory that users can mount into at runtime
# If you bind-mount a host dir to /wrk at runtime, the host controls ownership
RUN mkdir -p /wrk && chown app:app /wrk

# Copy built files and production deps (devDependencies were pruned above)
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
