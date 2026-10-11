// Payroll workflow: create round → process (UC-04) → edit with audit (UC-07)
// → submit → approve / return (UC-08) → pay (UC-09).
package store

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"genertech/payroll/internal/payroll"
)

var editable = []string{"draft", "returned"}

type Period struct {
	ID           int        `db:"id" json:"id"`
	Year         int        `db:"year" json:"year"`
	Month        int        `db:"month" json:"month"`
	Round        int        `db:"round" json:"round"`
	Status       string     `db:"status" json:"status"`
	Processed    Flag       `db:"processed" json:"processed"`
	ReturnReason *string    `db:"return_reason" json:"return_reason"`
	SubmittedBy  *string    `db:"submitted_by" json:"submitted_by"`
	SubmittedAt  *time.Time `db:"submitted_at" json:"submitted_at"`
	ApprovedBy   *string    `db:"approved_by" json:"approved_by"`
	ApprovedAt   *time.Time `db:"approved_at" json:"approved_at"`
	PaidBy       *string    `db:"paid_by" json:"paid_by"`
	PaidAt       *time.Time `db:"paid_at" json:"paid_at"`
}

// Row is one employee in a round: attendance plus the calculated line (nil until processed).
type Row struct {
	EmployeeID int      `db:"employee_id" json:"employee_id"`
	Code       string   `db:"code" json:"code"`
	Name       string   `db:"name" json:"name"`
	Bank       *string  `db:"bank" json:"bank"`
	Account    *string  `db:"account" json:"account"`
	Type       string   `db:"type" json:"type"`
	Rate       float64  `db:"rate" json:"rate"`
	DaysWorked float64  `db:"days_worked" json:"days_worked"`
	AbsentDays float64  `db:"absent_days" json:"absent_days"`
	OTHours    float64  `db:"ot_hours" json:"ot_hours"`
	Base       *float64 `db:"base" json:"base"`
	OTPay      *float64 `db:"ot_pay" json:"ot_pay"`
	Deduction  *float64 `db:"deduction" json:"deduction"`
	Tax        *float64 `db:"tax" json:"tax"`
	Net        *float64 `db:"net" json:"net"`
}

type Audit struct {
	ID           int       `db:"id" json:"id"`
	PeriodID     int       `db:"period_id" json:"period_id"`
	EmployeeID   *int      `db:"employee_id" json:"employee_id"`
	UserName     string    `db:"user_name" json:"user_name"`
	Action       string    `db:"action" json:"action"`
	Field        *string   `db:"field" json:"field"`
	OldValue     *string   `db:"old_value" json:"old_value"`
	NewValue     *string   `db:"new_value" json:"new_value"`
	Reason       *string   `db:"reason" json:"reason"`
	At           time.Time `db:"at" json:"at"`
	EmployeeCode *string   `db:"employee_code" json:"employee_code"`
	EmployeeName *string   `db:"employee_name" json:"employee_name"`
}

type Totals struct {
	Count      int     `json:"count"`
	Monthly    int     `json:"monthly"`
	Daily      int     `json:"daily"`
	MonthlyNet float64 `json:"monthlyNet"`
	DailyNet   float64 `json:"dailyNet"`
	OTHours    float64 `json:"ot_hours"`
	OTPay      float64 `json:"ot_pay"`
	Deduction  float64 `json:"deduction"`
	Tax        float64 `json:"tax"`
	Net        float64 `json:"net"`
}

type Detail struct {
	Period Period  `json:"period"`
	Rows   []Row   `json:"rows"`
	Totals Totals  `json:"totals"`
	Audit  []Audit `json:"audit"`
}

type PeriodSummary struct {
	Period
	Totals Totals `json:"totals"`
}

type logEntry struct {
	employeeID      *int
	field, from, to *string
	reason          *string
}

func ptr[T any](v T) *T { return &v }

