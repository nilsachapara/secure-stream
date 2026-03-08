FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY go.mod ./
COPY *.go ./

# Download dependencies and generate go.sum
RUN go mod tidy
RUN go mod download

# Build the app
RUN CGO_ENABLED=0 GOOS=linux go build -o filestream .

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/filestream .
EXPOSE 8080
CMD ["./filestream"]
