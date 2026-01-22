# MVP_SPEC.md

## 1. Tech Stack (MVP)
- Frontend: Next.js (App Router) + React
- UI: Material UI (MUI)
- API: Next.js Route Handlers (REST)
- Database: PostgreSQL
- ORM: Prisma
- Auth: NextAuth (Credentials) or custom auth (email/password) + role-based access
- Roles: `PLANNER`, `EMPLOYEE`
- Deployment (MVP): Docker on developer VPS (Hetzner), single instance
- Future: migrate to client hosting (Docker or managed hosting) — keep architecture portable
- Automation: n8n for email notifications (non-critical)
- Testing: minimum unit tests for scheduling rules and validations

---

## 2. Core Domain Concepts

### 2.1 Facility (single)
Represents one care facility instance.
- configurable settings (rules defaults, shift profiles, staffing requirements)

### 2.2 Unit (optional for MVP)
A facility may have units/wards later. In MVP keep optional and simple:
- either single implicit unit OR allow units without complex cross-unit constraints.

### 2.3 Employee
Represents a worker.
Key properties:
- name, role/qualification tags
- contract type: full-time / part-time / mini-job
- target hours (weekly or monthly)
- hard limits (e.g. mini-job max monthly hours)
- preferences: preferred shift types / allowed shift profiles
- availability blocks (dates)
- optional: “night-only” flag (implemented as allowed shift profiles)

### 2.4 Shift Profile
Template defining shift start/end and metadata.
Examples:
- Early_75: 06:00–13:00
- Early_100: 06:00–14:30
- Late_75, Late_100
- Night (fixed or profile-based)

Properties:
- `name`
- `shiftType`: EARLY / LATE / NIGHT
- `startTime`, `endTime` (supports overnight)
- `breakMinutes` (optional, default 0)
- `isActive`

### 2.5 Staffing Requirement
Defines minimum staffing and required qualifications per date + shiftType or shiftProfile.
For MVP:
- requirements per day-of-week + shiftType (simpler)
Later:
- per specific date, per unit, per profile.

Properties (MVP):
- `shiftType`
- `minStaffCount`
- required qualification tags (e.g. must include at least 1 “NurseQualified”)

### 2.6 Schedule
A schedule belongs to a period (e.g. month).
States:
- DRAFT
- PUBLISHED

Properties:
- `periodStart`, `periodEnd`
- `status`
- `publishedAt`

### 2.7 Assignment
An employee assigned to a specific date and a specific shift profile.
Properties:
- `scheduleId`
- `date`
- `shiftProfileId`
- `employeeId`
- `createdBy`, `createdAt`

### 2.8 Wish (Shift Wish)
Employee preference for a date and shift type/profile.
Properties:
- `employeeId`
- `date`
- `shiftType` or `shiftProfileId` (prefer `shiftType` for flexibility)
- `priority`: NORMAL / STRONG
- `note` (optional)
- `status`: OPEN / FULFILLED / NOT_FULFILLED
- `decisionReason` (optional text)

### 2.9 Swap Request
Employee requests a swap; planner must approve.
Properties:
- `fromAssignmentId`
- `toEmployeeId` (optional; can be “open request” later)
- `status`: REQUESTED / APPROVED / REJECTED / CANCELLED
- `plannerDecisionReason` (optional)
- `approvedBy`, `approvedAt`

### 2.10 Audit Log
Track changes in assignments, wishes decisions, swaps.
Properties:
- entity type, entity id
- action type (CREATE/UPDATE/DELETE)
- before/after JSON
- actor user id
- timestamp

---

## 3. Rules Engine (MVP)

### 3.1 Rule Types
Hard rules (block save / generation):
- no overlapping assignments for an employee
- minimum rest hours between consecutive shifts (default 11, configurable)
- mini-job monthly max hours must not be exceeded
- required qualification coverage per shiftType
- minimum staffing per shiftType

Soft rules (warnings only):
- wishes not fulfilled
- fairness (nights/weekends distribution) — MVP: warnings only, simple counters
- target hours balancing — MVP: warnings only