func writeLog(ctx context.Context, q querier, periodID int, actor, action string, e logEntry) error {
	_, err := q.Exec(ctx, `INSERT INTO audit_log (period_id, employee_id, user_name, action, field, old_value, new_value, reason)
	                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		periodID, e.employeeID, actor, action, e.field, e.from, e.to, e.reason)
	return err
}

const periodCols = `id, year, month, round, status, processed, return_reason,
	submitted_by, submitted_at, approved_by, approved_at, paid_by, paid_at`

// getPeriod loads a round; lock=true holds a row lock until the transaction ends,
// so two people cannot move the same round through the workflow at once.
func getPeriod(ctx context.Context, q querier, id int, lock bool) (*Period, error) {
	sql := `SELECT ` + periodCols + ` FROM periods WHERE id = $1`
	if lock {
		sql += ` FOR UPDATE`
	}
	p, err := one[Period](ctx, q, sql, id)
	if err == nil && p == nil {
		err = appErr(404, "ไม่พบรอบการจ่ายนี้")
	}
	return p, err
}

func (s *Store) GetPeriod(ctx context.Context, id int) (*Period, error) {
	return getPeriod(ctx, s.pool, id, false)
}

func (s *Store) FindPeriod(ctx context.Context, year, month, round int) (*Period, error) {
	return one[Period](ctx, s.pool, `SELECT `+periodCols+` FROM periods WHERE year = $1 AND month = $2 AND round = $3`, year, month, round)
}

func (s *Store) ListPeriods(ctx context.Context, statuses []string) ([]PeriodSummary, error) {
	periods, err := collect[Period](ctx, s.pool,
		`SELECT `+periodCols+` FROM periods WHERE status = ANY($1) ORDER BY year DESC, month DESC, round DESC`, statuses)
	if err != nil {
		return nil, err
	}
	out := make([]PeriodSummary, 0, len(periods))
	for _, p := range periods {
		rows, err := periodRows(ctx, s.pool, p.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, PeriodSummary{Period: p, Totals: totals(rows)})
	}
	return out, nil
}

func (s *Store) CreatePeriod(ctx context.Context, year, month, round int, actor string) (id int, err error) {
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		id, err = createPeriod(ctx, tx, year, month, round, actor)
		return err
	})
	return id, err
}

func createPeriod(ctx context.Context, q querier, year, month, round int, actor string) (int, error) {
	if year < 2000 || year > 2100 {
		return 0, appErr(400, "ปีไม่ถูกต้อง")
	}
	if month < 1 || month > 12 {
		return 0, appErr(400, "เดือนไม่ถูกต้อง")
	}
	if round != 1 && round != 2 {
		return 0, appErr(400, "รอบการจ่ายต้องเป็น 1 หรือ 2")
	}
	var id int
	err := q.QueryRow(ctx, `INSERT INTO periods (year, month, round) VALUES ($1, $2, $3) RETURNING id`, year, month, round).Scan(&id)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
		return 0, appErr(409, "มีรอบการจ่ายนี้อยู่แล้ว")
	}
	if err != nil {
		return 0, err
	}
	if _, err := q.Exec(ctx, `INSERT INTO attendance (period_id, employee_id, days_worked)
	                          SELECT $1, id, $2 FROM employees WHERE active`, id, payroll.WorkingDays(year, month, round)); err != nil {
		return 0, err
	}
	return id, writeLog(ctx, q, id, actor, "create", logEntry{})
}

func computeLine(ctx context.Context, q querier, periodID, employeeID int) error {
	var emp payroll.Employee
	var att payroll.Attendance
	err := q.QueryRow(ctx, `SELECT e.type, e.rate, a.days_worked, a.absent_days, a.ot_hours
	                        FROM attendance a JOIN employees e ON e.id = a.employee_id
	                        WHERE a.period_id = $1 AND a.employee_id = $2`, periodID, employeeID).
		Scan(&emp.Type, &emp.Rate, &att.DaysWorked, &att.AbsentDays, &att.OTHours)
	if err != nil {
		return err
	}
	r := payroll.CalcLine(emp, att)
	_, err = q.Exec(ctx, `
		INSERT INTO payroll_lines (period_id, employee_id, type, rate, base, ot_pay, deduction, tax, net)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (period_id, employee_id) DO UPDATE SET
		  type = EXCLUDED.type, rate = EXCLUDED.rate, base = EXCLUDED.base, ot_pay = EXCLUDED.ot_pay,
		  deduction = EXCLUDED.deduction, tax = EXCLUDED.tax, net = EXCLUDED.net`,
		periodID, employeeID, emp.Type, emp.Rate, r.Base, r.OTPay, r.Deduction, r.Tax, r.Net)
	return err
}

func (s *Store) ProcessPeriod(ctx context.Context, id int, actor string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error { return processPeriod(ctx, tx, id, actor) })
}

func processPeriod(ctx context.Context, q querier, id int, actor string) error {
	p, err := getPeriod(ctx, q, id, true)
	if err != nil {
		return err
	}
	if !slices.Contains(editable, p.Status) {
		return appErr(409, `ประมวลผลได้เฉพาะรอบที่อยู่ในสถานะ "ร่าง" หรือ "ส่งกลับแก้ไข"`)
	}
	rows, err := q.Query(ctx, `SELECT employee_id FROM attendance WHERE period_id = $1`, id)
	if err != nil {
		return err
	}
	emps, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		return err
	}
	if len(emps) == 0 {
		return appErr(409, "ยังไม่มีข้อมูลเวลาทำงานในรอบนี้")
	}
	for _, e := range emps {
		if err := computeLine(ctx, q, id, e); err != nil {
			return err
		}
	}
	if _, err := q.Exec(ctx, `UPDATE periods SET processed = TRUE WHERE id = $1`, id); err != nil {
		return err
	}
	return writeLog(ctx, q, id, actor, "process", logEntry{})
}

// Attendance fields that can be edited, in the order they are checked.
var attendanceFields = []struct{ key, label string }{
	{"days_worked", "วันทำงาน"},
	{"absent_days", "ขาดงาน (วัน)"},
	{"ot_hours", "OT (ชม.)"},
}

// UpdateAttendance — UC-07: every change needs a reason and is written to the audit log.
// values holds the new numbers by field key; missing keys are left unchanged.
func (s *Store) UpdateAttendance(ctx context.Context, id, employeeID int, values map[string]float64, reason, actor string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		p, err := getPeriod(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if p.Status == "paid" {
			return appErr(409, "ไม่อนุญาตให้แก้ไขเนื่องจากมีการจ่ายเงินเรียบร้อยแล้ว")
		}
		if !slices.Contains(editable, p.Status) {
			return appErr(409, `แก้ไขได้เฉพาะรอบที่อยู่ในสถานะ "ร่าง" หรือ "ส่งกลับแก้ไข"`)
		}
		why := strings.TrimSpace(reason)
		if why == "" {
			return appErr(400, "กรุณาระบุเหตุผลในการแก้ไข")
		}

		cur := map[string]float64{}
		var a, b, c float64
		err = tx.QueryRow(ctx, `SELECT days_worked, absent_days, ot_hours FROM attendance WHERE period_id = $1 AND employee_id = $2`,
			id, employeeID).Scan(&a, &b, &c)
		if errors.Is(err, pgx.ErrNoRows) {
			return appErr(404, "ไม่พบพนักงานในรอบนี้")
		} else if err != nil {
			return err
		}
		cur["days_worked"], cur["absent_days"], cur["ot_hours"] = a, b, c

		start, end := payroll.PeriodRange(p.Year, p.Month, p.Round)
		maxDays := float64(end - start + 1)
		type change struct {
			key, label string
			from, to   float64
		}
		var changes []change
		next := map[string]float64{}
		for _, f := range attendanceFields {
			next[f.key] = cur[f.key]
			v, ok := values[f.key]
			if !ok {
				continue
			}
			v = payroll.Round2(v) // columns hold 2 decimals
			if v < 0 {
				return appErr(400, "%s ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป", f.label)
			}
			if f.key != "ot_hours" && v > maxDays {
				return appErr(400, "%s ต้องไม่เกิน %v วันในรอบนี้", f.label, maxDays)
			}
			if f.key == "ot_hours" && v > maxDays*12 {
				return appErr(400, "ชั่วโมง OT มากเกินกว่าที่เป็นไปได้ในรอบนี้")
			}
			if v != cur[f.key] {
				changes = append(changes, change{f.key, f.label, cur[f.key], v})
				next[f.key] = v
			}
		}
		if next["days_worked"]+next["absent_days"] > maxDays {
			return appErr(400, "วันทำงานรวมวันขาดงานต้องไม่เกิน %v วัน", maxDays)
		}
		if len(changes) == 0 {
			return appErr(400, "ไม่มีข้อมูลที่เปลี่ยนแปลง")
		}

		for _, ch := range changes {
			// ch.key comes from attendanceFields, never from the request.
			if _, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE attendance SET %s = $1 WHERE period_id = $2 AND employee_id = $3`, ch.key),
				ch.to, id, employeeID); err != nil {
				return err
			}
			if err := writeLog(ctx, tx, id, actor, "edit", logEntry{
				employeeID: &employeeID, field: ptr(ch.label), reason: &why,
				from: ptr(num(ch.from)), to: ptr(num(ch.to)),
			}); err != nil {
				return err
			}
		}
		if p.Processed {
			return computeLine(ctx, tx, id, employeeID)
		}
		return nil
	})
}

