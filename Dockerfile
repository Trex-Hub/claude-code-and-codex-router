# syntax=docker/dockerfile:1

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM node:24-slim AS runtime
WORKDIR /app

# dbmate runs the SQL migrations on start. TARGETARCH (amd64|arm64) matches
# dbmate's release asset naming, so the image builds for the host arch.
ARG TARGETARCH=amd64
ARG DBMATE_VERSION=v2.36.0
ADD https://github.com/amacneil/dbmate/releases/download/${DBMATE_VERSION}/dbmate-linux-${TARGETARCH} /usr/local/bin/dbmate
RUN chmod +x /usr/local/bin/dbmate

# Next.js standalone output + migrations.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/db ./db
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=sqlite:/data/relay.db

EXPOSE 3000
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
