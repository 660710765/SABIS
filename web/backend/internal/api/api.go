// Package api is the HTTP JSON API used by the React frontend.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"genertech/payroll/internal/store"
)

const sessionTTL = 8 * time.Hour

type Server struct {
	db *store.Store
}

type handler func(w http.ResponseWriter, r *http.Request, u *store.User) error

var errUnauthorized = &store.AppError{Status: 401, Message: "กรุณาเข้าสู่ระบบ"}

// New returns the API router. BR-14: payroll amounts are visible only to accounting
// and the approving manager; employees only reach their own payslips.
func New(db *store.Store) http.Handler {
	s := &Server{db: db}
	const acc, mgr, emp = "accountant", "manager", "employee"
	mux := http.NewServeMux()
	route := func(pattern string, h handler, roles ...string) {
		mux.Handle(pattern, s.wrap(h, roles))
	}

	route("POST /api/login", s.login)
	route("POST /api/logout", s.logout)
	route("GET /api/me", s.me, acc, mgr, emp)

	route("GET /api/periods", s.periods, acc, mgr)
	route("POST /api/periods", s.createPeriod, acc)
	route("GET /api/periods/{id}", s.periodDetail, acc, mgr)
	route("PATCH /api/periods/{id}/attendance/{emp}", s.updateAttendance, acc)
	route("POST /api/periods/{id}/process", s.transition((*store.Store).ProcessPeriod), acc)
	route("POST /api/periods/{id}/submit", s.transition((*store.Store).SubmitPeriod), acc)
	route("POST /api/periods/{id}/pay", s.transition((*store.Store).PayPeriod), acc)
	route("POST /api/periods/{id}/approve", s.transition((*store.Store).ApprovePeriod), mgr)
	route("POST /api/periods/{id}/return", s.returnPeriod, mgr)
	route("GET /api/periods/{id}/bank-file", s.bankFile, acc)

	route("GET /api/my/payslips", s.myPayslips, emp)

	route("GET /api/employees", s.employees, acc)
	route("PATCH /api/employees/{id}", s.updateEmployee, acc)

	route("/api/", func(http.ResponseWriter, *http.Request, *store.User) error {
		return &store.AppError{Status: 404, Message: "ไม่พบ API นี้"}
	})
	return mux
}

// wrap adds the CSRF guard, session lookup, role check, and error → JSON mapping.
func (s *Server) wrap(h handler, roles []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := func() error {
			// Basic CSRF guard: state-changing API calls must come from this site as JSON.
			if r.Method != http.MethodGet && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				return &store.AppError{Status: 415, Message: "ต้องส่งข้อมูลแบบ JSON"}
			}
			r.Body = http.MaxBytesReader(w, r.Body, 100_000)
			u, err := s.currentUser(r)
			if err != nil {
				return err
			}
			if len(roles) > 0 {
				if u == nil {
					return errUnauthorized
				}
				if !slices.Contains(roles, u.Role) {
					return &store.AppError{Status: 403, Message: "คุณไม่มีสิทธิ์ใช้งานส่วนนี้"}
				}
			}
			return h(w, r, u)
		}()
		if err == nil {
			return
		}
		var ae *store.AppError
		if errors.As(err, &ae) {
			writeJSON(w, ae.Status, map[string]string{"error": ae.Message})
			return
		}
		log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
		writeJSON(w, 500, map[string]string{"error": "เกิดข้อผิดพลาดภายในระบบ"})
	})
}

func sessionToken(r *http.Request) string {
	c, err := r.Cookie("sid")
	if err != nil || len(c.Value) != 64 {
		return ""
	}
	return c.Value
}

func (s *Server) currentUser(r *http.Request) (*store.User, error) {
	token := sessionToken(r)
	if token == "" {
		return nil, nil
	}
	return s.db.SessionUser(r.Context(), token, sessionTTL)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("write response: %v", err)
	}
}

