# Multi-stage build: compile jadi binary statis, lalu jalankan di base
# image minimal — tidak perlu Go toolchain di image final.
FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o media-service ./cmd/main.go

FROM alpine:3.20 AS runtime
RUN apk add --no-cache ca-certificates ffmpeg
WORKDIR /app
COPY --from=build /app/media-service .

EXPOSE 8080
CMD ["./media-service"]