func num(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

func (s *Store) SubmitPeriod(ctx context.Context, id int, actor string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		p, err := getPeriod(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if !slices.Contains(editable, p.Status) {
			return appErr(409, `ส่งอนุมัติได้เฉพาะรอบที่อยู่ในสถานะ "ร่าง" หรือ "ส่งกลับแก้ไข"`)
		}
		if !p.Processed {
			return appErr(409, "ต้องประมวลผลเงินเดือนก่อนส่งอนุมัติ")
		}
		if _, err := tx.Exec(ctx, `UPDATE periods SET status = 'pending', submitted_by = $1, submitted_at = now() WHERE id = $2`, actor, id); err != nil {
			return err
		}
		return writeLog(ctx, tx, id, actor, "submit", logEntry{})
	})
}

// ApprovePeriod — BR-12: only a processed round checked by accounting reaches the manager.
func (s *Store) ApprovePeriod(ctx context.Context, id int, actor string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		p, err := getPeriod(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if p.Status != "pending" {
			return appErr(409, `อนุมัติได้เฉพาะรอบที่อยู่ในสถานะ "รออนุมัติ"`)
		}
		if _, err := tx.Exec(ctx, `UPDATE periods SET status = 'approved', approved_by = $1, approved_at = now(), return_reason = NULL WHERE id = $2`, actor, id); err != nil {
			return err
		}
		return writeLog(ctx, tx, id, actor, "approve", logEntry{})
	})
}

