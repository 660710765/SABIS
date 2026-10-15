package store

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"genertech/payroll/internal/payroll"
)

// openTest opens the store in a throw-away schema of TEST_DATABASE_URL, so tests
// never touch real tables. Skipped when TEST_DATABASE_URL is not set.
func openTest(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping PostgreSQL tests")
	}
	ctx := context.Background()
	schema := fmt.Sprintf("payroll_test_%d", time.Now().UnixNano())

	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close(ctx)
	})

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	s, err := Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

func wantErr(t *testing.T, err error, contains string) {
	t.Helper()
	var ae *AppError
	if !errors.As(err, &ae) {
		t.Fatalf("want AppError containing %q, got %v", contains, err)
	}
	if !strings.Contains(ae.Message, contains) {
		t.Fatalf("want error containing %q, got %q", contains, ae.Message)
	}
}

func employeeID(t *testing.T, s *Store, code string) int {
	t.Helper()
	var id int
	if err := s.pool.QueryRow(context.Background(), "SELECT id FROM employees WHERE code = $1", code).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

const accountant, manager = "บัญชีทดสอบ", "ผู้จัดการทดสอบ"

func TestWorkflow(t *testing.T) { // process → edit with audit → submit → return → approve → pay
	s := openTest(t)
	ctx := context.Background()
	id, err := s.CreatePeriod(ctx, 2026, 11, 1, accountant)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.CreatePeriod(ctx, 2026, 11, 1, accountant)
	wantErr(t, err, "มีรอบการจ่ายนี้อยู่แล้ว")

	wantErr(t, s.SubmitPeriod(ctx, id, accountant), "ประมวลผล")
	if err := s.ProcessPeriod(ctx, id, accountant); err != nil {
		t.Fatal(err)
	}

	emp := employeeID(t, s, "EMP-0142")
	wantErr(t, s.UpdateAttendance(ctx, id, emp, map[string]float64{"ot_hours": 2}, "", accountant), "เหตุผล")
	if err := s.UpdateAttendance(ctx, id, emp, map[string]float64{"ot_hours": 2}, "ทำ OT วันที่ 3", accountant); err != nil {
		t.Fatal(err)
	}
	d, err := s.PeriodDetail(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range d.Rows {
		if r.EmployeeID == emp && (r.OTPay == nil || *r.OTPay != 168.75) {
			t.Errorf("ot_pay after edit = %v, want 168.75", r.OTPay) // recalculated right after the edit
		}
	}
	edits := 0
	for _, a := range d.Audit {
		if a.Action == "edit" {
			edits++
		}
	}
	if edits != 1 {
		t.Errorf("edit audit entries = %d, want 1", edits)
	}

	wantErr(t, s.PayPeriod(ctx, id, accountant), "อนุมัติ")
	if err := s.SubmitPeriod(ctx, id, accountant); err != nil {
		t.Fatal(err)
	}
	wantErr(t, s.UpdateAttendance(ctx, id, emp, map[string]float64{"ot_hours": 3}, "x", accountant), "แก้ไขได้เฉพาะ")

	if err := s.ReturnPeriod(ctx, id, "OT ไม่ตรง", manager); err != nil {
		t.Fatal(err)
	}
	if p, _ := s.GetPeriod(ctx, id); p.Status != "returned" {
		t.Fatalf("status = %s, want returned", p.Status)
	}
	if err := s.SubmitPeriod(ctx, id, accountant); err != nil {
		t.Fatal(err)
	}
	if err := s.ApprovePeriod(ctx, id, manager); err != nil {
		t.Fatal(err)
	}
	_, csv, err := s.BankFile(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(csv, "EMP-0101") || strings.Contains(csv, "EMP-0142") {
		t.Errorf("bank file must list monthly staff only (daily staff are paid in cash):\n%s", csv)
	}
	if err := s.PayPeriod(ctx, id, accountant); err != nil {
		t.Fatal(err)
	}

	wantErr(t, s.UpdateAttendance(ctx, id, emp, map[string]float64{"ot_hours": 3}, "x", accountant), "จ่ายเงินเรียบร้อยแล้ว")
	slips, err := s.Payslips(ctx, emp)
	if err != nil {
		t.Fatal(err)
	}
	if len(slips) == 0 || slips[0].PeriodID != id {
		t.Errorf("latest payslip = %+v, want period %d", slips, id)
	}
}

func TestSeedMatchesDesignFigures(t *testing.T) { // October round 2 after processing
	s := openTest(t)
	ctx := context.Background()
	p, err := s.FindPeriod(ctx, 2026, 10, 2)
	if err != nil || p == nil {
		t.Fatalf("seed period: %v %v", p, err)
	}
	if err := s.ProcessPeriod(ctx, p.ID, accountant); err != nil {
		t.Fatal(err)
	}
	d, err := s.PeriodDetail(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if d.Totals.Count != 6 || d.Totals.DailyNet != 18356.25 {
		t.Errorf("totals = %+v, want count 6 and dailyNet 18356.25", d.Totals)
	}
}

func TestLoginAndEmployees(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	_, _, err := s.Login(ctx, "somsri", "wrong", time.Hour)
	wantErr(t, err, "ไม่ถูกต้อง")
	u, token, err := s.Login(ctx, "somsri", "1234", time.Hour)
	if err != nil || u.Role != "accountant" {
		t.Fatalf("login: %v %v", u, err)
	}
	if su, err := s.SessionUser(ctx, token, time.Hour); err != nil || su == nil || su.ID != u.ID {
		t.Fatalf("session user: %v %v", su, err)
	}

	_, err = s.CreateEmployee(ctx, EmployeeInput{Name: "ทดสอบ", Type: "monthly", Rate: 20000})
	wantErr(t, err, "à¹à¸¥à¸à¸à¸±à¸à¸à¸µ")
	e, err := s.CreateEmployee(ctx, EmployeeInput{Name: "ทดสอบ ระบบ", Type: "daily", Rate: 500})
	if err != nil || e.Code != "EMP-0164" {
		t.Fatalf("create employee: %+v %v", e, err)
	}
	if _, _, err := s.Login(ctx, "EMP-0164", "1234", time.Hour); err != nil {
		t.Errorf("new employee login: %v", err)
	}

	if err := s.Logout(ctx, token); err != nil {
		t.Fatal(err)
	}
	if su, _ := s.SessionUser(ctx, token, time.Hour); su != nil {
		t.Error("session still valid after logout")
	}
}

// Executive report: only approved/paid rounds count, and totals match the round detail.
func TestCostSummary(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	paid, err := s.FindPeriod(ctx, 2026, 10, 1) // seeded as paid
	if err != nil || paid == nil {
		t.Fatalf("seed period: %v %v", paid, err)
	}
	draft, _ := s.FindPeriod(ctx, 2026, 10, 2) // processed but still draft
	if err := s.ProcessPeriod(ctx, draft.ID, accountant); err != nil {
		t.Fatal(err)
	}
	nov, err := s.CreatePeriod(ctx, 2026, 11, 1, accountant) // processed and pending
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ProcessPeriod(ctx, nov, accountant); err != nil {
		t.Fatal(err)
	}
	if err := s.SubmitPeriod(ctx, nov, accountant); err != nil {
		t.Fatal(err)
	}

	sum, err := s.CostSummary(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if sum.Year != 2026 || len(sum.Rounds) != 1 || sum.Rounds[0].PeriodID != paid.ID {
		t.Fatalf("summary = %+v, want only the paid round %d of 2026", sum, paid.ID)
	}
	d, err := s.PeriodDetail(ctx, paid.ID)
	if err != nil {
		t.Fatal(err)
	}
	var base float64
	for _, r := range d.Rows {
		base += val(r.Base)
	}
	got, want := sum.Rounds[0].CostTotals, d.Totals
	if got.Employees != want.Count || got.Monthly != want.Monthly || got.Daily != want.Daily ||
		got.Base != payroll.Round2(base) || got.OTPay != want.OTPay || got.Deduction != want.Deduction || got.Tax != want.Tax ||
		got.Net != want.Net || got.MonthlyNet != want.MonthlyNet || got.DailyNet != want.DailyNet ||
		got.Gross != payroll.Round2(got.Base+got.OTPay-got.Deduction) {
		t.Errorf("round totals = %+v, want %+v (base %v)", got, want, base)
	}
	if sum.Total != got {
		t.Errorf("year total = %+v, want the single round %+v", sum.Total, got)
	}

	// Once approved, November counts too; a person paid in both rounds is one head in the year total.
	if err := s.ApprovePeriod(ctx, nov, manager); err != nil {
		t.Fatal(err)
	}
	sum, err = s.CostSummary(ctx, 2026)
	if err != nil {
		t.Fatal(err)
	}
	if len(sum.Rounds) != 2 || sum.Rounds[0].PeriodID != nov {
		t.Fatalf("rounds = %+v, want November first then October", sum.Rounds)
	}
	if sum.Total.Employees != 6 || sum.Total.Net != payroll.Round2(sum.Rounds[0].Net+sum.Rounds[1].Net) {
		t.Errorf("year total = %+v, want 6 people and the sum of both rounds", sum.Total)
	}

	if empty, err := s.CostSummary(ctx, 2025); err != nil || len(empty.Rounds) != 0 || empty.Total.Net != 0 {
		t.Errorf("year without rounds: %+v %v", empty, err)
	}

	if u, _, err := s.Login(ctx, "somchai", "1234", time.Hour); err != nil || u.Role != "executive" {
		t.Errorf("executive login: %v %v", u, err)
	}
}
