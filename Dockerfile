# Stage 1: Build static Svelte 5 + TypeScript web assets
FROM node:22-bookworm-slim AS web-builder
WORKDIR /workspace
COPY VERSION ./VERSION
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
COPY web ./web
RUN npm --prefix web run build

# Stage 2: Build release Rust binary
FROM rust:1.88-bookworm AS rust-builder
WORKDIR /workspace
COPY LICENSE ./LICENSE
COPY rust/Cargo.toml rust/Cargo.lock ./rust/
COPY core/Cargo.toml core/Cargo.lock ./core/
COPY core/src ./core/src
COPY rust/src ./rust/src
RUN cargo build --manifest-path rust/Cargo.toml --release --locked

# Stage 3: Minimal non-root runtime image
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=rust-builder /workspace/rust/target/release/slop-grenade /app/slop-grenade
COPY --from=web-builder /workspace/web/build /app/web/build
USER appuser
ENV HTTP_BIND=0.0.0.0:8090
ENV WEB_ASSET_DIR=/app/web/build
EXPOSE 8090
ENTRYPOINT ["/app/slop-grenade"]
