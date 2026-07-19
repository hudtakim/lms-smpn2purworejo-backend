# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM golang:1.26-alpine AS builder

# Install build dependencies (for CGO if needed; also provides git for VCS stamping)
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

# Cache dependency downloads separately from source changes
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Copy source and build a fully static binary
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -trimpath -o server .

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM alpine:3.20

# ca-certificates: for outbound TLS; tzdata: for correct time zone handling
RUN apk add --no-cache ca-certificates tzdata

# Run as a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy the compiled binary and timezone data from the builder
COPY --from=builder /build/server .

# Create the uploads directory and hand ownership to the app user
RUN mkdir -p uploads && chown -R appuser:appgroup /app

USER appuser

EXPOSE 5000

ENTRYPOINT ["./server"]
