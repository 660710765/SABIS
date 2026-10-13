package store

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// seed loads sample data so the system can be demonstrated right after the first start.
func seed(ctx context.Context, tx pgx.Tx) error {
	for _, u := range []struct{ username, name, role string }{
		{"somsri", "สมศรี รักษ์บัญชี", "accountant"},
		{"weera", "วีระ คุมงานดี", "manager"},
		executiveUser,
	} {
		if err := addUser(ctx, tx, u.username, u.name, u.role); err != nil {
			return err
		}
	}

	emps := []struct {
		code string
		in   EmployeeInput
	}{
		{"EMP-0101", EmployeeInput{Name: "วิไล ศรีสุข", Type: "monthly", Rate: 24000, Bank: "กสิกรไทย", Account: "123-4-54521-0"}},
		{"EMP-0108", EmployeeInput{Name: "ธนพล แก้วมณี", Type: "monthly", Rate: 38000, Bank: "กรุงเทพ", Account: "456-7-00912-3"}},
		{"EMP-0115", EmployeeInput{Name: "อรุณี พรหมมา", Type: "monthly", Rate: 18000, Bank: "ไทยพาณิชย์", Account: "789-1-27730-5"}},
		{"EMP-0142", EmployeeInput{Name: "สมชาย ใจดี", Type: "daily", Rate: 450}},
		{"EMP-0157", EmployeeInput{Name: "ประยูร ทองมา", Type: "daily", Rate: 450}},
		{"EMP-0163", EmployeeInput{Name: "จักรพันธ์ บุญมา", Type: "daily", Rate: 480}},
	}
	for _, e := range emps {
		if _, err := addEmployee(ctx, tx, e.code, e.in); err != nil {
			return err
		}
	}

	const system = "ระบบ (ข้อมูลตัวอย่าง)"

	// October 2026 (ต.ค. 2569) round 1: already paid.
	p1, err := createPeriod(ctx, tx, 2026, 10, 1, system)
	if err != nil {
		return err
	}
	if err := setAttendance(ctx, tx, p1, map[string]map[string]float64{
		"EMP-0101": {"ot_hours": 2},
		"EMP-0142": {"days_worked": 12},
		"EMP-0157": {"days_worked": 13, "ot_hours": 3},
	}); err != nil {
		return err
	}
	if err := processPeriod(ctx, tx, p1, system); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE periods SET status = 'paid',
		  submitted_by = $1, submitted_at = '2026-10-14 15:00:00+07',
		  approved_by  = $2, approved_at  = '2026-10-15 09:30:00+07',
		  paid_by      = $1, paid_at      = '2026-10-15 14:00:00+07'
		WHERE id = $3`, "สมศรี รักษ์บัญชี", "วีระ คุมงานดี", p1); err != nil {
		return err
	}

	// October 2026 round 2: attendance imported, waiting to be processed.
	p2, err := createPeriod(ctx, tx, 2026, 10, 2, system)
	if err != nil {
		return err
	}
	return setAttendance(ctx, tx, p2, map[string]map[string]float64{
		"EMP-0101": {"ot_hours": 4},
		"EMP-0115": {"days_worked": 13, "absent_days": 1},
		"EMP-0142": {"ot_hours": 6},
		"EMP-0157": {"days_worked": 11},
		"EMP-0163": {"days_worked": 13, "ot_hours": 4},
	})
}

// executiveUser is the sample executive (partner) login; also added to databases seeded before the role existed.
var executiveUser = struct{ username, name, role string }{"somchai", "สมชาย ศรีวิวัฒน์", "executive"}

// addUser creates a login with the sample password 1234; an existing username is left untouched.
func addUser(ctx context.Context, q querier, username, name, role string) error {
	hash, err := HashPassword("1234")
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO users (username, name, role, password_hash) VALUES ($1, $2, $3, $4)
	                      ON CONFLICT (username) DO NOTHING`, username, name, role, hash)
	return err
}

func setAttendance(ctx context.Context, tx pgx.Tx, periodID int, byCode map[string]map[string]float64) error {
	for code, values := range byCode {
		for _, f := range attendanceFields {
			v, ok := values[f.key]
			if !ok {
				continue
			}
			if _, err := tx.Exec(ctx, `UPDATE attendance SET `+f.key+` = $1
				WHERE period_id = $2 AND employee_id = (SELECT id FROM employees WHERE code = $3)`, v, periodID, code); err != nil {
				return err
			}
		}
	}
	return nil
}
