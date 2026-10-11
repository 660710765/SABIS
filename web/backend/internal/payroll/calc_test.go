package payroll

import "testing"

func eq(t *testing.T, name string, got, want float64) {
	t.Helper()
	if got != want {
		t.Errorf("%s = %v, want %v", name, got, want)
	}
}

func TestPeriodRange(t *testing.T) { // BR-01
	cases := []struct{ y, m, r, start, end int }{
		{2026, 10, 1, 1, 15},
		{2026, 2, 2, 16, 28},
		{2028, 2, 2, 16, 29},
	}
	for _, c := range cases {
		s, e := PeriodRange(c.y, c.m, c.r)
		if s != c.start || e != c.end {
			t.Errorf("PeriodRange(%d,%d,%d) = %d–%d, want %d–%d", c.y, c.m, c.r, s, e, c.start, c.end)
		}
	}
}

func TestWorkingDaysSkipSundays(t *testing.T) {
	// 16–31 Oct 2026: Sundays are the 18th and 25th
	if n := WorkingDays(2026, 10, 2); n != 14 {
		t.Errorf("WorkingDays = %d, want 14", n)
	}
}

func TestMonthly(t *testing.T) { // BR-04/BR-10
	r := CalcLine(Employee{"monthly", 18000}, Attendance{DaysWorked: 13, AbsentDays: 1})
	eq(t, "base", r.Base, 9000)
	eq(t, "deduction", r.Deduction, 600)
	eq(t, "net", r.Net, 8400)
}

func TestDailyWithOT(t *testing.T) { // BR-05/BR-08
	r := CalcLine(Employee{"daily", 450}, Attendance{DaysWorked: 14, OTHours: 6})
	eq(t, "base", r.Base, 6300)
	eq(t, "ot_pay", r.OTPay, 506.25) // 450/8 × 1.5 × 6
	eq(t, "deduction", r.Deduction, 0)
	eq(t, "net", r.Net, 6806.25)
}

func TestWithholding(t *testing.T) { // BR-11
	eq(t, "AnnualTax(150000)", AnnualTax(150000), 0)
	eq(t, "AnnualTax(300000)", AnnualTax(300000), 7500)
	eq(t, "AnnualTax(400000)", AnnualTax(400000), 17500)
	eq(t, "WithholdingPerRound(12000)", WithholdingPerRound(12000), 0)
	// 19,000 × 24 = 456,000 − 100,000 − 60,000 = 296,000 → (296,000 − 150,000) × 5% = 7,300 / 24
	eq(t, "WithholdingPerRound(19000)", WithholdingPerRound(19000), 304.17)
}
