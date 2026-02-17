# Base environment for Cursor background/cloud agents.
# Do NOT copy app code; the agent clones the repo. Include dev tools only.
# See: https://cursor.com/environment-json-dockerfile

FROM oven/bun:1.3.9-debian

# Dev tools agents need (clone repo, HTTPS, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Cursor recommendation: run as non-root with home WORKDIR
ARG AGENT_USER=agent
RUN useradd -m -s /bin/bash "${AGENT_USER}"
USER ${AGENT_USER}
WORKDIR /home/${AGENT_USER}
