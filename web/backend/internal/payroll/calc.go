// Package payroll holds the payroll calculation rules (pure functions, no I/O).
// Business rules referenced from the requirements document: BR-01 … BR-11.
package payroll

import (
	"math"
	"time"
)

const (
	OTMultiplier  = 1.5 // OT on a normal working day = 1.5x hourly rate
	HoursPerDay   = 8
	DaysPerMonth  = 30 // monthly salary / 30 = daily rate for deductions
	RoundsPerYear = 24 // BR-01: two rounds per month
)

// Round2 rounds half up to 2 decimals (same as Math.round(n*100)/100 on the old server).
func Round2(n float64) float64 {
	return math.Floor((n+1e-9)*100+0.5) / 100
}

// LastDay is the last day of the month.
func LastDay(year, month int) int {
	return time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// PeriodRange — BR-01: round 1 = day 1–15, round 2 = day 16–last day of month.
func PeriodRange(year, month, round int) (start, end int) {
	if round == 1 {
		return 1, 15
	}
	return 16, LastDay(year, month)
}

// WorkingDays in the round (Sunday is the weekly holiday).
func WorkingDays(year, month, round int) int {
	start, end := PeriodRange(year, month, round)
	n := 0
	for d := start; d <= end; d++ {
		if time.Date(year, time.Month(month), d, 0, 0, 0, 0, time.UTC).Weekday() != time.Sunday {
			n++
		}
	}
	return n
}

// Thai personal income tax, progressive rates on annual net income.
var brackets = []struct{ ceiling, rate float64 }{
	{150000, 0}, {300000, 0.05}, {500000, 0.10}, {750000, 0.15},
	{1000000, 0.20}, {2000000, 0.25}, {5000000, 0.30}, {math.Inf(1), 0.35},
}

func AnnualTax(taxable float64) float64 {
	tax, floor := 0.0, 0.0
	for _, b := range brackets {
		if taxable <= floor {
			break
		}
		tax += (math.Min(taxable, b.ceiling) - floor) * b.rate
		floor = b.ceiling
	}
	return tax
}

// WithholdingPerRound — BR-11: annualised income → progressive tax → split over 24 rounds.
// Deductions: employment expense 50% (max 100,000) and personal allowance 60,000.
func WithholdingPerRound(grossThisRound float64) float64 {
	if grossThisRound <= 0 {
		return 0
	}
	annual := grossThisRound * RoundsPerYear
	expense := math.Min(annual*0.5, 100000)
	taxable := math.Max(0, annual-expense-60000)
	return Round2(AnnualTax(taxable) / RoundsPerYear)
}

type Employee struct {
	Type string  // "monthly" | "daily"
	Rate float64 // monthly salary or daily wage
}

type Attendance struct {
	DaysWorked, AbsentDays, OTHours float64
}

type Line struct {
	Base, OTPay, Deduction, Tax, Net float64
}

// CalcLine is one employee's pay for one round.
func CalcLine(emp Employee, att Attendance) Line {
	var base, deduction, hourly float64
	if emp.Type == "monthly" {
		base = Round2(emp.Rate / 2)                                  // BR-04: half salary per round
		deduction = Round2(emp.Rate / DaysPerMonth * att.AbsentDays) // BR-10: absence deducted
		hourly = emp.Rate / DaysPerMonth / HoursPerDay
	} else {
		base = Round2(emp.Rate * att.DaysWorked) // BR-05: days actually worked
		deduction = 0                            // BR-10: absent days are simply not paid
		hourly = emp.Rate / HoursPerDay
	}

	otPay := Round2(hourly * OTMultiplier * att.OTHours) // BR-08
	gross := Round2(math.Max(0, base+otPay-deduction))
	tax := WithholdingPerRound(gross) // BR-11
	return Line{Base: base, OTPay: otPay, Deduction: deduction, Tax: tax, Net: Round2(gross - tax)}
}