// readBody decodes the JSON body into a loose map; the frontend sends numbers
// from form inputs as strings, so fields are converted with the helpers below.
func readBody(r *http.Request) (map[string]any, error) {
	b := map[string]any{}
	err := json.NewDecoder(r.Body).Decode(&b)
	var tooBig *http.MaxBytesError
	switch {
	case err == nil || errors.Is(err, io.EOF):
		return b, nil
	case errors.As(err, &tooBig):
		return nil, &store.AppError{Status: 413, Message: "ข้อมูลมีขนาดใหญ่เกินไป"}
	default:
		return nil, &store.AppError{Status: 400, Message: "รูปแบบข้อมูลไม่ถูกต้อง"}
	}
}

// number reads a JSON number or numeric string; ok=false when absent, null or "".
func number(v any) (f float64, ok bool, err error) {
	switch x := v.(type) {
	case nil:
		return 0, false, nil
	case float64:
		return x, true, nil
	case bool:
		if x {
			return 1, true, nil
		}
		return 0, true, nil
	case string:
		x = strings.TrimSpace(x)
		if x == "" {
			return 0, false, nil
		}
		f, err := strconv.ParseFloat(x, 64)
		if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
			return 0, true, fmt.Errorf("not a number: %q", x)
		}
		return f, true, nil
	}
	return 0, true, fmt.Errorf("not a number: %v", v)
}

func integer(v any) int {
	f, _, err := number(v)
	if err != nil || f != math.Trunc(f) {
		return 0 // invalid → rejected by the store's range checks
	}
	return int(f)
}

func str(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	return ""
}

func pathID(r *http.Request, name string) (int, error) {
	id, err := strconv.Atoi(r.PathValue(name))
	if err != nil {
		return 0, &store.AppError{Status: 404, Message: "ไม่พบข้อมูล"}
	}
	return id, nil
}

// ---------- session ----------