// ReturnPeriod — BR-13: the manager can send a round back until it is paid; it must be approved again.
func (s *Store) ReturnPeriod(ctx context.Context, id int, reason, actor string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		p, err := getPeriod(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if p.Status != "pending" && p.Status != "approved" {
			return appErr(409, "ส่งกลับแก้ไขได้เฉพาะรอบที่รออนุมัติหรืออนุมัติแล้วแต่ยังไม่จ่าย")
		}
		why := strings.TrimSpace(reason)
		if why == "" {
			return appErr(400, "กรุณาระบุเหตุผลที่ส่งกลับแก้ไข")
		}
		if _, err := tx.Exec(ctx, `UPDATE periods SET status = 'returned', return_reason = $1, approved_by = NULL, approved_at = NULL WHERE id = $2`, why, id); err != nil {
			return err
		}
		return writeLog(ctx, tx, id, actor, "return", logEntry{reason: &why})
	})
}

func (s *Store) PayPeriod(ctx context.Context, id int, actor string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		p, err := getPeriod(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if p.Status != "approved" {
			return appErr(409, "ต้องรอการอนุมัติจากผู้จัดการก่อนจึงจะสามารถจ่ายเงินได้")
		}
		if _, err := tx.Exec(ctx, `UPDATE periods SET status = 'paid', paid_by = $1, paid_at = now() WHERE id = $2`, actor, id); err != nil {
			return err
		}
		return writeLog(ctx, tx, id, actor, "pay", logEntry{})
	})
}

func periodRows(ctx context.Context, q querier, id int) ([]Row, error) {
	return collect[Row](ctx, q, `
		SELECT e.id AS employee_id, e.code, e.name, e.bank, e.account,
		       COALESCE(l.type, e.type) AS type, COALESCE(l.rate, e.rate) AS rate,
		       a.days_worked, a.absent_days, a.ot_hours,
		       l.base, l.ot_pay, l.deduction, l.tax, l.net
		FROM attendance a
		JOIN employees e ON e.id = a.employee_id
		LEFT JOIN payroll_lines l ON l.period_id = a.period_id AND l.employee_id = a.employee_id
		WHERE a.period_id = $1
		ORDER BY COALESCE(l.type, e.type) DESC, e.code`, id)
}

