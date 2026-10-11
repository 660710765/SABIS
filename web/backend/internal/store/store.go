// Package store is the PostgreSQL data layer: connection, schema, sample data,
// and the payroll workflow (service.go) and master data (employees.go).
package store

import (
	"context"
	_ "embed"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

// AppError is a user-facing error (Thai message) with the HTTP status to send.
type AppError struct {
	Status  int
	Message string
}

func (e *AppError) Error() string { return e.Message }

func appErr(status int, format string, args ...any) error {
	return &AppError{Status: status, Message: fmt.Sprintf(format, args...)}
}

// querier is satisfied by both *pgxpool.Pool and pgx.Tx.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Store struct {
	pool *pgxpool.Pool
}

// Open connects to PostgreSQL, creating the database if it does not exist yet,
// applies the schema and loads sample data into an empty database.
func Open(ctx context.Context, databaseURL string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL: %w", err)
	}
	pool, err := connect(ctx, cfg)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "3D000" { // invalid_catalog_name
		if err = createDatabase(ctx, cfg.ConnConfig); err != nil {
			return nil, err
		}
		pool, err = connect(ctx, cfg)
	}
	if err != nil {
		return nil, err
	}

	s := &Store{pool: pool}
	if err := s.migrate(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return s, nil
}

func connect(ctx context.Context, cfg *pgxpool.Config) (*pgxpool.Pool, error) {
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func createDatabase(ctx context.Context, cc *pgx.ConnConfig) error {
	admin := cc.Copy()
	name := admin.Database
	admin.Database = "postgres"
	conn, err := pgx.ConnectConfig(ctx, admin)
	if err != nil {
		return fmt.Errorf("create database %q: %w", name, err)
	}
	defer conn.Close(ctx)
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
		return fmt.Errorf("create database %q: %w", name, err)
	}
	return nil
}

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, schemaSQL); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	var n int
	if err := s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM users").Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return s.inTx(ctx, func(tx pgx.Tx) error { return seed(ctx, tx) })
	}
	return nil
}

func (s *Store) Close() { s.pool.Close() }

// inTx runs fn in a transaction, committing only if it returns nil.
func (s *Store) inTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, s.pool, fn)
}

// collect scans every row into T by matching column names to `db` struct tags.
func collect[T any](ctx context.Context, q querier, sql string, args ...any) ([]T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByName[T])
	if out == nil {
		out = []T{} // JSON [] rather than null
	}
	return out, err
}

// one scans a single row into T; returns (nil, nil) when there is none.
func one[T any](ctx context.Context, q querier, sql string, args ...any) (*T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	v, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[T])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return v, err
}

// Flag is a boolean column sent to the frontend as 1/0, as the original API did.
type Flag bool

func (f Flag) MarshalJSON() ([]byte, error) {
	if f {
		return []byte("1"), nil
	}
	return []byte("0"), nil
}