### 3.2 Facility Settings (Configurable)
Stored in DB:
- `minRestHours` (default 11)
- `miniJobMaxMonthlyHours` (default configurable)
- optional: `maxConsecutiveDays`, `maxConsecutiveNights` (MVP can be off by default)

### 3.3 Validation Approach
- On every assignment create/update:
  - validate hard rules for the affected employee
  - validate staffing coverage for the affected day/shiftType
- Provide a validation result object:
  - `errors[]` (hard rule violations)
  - `warnings[]` (soft rule hints)

---

## 4. Schedule Generation (MVP)
Goal: generate a “best effort” draft schedule using deterministic heuristics (no AI).

### 4.1 Inputs
- target period (e.g. month)
- employees
- shift profiles
- staffing requirements
- existing blocks (unavailability)
- wishes

### 4.2 Output
- a draft schedule with assignments
- a report:
  - unmet staffing requirements
  - unfulfilled wishes
  - rule warnings

### 4.3 Heuristic Strategy (simple + explainable)
- For each day and shiftType:
  1) fill required “must-have qualifications” first
  2) then fill remaining slots
- Candidate selection uses scoring:
  - + points if fulfilling a wish
  - + points if employee is under target hours
  - - points if near limits (hours, consecutive nights)
  - - points if preference mismatch
- Hard rule violations exclude the candidate.

Planner can always adjust manually afterward.

---

## 5. UI Requirements (MVP)

### 5.1 Planner Views
1) Day View: shifts → assigned employees
   - show coverage status (e.g. 7/8)
   - show required qualifications satisfied or missing
2) Week Overview:
   - per day & shiftType show coverage status
   - quick navigation to day details
3) Employee Detail:
   - list of assignments
   - total hours for period
   - wishes summary (fulfilled / not)
4) Wishes Overview:
   - grouped by day and shiftType
   - quick “assign to fulfill” actions
5) Draft vs Published toggle + publish action
6) Audit trail view (basic): show change history for a day/employee

### 5.2 Employee Views (Optional)
- login
- view own schedule (month/week)
- view general staffing list without sensitive details
- submit wishes
- submit swap request

---

## 6. Export (MVP)
- Excel export for the selected period
- Printable PDF export
- Layout should be similar to the current paper-based schedule (simple grid)

---

## 7. Notifications (via n8n)
Non-critical workflows:
- On schedule publish:
  - notify employees (email) who have accounts
  - notify planner summary report
- On wish decision:
  - email employee (if they use the system)
- On swap approval/rejection:
  - email involved parties

If n8n is down, the application still works.

---

## 8. REST API (MVP Outline)

### Auth
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/me

### Employees
- GET /api/employees
- POST /api/employees
- PATCH /api/employees/:id
- GET /api/employees/:id

### Shift Profiles
- GET /api/shift-profiles
- POST /api/shift-profiles
- PATCH /api/shift-profiles/:id

### Staffing Requirements
- GET /api/staffing-requirements
- POST /api/staffing-requirements
- PATCH /api/staffing-requirements/:id

### Schedules
- GET /api/schedules
- POST /api/schedules (create draft)
- POST /api/schedules/:id/generate (generate draft assignments)
- POST /api/schedules/:id/publish
- GET /api/schedules/:id

### Assignments
- GET /api/schedules/:id/assignments
- POST /api/assignments
- PATCH /api/assignments/:id
- DELETE /api/assignments/:id
- POST /api/assignments/validate (returns errors/warnings)

### Wishes
- GET /api/wishes?from=&to=
- POST /api/wishes
- PATCH /api/wishes/:id/decide (FULFILLED/NOT_FULFILLED + reason)

### Swaps
- POST /api/swaps
- PATCH /api/swaps/:id/approve
- PATCH /api/swaps/:id/reject

### Export
- GET /api/schedules/:id/export/excel
- GET /api/schedules/:id/export/pdf

---

## 9. Non-Functional Requirements
- Deterministic behavior (no “random” assignments without explanation)
- Auditability (important for trust)
- Fast enough for 40–50 employees (simple queries, pagination where needed)
- Basic security (role checks on every route)

End of document.