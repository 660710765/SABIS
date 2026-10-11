FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /payroll-api ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache tzdata
COPY --from=build /payroll-api /usr/local/bin/payroll-api
EXPOSE 8080
CMD ["payroll-api"]
