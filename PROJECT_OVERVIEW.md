# PROJECT_OVERVIEW.md

## Project Name (working title)
Care Facility Shift Planner

## Goal
Build a web-based shift planning application for a single care facility (nursing home) with ~40–50 employees.
The primary goal is to reduce manual work, errors, and chaos caused by paper-based planning and Excel rewriting.

The system must support flexible working arrangements (full-time, part-time, mini-job), legal rest periods, shift preferences (“wishes”), and manual overrides by the planner.

This is NOT a payroll or HR system.

---

## Core Principles
- Planner is always in control (manual editing always possible)
- Rules help, but never fully block real-life decisions
- Flexibility over rigid automation
- Clear separation between:
  - hard rules (must never be violated)
  - soft rules (preferences, fairness, balance)
- Employees using the system is OPTIONAL
- Printed / Excel output must remain possible

---

## Scope (MVP)

### Organization
- Single care facility
- Central planning by one or a few planners
- Possible internal divisions/units (configurable later)

---

### Shifts
- Three main shift types:
  - Early
  - Late
  - Night
- Shift times may vary depending on workload percentage (e.g. 75% vs 100%)
- Shift times must be configurable (no hardcoded hours)

Recommended approach:
- Shift profiles (e.g. Early_75, Early_100, Late_75, etc.)

---

### Employees
Each employee has configurable parameters, including:
- Contract type (full-time / part-time / mini-job)
- Target hours (weekly or monthly)
- Maximum allowed hours (especially for mini-jobs)
- Qualifications / roles (important for shift eligibility)
- Preferred shift types (e.g. only night shifts)
- Availability restrictions (days or dates blocked)
- Legal constraints (rest period, max consecutive shifts, etc.)

---

### Rules

#### Hard Rules (must never be violated)
- No overlapping shifts
- Minimum rest time between shifts (default 11 hours, configurable)
- Maximum allowed working hours (e.g. mini-job monthly limit)
- Required qualifications per shift
- Minimum staffing per shift

#### Soft Rules (can be violated with warning)
- Shift wishes / preferences
- Fair distribution of nights / weekends
- Target hours balancing

---

### Shift Wishes
- Employees can submit wishes for specific dates and shift types
- Wishes are preferences, NOT availability blocks
- Wishes have a priority (normal / strong)
- Most wishes should be fulfilled, but not guaranteed
- If a wish is not fulfilled, a reason can be documented

---

### Shift Swaps
- Employees may request shift swaps
- All swaps MUST be approved by the planner
- Planner approval ensures qualification and rule compliance
- All swaps are logged in history

---

### Planning Workflow
1. Planner creates a draft schedule
2. System validates hard rules and highlights warnings
3. Planner can manually edit any assignment
4. Schedule is published
5. Changes after publication are allowed and logged

---

### History & Audit
- All changes must be tracked:
  - who changed what
  - when
  - before / after state

---

### Views (UI)

#### Planner Views (MVP)
- Day view: shifts → assigned employees
- Week overview: staffing status per shift
- Employee detail view (hours, shifts, wishes)
- Wishes overview (per day / per shift)

#### Employee Views (Optional Usage)
- Login is optional
- Employee can:
  - view own schedule
  - see general staffing (without sensitive details)
  - submit wishes
- Employees not using the system still receive schedule via print/Excel

---

### Output / Export
- Excel export (mandatory)
- Printable PDF (mandatory)
- Output format should be similar to the current paper-based schedule

---

### Notifications (MVP minimal)
- Email notifications are sufficient
- Used mainly for:
  - schedule publication
  - wish approval / rejection
  - swap approval

---

## Out of Scope (NOT MVP)
- Payroll calculation
- Salary, tax, or HR management
- Automatic AI-generated schedules
- Advanced labor law edge cases
- Multi-facility management
- Mandatory employee onboarding to digital system

---

## Technology Assumptions
- Web application
- Desktop-first, mobile-friendly
- Deterministic backend logic
- Automation (e.g. n8n) optional and non-critical
- AI not used in MVP

---

## Design Philosophy
The system should feel:
- practical
- transparent
- forgiving of real-world exceptions

The planner must always understand:
- why a conflict exists
- why a suggestion was made
- what rule is being violated

No “black box” behavior.

---

End of document.