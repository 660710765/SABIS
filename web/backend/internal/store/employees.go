package store

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

type Employee struct {
	ID      int     `db:"id" json:"id"`
	Code    string  `db:"code" json:"code"`
	Name    string  `db:"name" json:"name"`
	Type    string  `db:"type" json:"type"`
	Rate    float64 `db:"rate" json:"rate"`
	Bank    *string `db:"bank" json:"bank"`
	Account *string `db:"account" json:"account"`
	Active  Flag    `db:"active" json:"active"`
}

// EmployeeInput is the employee form after parsing; Active is ignored on create.
type EmployeeInput struct {
	Name, Type, Bank, Account string
	Rate                      float64
	Active                    bool
}

const employeeCols = `id, code, name, type, rate, bank, account, active`

func (s *Store) Employees(ctx context.Context) ([]Employee, error) {
	return collect[Employee](ctx, s.pool, `SELECT `+employeeCols+` FROM employees ORDER BY active DESC, code`)
}

func (s *Store) Employee(ctx context.Context, id int) (*Employee, error) {
	e, err := one[Employee](ctx, s.pool, `SELECT `+employeeCols+` FROM employees WHERE id = $1`, id)
	if err == nil && e == nil {
		err = appErr(404, "ไม่พบพนักงาน")
	}
	return e, err
}

func validateEmployee(in *EmployeeInput) error {
	in.Name = strings.TrimSpace(in.Name)
	in.Bank = strings.TrimSpace(in.Bank)
	in.Account = strings.TrimSpace(in.Account)
	if in.Name == "" {
		return appErr(400, "กรุณากรอกชื่อ-สกุล")
	}
	if in.Type != "monthly" && in.Type != "daily" {
		return appErr(400, "ประเภทการจ้างไม่ถูกต้อง")
	}
	if !(in.Rate > 0) {
		return appErr(400, "อัตราค่าจ้างต้องมากกว่า 0")
	}
	if in.Type == "monthly" && (in.Bank == "" || in.Account == "") {
		return appErr(400, "พนักงานรายเดือนต้องมีธนาคารและเลขบัญชีสำหรับโอนเงิน (BR-03)")
	}
	return nil
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// CreateEmployee adds an employee with the next EMP-xxxx code and a login (password 1234).
func (s *Store) CreateEmployee(ctx context.Context, in EmployeeInput) (*Employee, error) {
	if err := validateEmployee(&in); err != nil {
		return nil, err
	}
	var id int
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		// Serialise code generation so two people adding staff cannot get the same code.
		if _, err := tx.Exec(ctx, `LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE`); err != nil {
			return err
		}
		var err error
		id, err = insertEmployee(ctx, tx, in)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Employee(ctx, id)
}

func insertEmployee(ctx context.Context, q querier, in EmployeeInput) (int, error) {
	var last string
	_ = q.QueryRow(ctx, `SELECT code FROM employees ORDER BY code DESC LIMIT 1`).Scan(&last)
	n := 100
	if v, err := strconv.Atoi(strings.TrimPrefix(last, "EMP-")); err == nil {
		n = v
	}
	code := fmt.Sprintf("EMP-%04d", n+1)
	return addEmployee(ctx, q, code, in)
}

func addEmployee(ctx context.Context, q querier, code string, in EmployeeInput) (int, error) {
	var id int
	err := q.QueryRow(ctx, `INSERT INTO employees (code, name, type, rate, bank, account) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		code, in.Name, in.Type, in.Rate, nullable(in.Bank), nullable(in.Account)).Scan(&id)
	if err != nil {
		return 0, err
	}
	hash, err := HashPassword("1234")
	if err != nil {
		return 0, err
	}
	_, err = q.Exec(ctx, `INSERT INTO users (username, name, role, password_hash, employee_id) VALUES ($1, $2, 'employee', $3, $4)`,
		code, in.Name, hash, id)
	return id, err
}

func (s *Store) UpdateEmployee(ctx context.Context, id int, in EmployeeInput) (*Employee, error) {
	if err := validateEmployee(&in); err != nil {
		return nil, err
	}
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE employees SET name = $1, type = $2, rate = $3, bank = $4, account = $5, active = $6 WHERE id = $7`,
			in.Name, in.Type, in.Rate, nullable(in.Bank), nullable(in.Account), in.Active, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return appErr(404, "ไม่พบพนักงาน")
		}
		_, err = tx.Exec(ctx, `UPDATE users SET name = $1 WHERE employee_id = $2`, in.Name, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Employee(ctx, id)
}

type EmployeeBrief struct {
	Code string `db:"code" json:"code"`
	Name string `db:"name" json:"name"`
	Type string `db:"type" json:"type"`
}

func (s *Store) EmployeeBrief(ctx context.Context, id int) (*EmployeeBrief, error) {
	return one[EmployeeBrief](ctx, s.pool, `SELECT code, name, type FROM employees WHERE id = $1`, id)
}
