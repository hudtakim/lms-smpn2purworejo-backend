# LMS SMPN 2 Purworejo Backend

Backend service for the **Learning Management System (LMS) SMPN 2 Purworejo**, built with **Go**, **Chi Router**, and **PostgreSQL**.

This repository provides REST APIs for multi-role school operations, including:
- Authentication and profile management
- Academic year and class management
- Scheduling and teaching documents
- Materials, tasks, quizzes, journals, and grading
- Student and parent portals
- Supervisor dashboards and performance analytics
- Global application settings and maintenance tools

---

## Tech Stack

- **Language**: Go (module: `lms-backend-go`)
- **HTTP Router**: [`go-chi/chi`](https://github.com/go-chi/chi)
- **Database**: PostgreSQL via [`pgx/pgxpool`](https://github.com/jackc/pgx)
- **Authentication**: JWT (`golang-jwt/jwt/v5`)
- **Password Hashing**: bcrypt (`golang.org/x/crypto/bcrypt`)
- **Environment Config**: `joho/godotenv`
- **Excel Import/Export**: `xuri/excelize`

---

## High-Level Architecture

The server entry point is `main.go` and follows this flow:

1. Load environment variables from `.env` (if present)
2. Initialize PostgreSQL connection pool (`config.InitDB()`)
3. Configure middlewares:
   - CORS
   - request logger
   - panic recoverer
4. Register static file serving for `/uploads/*`
5. Register grouped role-based REST endpoints
6. Start server at **port `5000`**

Role-based access is enforced with middleware, such as:
- `VerifyToken`
- `IsAdmin`
- `IsTeacher`
- `IsStudent`
- `IsParent`
- combined guards (`IsAdminOrTeacher`, `IsAdminOrSupervisor`, etc.)

---

## Repository Structure

```text
lms-smpn2purworejo-backend/
├── .github/                    # GitHub workflows/config (if any)
├── config/
│   └── db.go                   # PostgreSQL connection pool initialization
├── handlers/                   # HTTP handlers (feature/domain based)
│   ├── auth.go                 # Login and JWT generation
│   ├── global.go               # Global settings and profile APIs
│   ├── admin.go                # Admin operations (users, rooms, settings, etc.)
│   ├── academic_year.go        # Academic year management
│   ├── class.go                # Class CRUD and membership operations
│   ├── teacher.go              # Teacher portal APIs
│   ├── student.go              # Student portal APIs
│   ├── parent.go               # Parent portal APIs
│   ├── supervisor.go           # Supervisor analytics APIs
│   ├── material_reads.go       # Read-tracking for materials/tasks
│   ├── helpers.go              # Shared helper functions
│   ├── telemetry_linux.go      # Linux-specific telemetry
│   └── telemetry_windows.go    # Windows-specific telemetry
├── middleware/
│   └── auth.go                 # JWT and role authorization middleware
├── src/
│   └── middlewares/            # Additional middleware utilities
├── uploads/                    # Uploaded/static files served by API
├── Dockerfile                  # Containerization definition
├── go.mod
├── go.sum
└── main.go                     # Application bootstrap and route registration
```

---

## Main API Groups

> Base path prefix used in routes: `/api`

### 1) Auth
- `POST /api/auth/login`

### 2) Global
- Public and authenticated global endpoints:
  - session duration limit
  - maintenance status
  - active academic year
  - admin WhatsApp
  - profile and password update

### 3) Admin
Admin APIs include:
- User management + bulk import + activation toggle
- Room, class, subject, and schedule management
- Academic year CRUD and activation
- Time slots, day settings, KKM settings, app settings
- Parent-student mapping management
- Telemetry/backup and maintenance endpoints

### 4) Teacher
Teacher APIs include:
- My schedule, classes, active subjects
- Teaching document CRUD
- Class overview
- Material, task, journal, and quiz CRUD per class/subject
- Task & quiz scoring (manual/import)
- Gradebook view and export

### 5) Student
Student APIs include:
- Dashboard metadata
- Schedule, subjects, materials, tasks, quizzes
- Task submission
- Grade retrieval
- Read-tracking for materials and tasks

### 6) Parent
Parent APIs include:
- Linked children
- Parent dashboard metadata
- Grades and attendance of children

### 7) Supervisor
Supervisor APIs include:
- Dashboard
- Teacher performance
- Student statistics and detailed performance
- Curriculum progress

---

## Prerequisites

- Go **1.26.4** (based on `go.mod`)
- PostgreSQL
- (Optional) Docker

---

## Environment Variables

Create a `.env` file in project root.

Minimum variables:

```env
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=lms_db
JWT_SECRET=your_super_secret_key
```

Notes:
- If `DB_USER`, `DB_HOST`, `DB_NAME`, or `DB_PORT` are empty, defaults are used in `config/db.go`.
- If `JWT_SECRET` is empty, a fallback secret is used in code. For production, **always set a strong secret**.

---

## Installation & Running

### Local

```bash
go mod tidy
go run main.go
```

The server runs at:
- `http://localhost:5000`

Static uploads are served at:
- `http://localhost:5000/uploads/...`

### Build Binary

```bash
go build -o lms-backend main.go
./lms-backend
```

### Docker (basic)

```bash
docker build -t lms-backend .
docker run --env-file .env -p 5000:5000 lms-backend
```

---

## Authentication

- Login endpoint returns a JWT token.
- Send token in headers for protected routes:

```http
Authorization: Bearer <token>
```

Token payload includes user claims such as:
- `id`
- `role`
- `name`
- `religion`
- `exp`

Session duration is configurable from app settings (`session_time_limit`) with fallback default value.

---

## Logging & Error Handling

- Uses structured JSON logging (`log/slog`) to stdout for easier aggregation.
- HTTP request logging and panic recovery are enabled via Chi middleware.
- Common JSON response helpers are used in handlers for consistent API responses.

---

## Development Notes

- Keep business logic grouped by domain under `handlers/`.
- Add/adjust authorization checks in `middleware/auth.go` when introducing new role rules.
- Maintain route grouping in `main.go` to keep access control explicit and auditable.
- For import/export workflows (users/classes/subjects/scores), review Excel-related handlers and validate file format in clients.

---

## Suggested Next Improvements

- Add API documentation (OpenAPI/Swagger)
- Add migration tooling for DB schema versioning
- Add unit/integration tests and CI checks
- Add rate limiting and stricter CORS policy for production
- Add centralized config validation at startup

---

## License

No license file is currently defined in this repository.
If you plan to open-source this project, consider adding a license (e.g., MIT/Apache-2.0).
