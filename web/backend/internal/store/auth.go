package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/scrypt"
)

type User struct {
	ID         int    `db:"id" json:"id"`
	Username   string `db:"username" json:"username"`
	Name       string `db:"name" json:"name"`
	Role       string `db:"role" json:"role"`
	EmployeeID *int   `db:"employee_id" json:"employee_id"`
}

// Passwords are stored as "salt:hash" (hex) using scrypt N=16384, r=8, p=1, 32-byte key.

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	saltHex := hex.EncodeToString(salt)
	key, err := scrypt.Key([]byte(password), []byte(saltHex), 16384, 8, 1, 32)
	if err != nil {
		return "", err
	}
	return saltHex + ":" + hex.EncodeToString(key), nil
}

func VerifyPassword(password, stored string) bool {
	salt, hash, ok := strings.Cut(stored, ":")
	want, err := hex.DecodeString(hash)
	if !ok || salt == "" || err != nil {
		return false
	}
	got, err := scrypt.Key([]byte(password), []byte(salt), 16384, 8, 1, 32)
	return err == nil && subtle.ConstantTimeCompare(want, got) == 1
}

// Login checks the credentials and opens a session; returns the user and session token.
func (s *Store) Login(ctx context.Context, username, password string, ttl time.Duration) (*User, string, error) {
	var u User
	var hash string
	err := s.pool.QueryRow(ctx, `SELECT id, username, name, role, employee_id, password_hash FROM users WHERE username = $1`,
		strings.TrimSpace(username)).Scan(&u.ID, &u.Username, &u.Name, &u.Role, &u.EmployeeID, &hash)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !VerifyPassword(password, hash)) {
		return nil, "", appErr(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
	}
	if err != nil {
		return nil, "", err
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, "", err
	}
	token := hex.EncodeToString(raw)
	if _, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at < now()`); err != nil {
		return nil, "", err
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
		tokenHash(token), u.ID, time.Now().Add(ttl)); err != nil {
		return nil, "", err
	}
	return &u, token, nil
}

// SessionUser returns the user behind a valid token and slides its expiry forward; nil if expired/unknown.
func (s *Store) SessionUser(ctx context.Context, token string, ttl time.Duration) (*User, error) {
	return one[User](ctx, s.pool, `
		WITH s AS (
		  UPDATE sessions SET expires_at = $2
		  WHERE token_hash = $1 AND expires_at > now()
		  RETURNING user_id
		)
		SELECT u.id, u.username, u.name, u.role, u.employee_id FROM users u JOIN s ON s.user_id = u.id`,
		tokenHash(token), time.Now().Add(ttl))
}

func (s *Store) Logout(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash(token))
	return err
}

func tokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
