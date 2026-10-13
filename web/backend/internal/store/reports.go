// Executive payroll-cost summary: totals per round only — never per employee (BR-14).
package store

import (
	"context"
	"time"
)

// CostTotals is the payroll cost of one round (or a whole year), summed over all staff.
type CostTotals struct {
	Employees  int     `db:"employees" json:"employees"`
	Monthly    int     `db:"monthly" json:"monthly"`
	Daily      int     `db:"daily" json:"daily"`
	Base       float64 `db:"base" json:"base"`
	OTPay      float64 `db:"ot_pay" json:"ot_pay"`
	Deduction  float64 `db:"deduction" json:"deduction"`
	Gross      float64 `db:"gross" json:"gross"` // base + OT − absence deduction (before tax)
	Tax        float64 `db:"tax" json:"tax"`
	Net        float64 `db:"net" json:"net"`
	MonthlyNet float64 `db:"monthly_net" json:"monthly_net"` // bank transfer
	DailyNet   float64 `db:"daily_net" json:"daily_net"`     // cash
}

type RoundCost struct {
	PeriodID int        `db:"period_id" json:"period_id"`
	Year     int        `db:"year" json:"year"`
	Month    int        `db:"month" json:"month"`
	Round    int        `db:"round" json:"round"`
	Status   string     `db:"status" json:"status"`
	PaidAt   *time.Time `db:"paid_at" json:"paid_at"`
	CostTotals
}

type CostSummary struct {
	Years  []int       `json:"years"` // years that have approved/paid rounds, newest first
	Year   int         `json:"year"`  // year shown (0 when there is no data yet)
	Rounds []RoundCost `json:"rounds"`
	Total  CostTotals  `json:"total"` // whole selected year
}

// costCols sums payroll_lines l; count is the headcount expression (COUNT(*) per round,
// COUNT(DISTINCT l.employee_id) for a year so a person paid in many rounds counts once).
func costCols(count string) string {
	return count + ` AS employees,
	  ` + count + ` FILTER (WHERE l.type = 'monthly') AS monthly,
	  ` + count + ` FILTER (WHERE l.type = 'daily') AS daily,
	  COALESCE(SUM(l.base), 0) AS base,
	  COALESCE(SUM(l.ot_pay), 0) AS ot_pay,
	  COALESCE(SUM(l.deduction), 0) AS deduction,
	  COALESCE(SUM(l.base + l.ot_pay - l.deduction), 0) AS gross,
	  COALESCE(SUM(l.tax), 0) AS tax,
	  COALESCE(SUM(l.net), 0) AS net,
	  COALESCE(SUM(l.net) FILTER (WHERE l.type = 'monthly'), 0) AS monthly_net,
	  COALESCE(SUM(l.net) FILTER (WHERE l.type = 'daily'), 0) AS daily_net`
}

// CostSummary returns the cost of every approved or paid round in year (0 = latest year with data).
// Draft, returned and pending rounds are left out: their figures are not final yet.
func (s *Store) CostSummary(ctx context.Context, year int) (*CostSummary, error) {
	years, err := collect[struct {
		Year int `db:"year"`
	}](ctx, s.pool, `SELECT DISTINCT year FROM periods WHERE status IN ('approved', 'paid') ORDER BY year DESC`)
	if err != nil {
		return nil, err
	}
	out := &CostSummary{Years: make([]int, len(years)), Rounds: []RoundCost{}}
	for i, y := range years {
		out.Years[i] = y.Year
	}
	if year == 0 && len(out.Years) > 0 {
		year = out.Years[0]
	}
	out.Year = year
	if year == 0 {
		return out, nil
	}

	out.Rounds, err = collect[RoundCost](ctx, s.pool, `
		SELECT p.id AS period_id, p.year, p.month, p.round, p.status, p.paid_at, `+costCols("COUNT(*)")+`
		FROM periods p JOIN payroll_lines l ON l.period_id = p.id
		WHERE p.status IN ('approved', 'paid') AND p.year = $1
		GROUP BY p.id
		ORDER BY p.month DESC, p.round DESC`, year)
	if err != nil {
		return nil, err
	}
	total, err := one[CostTotals](ctx, s.pool, `
		SELECT `+costCols("COUNT(DISTINCT l.employee_id)")+`
		FROM periods p JOIN payroll_lines l ON l.period_id = p.id
		WHERE p.status IN ('approved', 'paid') AND p.year = $1`, year)
	if err != nil {
		return nil, err
	}
	out.Total = *total
	return out, nil
}