func (s *Server) login(w http.ResponseWriter, r *http.Request, _ *store.User) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	u, token, err := s.db.Login(r.Context(), str(b["username"]), str(b["password"]), sessionTTL)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: "sid", Value: token, Path: "/", MaxAge: int(sessionTTL.Seconds()),
		HttpOnly: true, SameSite: http.SameSiteStrictMode})
	writeJSON(w, 200, u)
	return nil
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request, _ *store.User) error {
	if token := sessionToken(r); token != "" {
		if err := s.db.Logout(r.Context(), token); err != nil {
			return err
		}
	}
	http.SetCookie(w, &http.Cookie{Name: "sid", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

func (s *Server) me(w http.ResponseWriter, r *http.Request, u *store.User) error {
	writeJSON(w, 200, u)
	return nil
}

// ---------- periods ----------

func (s *Server) sendDetail(w http.ResponseWriter, ctx context.Context, status, id int) error {
	d, err := s.db.PeriodDetail(ctx, id)
	if err != nil {
		return err
	}
	writeJSON(w, status, d)
	return nil
}

func (s *Server) periods(w http.ResponseWriter, r *http.Request, _ *store.User) error {
	q := r.URL.Query()
	if q.Has("year") {
		p, err := s.db.FindPeriod(r.Context(), integer(q.Get("year")), integer(q.Get("month")), integer(q.Get("round")))
		if err != nil {
			return err
		}
		if p == nil {
			writeJSON(w, 200, nil)
			return nil
		}
		return s.sendDetail(w, r.Context(), 200, p.ID)
	}
	statuses := strings.Split(q.Get("status"), ",")
	if q.Get("status") == "" {
		statuses = []string{"draft", "returned", "pending", "approved", "paid"}
	}
	list, err := s.db.ListPeriods(r.Context(), statuses)
	if err != nil {
		return err
	}
	writeJSON(w, 200, list)
	return nil
}

func (s *Server) createPeriod(w http.ResponseWriter, r *http.Request, u *store.User) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	id, err := s.db.CreatePeriod(r.Context(), integer(b["year"]), integer(b["month"]), integer(b["round"]), u.Name)
	if err != nil {
		return err
	}
	return s.sendDetail(w, r.Context(), 201, id)
}

func (s *Server) periodDetail(w http.ResponseWriter, r *http.Request, _ *store.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	return s.sendDetail(w, r.Context(), 200, id)
}

func (s *Server) updateAttendance(w http.ResponseWriter, r *http.Request, u *store.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	emp, err := pathID(r, "emp")
	if err != nil {
		return err
	}
	b, err := readBody(r)
	if err != nil {
		return err
	}
	values := map[string]float64{}
	labels := map[string]string{"days_worked": "วันทำงาน", "absent_days": "ขาดงาน (วัน)", "ot_hours": "OT (ชม.)"}
	for key, label := range labels {
		v, ok, err := number(b[key])
		if err != nil {
			return &store.AppError{Status: 400, Message: label + " ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป"}
		}
		if ok {
			values[key] = v
		}
	}
	if err := s.db.UpdateAttendance(r.Context(), id, emp, values, str(b["reason"]), u.Name); err != nil {
		return err
	}
	return s.sendDetail(w, r.Context(), 200, id)
}

// transition handles the workflow steps that need nothing but the round id.
func (s *Server) transition(step func(*store.Store, context.Context, int, string) error) handler {
	return func(w http.ResponseWriter, r *http.Request, u *store.User) error {
		id, err := pathID(r, "id")
		if err != nil {
			return err
		}
		if err := step(s.db, r.Context(), id, u.Name); err != nil {
			return err
		}
		return s.sendDetail(w, r.Context(), 200, id)
	}
}

func (s *Server) returnPeriod(w http.ResponseWriter, r *http.Request, u *store.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	b, err := readBody(r)
	if err != nil {
		return err
	}
	if err := s.db.ReturnPeriod(r.Context(), id, str(b["reason"]), u.Name); err != nil {
		return err
	}
	return s.sendDetail(w, r.Context(), 200, id)
}

func (s *Server) bankFile(w http.ResponseWriter, r *http.Request, _ *store.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	p, csv, err := s.db.BankFile(r.Context(), id)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="bank-payroll-%d-%02d-r%d.csv"`, p.Year, p.Month, p.Round))
	_, err = w.Write([]byte(csv))
	return err
}

// ---------- employee self-service ----------

func (s *Server) myPayslips(w http.ResponseWriter, r *http.Request, u *store.User) error {
	if u.EmployeeID == nil {
		return &store.AppError{Status: 404, Message: "บัญชีนี้ไม่ได้ผูกกับพนักงาน"}
	}
	emp, err := s.db.EmployeeBrief(r.Context(), *u.EmployeeID)
	if err != nil {
		return err
	}
	slips, err := s.db.Payslips(r.Context(), *u.EmployeeID)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"employee": emp, "payslips": slips})
	return nil
}

// ---------- employee master data (salary rates) — accounting only ----------

func (s *Server) employees(w http.ResponseWriter, r *http.Request, _ *store.User) error {
	list, err := s.db.Employees(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, 200, list)
	return nil
}

func employeeInput(b map[string]any, base store.EmployeeInput) store.EmployeeInput {
	in := base
	if v, ok := b["name"]; ok {
		in.Name = str(v)
	}
	if v, ok := b["type"]; ok {
		in.Type = str(v)
	}
	if v, ok := b["bank"]; ok {
		in.Bank = str(v)
	}
	if v, ok := b["account"]; ok {
		in.Account = str(v)
	}
	if v, ok := b["rate"]; ok {
		rate, present, err := number(v)
		if err != nil || !present {
			rate = 0 // rejected by validation: อัตราค่าจ้างต้องมากกว่า 0
		}
		in.Rate = rate
	}
	if v, ok := b["active"]; ok {
		f, _, _ := number(v)
		in.Active = f != 0
	}
	return in
}

func (s *Server) updateEmployee(w http.ResponseWriter, r *http.Request, _ *store.User) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	cur, err := s.db.Employee(r.Context(), id)
	if err != nil {
		return err
	}
	b, err := readBody(r)
	if err != nil {
		return err
	}
	in := employeeInput(b, store.EmployeeInput{
		Name: cur.Name, Type: cur.Type, Rate: cur.Rate, Bank: deref(cur.Bank), Account: deref(cur.Account), Active: bool(cur.Active),
	})
	e, err := s.db.UpdateEmployee(r.Context(), id, in)
	if err != nil {
		return err
	}
	writeJSON(w, 200, e)
	return nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
