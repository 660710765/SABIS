// Genertech Payroll API server.
//
// Configuration (environment variables, or a .env file in the working directory):
//
//	DATABASE_URL  postgres://user:password@localhost:5432/payroll  (required)
//	PORT          HTTP port, default 8080
package main

import (
	"bufio"
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"genertech/payroll/internal/api"
	"genertech/payroll/internal/store"
)

func main() {
	loadDotEnv(".env")
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is not set — copy .env.example to .env and fill in your PostgreSQL password")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := store.Open(ctx, dbURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           api.New(db),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()

	log.Printf("Genertech Payroll API: http://localhost:%s", port)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

// loadDotEnv sets KEY=VALUE pairs from path; variables already set in the environment win.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		key, val, ok := strings.Cut(line, "=")
		if !ok || strings.HasPrefix(line, "#") {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.Trim(strings.TrimSpace(val), `"'`)
		if _, set := os.LookupEnv(key); !set {
			os.Setenv(key, val)
		}
	}
}