func (s *Store) PeriodDetail(ctx context.Context, id int) (*Detail, error) {
	p, err := getPeriod(ctx, s.pool, id, false)
	if err != nil {
		return nil, err
	}
	rows, err := periodRows(ctx, s.pool, id)
	if err != nil {
		return nil, err
	}
	audit, err := collect[Audit](ctx, s.pool, `
		SELECT a.id, a.period_id, a.employee_id, a.user_name, a.action, a.field, a.old_value, a.new_value,
		       a.reason, a.at, e.code AS employee_code, e.name AS employee_name
		FROM audit_log a LEFT JOIN employees e ON e.id = a.employee_id
		WHERE a.period_id = $1 ORDER BY a.id DESC`, id)
	if err != nil {
		return nil, err
	}
	return &Detail{Period: *p, Rows: rows, Totals: totals(rows), Audit: audit}, nil
}

func val(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func totals(rows []Row) Totals {
	t := Totals{Count: len(rows)}
	for _, r := range rows {
		net := val(r.Net)
		if r.Type == "monthly" {
			t.Monthly++
			t.MonthlyNet += net
		} else {
			t.Daily++
			t.DailyNet += net
		}
		t.OTHours += r.OTHours
		t.OTPay += val(r.OTPay)
		t.Deduction += val(r.Deduction)
		t.Tax += val(r.Tax)
		t.Net += net
	}
	for _, f := range []*float64{&t.OTHours, &t.OTPay, &t.Deduction, &t.Tax, &t.Net, &t.MonthlyNet, &t.DailyNet} {
		*f = payroll.Round2(*f)
	}
	return t
}

// BankFile — UC-09 / BR-03: transfer file for monthly staff only (daily staff are paid in cash).
func (s *Store) BankFile(ctx context.Context, id int) (*Period, string, error) {
	p, err := getPeriod(ctx, s.pool, id, false)
	if err != nil {
		return nil, "", err
	}
	if p.Status != "approved" && p.Status != "paid" {
		return nil, "", appErr(409, "ต้องรอการอนุมัติจากผู้จัดการก่อนจึงจะสามารถจ่ายเงินได้")
	}
	rows, err := periodRows(ctx, s.pool, id)
	if err != nil {
		return nil, "", err
	}
	q := func(s *string) string {
		v := ""
		if s != nil {
			v = *s
		}
		return `"` + strings.ReplaceAll(v, `"`, `""`) + `"`
	}
	var b strings.Builder
	b.WriteRune(0xFEFF) // BOM so Excel opens the Thai text as UTF-8
	b.WriteString("employee_code,name,bank,account,amount\r\n")
	for _, r := range rows {
		if r.Type != "monthly" {
			continue
		}
		fmt.Fprintf(&b, "%s,%s,%s,%s,%.2f\r\n", q(&r.Code), q(&r.Name), q(r.Bank), q(r.Account), val(r.Net))
	}
	return p, b.String(), nil
}

type Payslip struct {
	PeriodID   int        `db:"period_id" json:"period_id"`
	Year       int        `db:"year" json:"year"`
	Month      int        `db:"month" json:"month"`
	Round      int        `db:"round" json:"round"`
	Status     string     `db:"status" json:"status"`
	PaidAt     *time.Time `db:"paid_at" json:"paid_at"`
	Type       string     `db:"type" json:"type"`
	Rate       float64    `db:"rate" json:"rate"`
	Base       float64    `db:"base" json:"base"`
	OTPay      float64    `db:"ot_pay" json:"ot_pay"`
	Deduction  float64    `db:"deduction" json:"deduction"`
	Tax        float64    `db:"tax" json:"tax"`
	Net        float64    `db:"net" json:"net"`
	DaysWorked float64    `db:"days_worked" json:"days_worked"`
	AbsentDays float64    `db:"absent_days" json:"absent_days"`
	OTHours    float64    `db:"ot_hours" json:"ot_hours"`
}

func (s *Store) Payslips(ctx context.Context, employeeID int) ([]Payslip, error) {
	return collect[Payslip](ctx, s.pool, `
		SELECT p.id AS period_id, p.year, p.month, p.round, p.status, p.paid_at,
		       l.type, l.rate, l.base, l.ot_pay, l.deduction, l.tax, l.net,
		       a.days_worked, a.absent_days, a.ot_hours
		FROM payroll_lines l
		JOIN periods p ON p.id = l.period_id
		JOIN attendance a ON a.period_id = l.period_id AND a.employee_id = l.employee_id
		WHERE l.employee_id = $1 AND p.status IN ('approved', 'paid')
		ORDER BY p.year DESC, p.month DESC, p.round DESC`, employeeID)
}
