# Assignment Tracker

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Supported-2496ED?logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-Database-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/github/license/amsolenberg/assignment-tracker)

A self-hosted web application for tracking college courses, assignments, due dates, grades, and upcoming coursework.

Assignment Tracker was created as a replacement for a spreadsheet-based assignment tracking system. It organizes courses into academic sessions and units, automatically calculates assignment due dates, tracks grades and completion progress, and provides a dashboard showing current and upcoming coursework.

Built with Node.js, Express, SQLite, and vanilla JavaScript.

## Features

- Dashboard showing:
  - Overdue assignments
  - Assignments for the current academic unit
  - Assignments for the next academic unit
- Multiple courses per academic session
- 10-unit academic session scheduling
- Automatic due-date calculation based on assignment type
- Assignment types including:
  - Discussion
  - Assignment
  - Seminar
  - Lab
  - Quiz
  - Exam
  - Journal
- Grade and possible-point tracking
- Discussion progress tracking for:
  - Initial post
  - Response 1
  - Response 2
- Course grade summaries by assignment type
- Bulk assignment creation
- Bulk assignment deletion
- Course archiving
- Historical course support
- Light, dark, and system themes
- SQLite database with no external database server required
- Docker deployment

## Screenshots

Screenshots coming soon.

## How Scheduling Works

Assignment Tracker organizes courses using **sessions** and **units**.

A session represents an academic term and contains 10 units. Courses assigned to the same session share the same unit schedule.

For the schedule the application was originally designed around:

- Each unit begins on Wednesday.
- Each unit ends the following Tuesday.
- Discussions are due Friday.
- Other assignment types are due Tuesday.

Due dates are calculated when an assignment is created and then stored with the assignment. They are not continually recalculated from the session schedule.

This is intentional. It allows historical courses to retain their original due dates even after new academic sessions are created or schedules are changed.

## Technology

- Node.js
- Express
- SQLite
- better-sqlite3
- Vanilla JavaScript
- HTML/CSS
- Docker / Docker Compose

## Installation

### Docker Compose

Clone the repository:

```bash
git clone https://github.com/amsolenberg/assignment-tracker.git
cd assignment-tracker
```

Build and start the application:

```bash
docker compose up -d --build
```

The application will then be available at:

```text
http://localhost:3000
```

### Database Storage

The SQLite database is stored in:

```text
data/assignments.db
```

The `data` directory should be persisted between container recreations.

Database files are excluded from Git so personal course and grade information is not committed to the repository.

## Initial Setup

After starting Assignment Tracker:

1. Open **Manage → Manage Sessions**.
2. Create an academic session and specify its starting date.
3. The application creates the unit schedule for that session.
4. Create a course and assign it to the session.
5. Add assignments to the course.

Assignments can be created individually or in bulk across multiple units.

## Assignment Due Dates

Assignment types have a due-date offset relative to the end of their unit.

The default configuration uses:

| Type | Due |
| --- | --- |
| Discussion | Friday |
| Assignment | Tuesday |
| Seminar | Tuesday |
| Lab | Tuesday |
| Quiz | Tuesday |
| Exam | Tuesday |
| Journal | Tuesday |

The calculated date is stored directly on each assignment.

Changing a session later does not silently alter historical assignment dates.

When moving a course to another session, Assignment Tracker can optionally recalculate its assignment dates using the destination session.

## Grade Tracking

Each assignment can contain:

- Possible points
- Grade received
- Completion status

A grade of `0` is treated as an actual zero. An assignment can also be marked complete while its grade remains blank if the grade has not yet been entered.

The course summary calculates performance and weighting by assignment type.

## Discussion Tracking

Discussion assignments include additional progress tracking:

- Initial post
- Response 1
- Response 2

This makes it possible to mark portions of a discussion complete before the entire assignment is finished.

## Archived Courses

Completed courses can be archived.

Archived courses:

- Remain in the database
- Retain their assignments and grades
- Do not appear in the normal active-course interface
- Do not contribute assignments to the Home dashboard
- Can be restored later

This allows Assignment Tracker to serve as both a current assignment tracker and a historical record of previous courses.

## Historical Import

The repository includes:

```text
scripts/import-history.js
```

This utility can import historical course data exported as CSV files.

By default, the importer performs a dry run:

```bash
node scripts/import-history.js ./imports
```

To perform the import:

```bash
node scripts/import-history.js ./imports --commit
```

When running the application through Docker:

```bash
docker compose exec assignment-tracker node scripts/import-history.js ./imports
```

The importer validates the files before making changes and performs committed imports inside a database transaction.

> The historical importer was created for the spreadsheet format used by the original Assignment Tracker workflow and may require modification for other CSV formats.

The `imports/` directory is excluded from Git to prevent historical coursework and grade information from being committed.

## Data Privacy

Assignment Tracker is designed to be self-hosted.

Course information, assignments, and grades are stored locally in the SQLite database. No external database or cloud service is required by the application itself.

The following files should not be committed to source control:

```text
data/*.db
data/*.db-shm
data/*.db-wal
imports/
.env
```

These are excluded by the project's `.gitignore`.

## Project Structure

```text
assignment-tracker/
├── data/
│   └── .gitkeep
├── db/
│   ├── database.js
│   └── schema.sql
├── public/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── app.js
│   └── index.html
├── scripts/
│   └── import-history.js
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── package.json
└── server.js
```

## Development

After making changes to the application, rebuild the Docker container if necessary:

```bash
docker compose up -d --build
```

Application data stored in the mounted `data` directory will remain intact when the container is rebuilt.

## License

This project is licensed under the MIT License.