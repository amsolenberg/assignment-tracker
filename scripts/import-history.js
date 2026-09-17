const fs = require("fs");
const path = require("path");
const db = require("../db/database");

const COMMIT = process.argv.includes("--commit");
const csvDirectoryArg = process.argv
    .slice(2)
    .find((arg) => !arg.startsWith("--"));

if (!csvDirectoryArg) {
    console.error(
        "Usage: node scripts/import-history.js <csv-directory> [--commit]"
    );
    process.exit(1);
}

const csvDirectory = path.resolve(csvDirectoryArg);

if (!fs.existsSync(csvDirectory)) {
    console.error(`CSV directory does not exist: ${csvDirectory}`);
    process.exit(1);
}

/*
 * Historical session start dates.
 *
 * Each session begins on Wednesday.
 * Units run Wednesday through Tuesday.
 * Discussion is due Friday.
 * Everything else is due Tuesday.
 */
const SESSION_STARTS = {
    "202508": "2025-08-20",
    "202511": "2025-11-05",
    "202601": "2026-01-28",
    "202604": "2026-04-15",
    "202607": "2026-07-01"
};

const EXPECTED_TOTAL_POSSIBLE = 1000;

/*
 * ------------------------------------------------------------
 * Date helpers
 * ------------------------------------------------------------
 */

function parseIsoDate(value) {
    const [year, month, day] = value.split("-").map(Number);

    return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date) {
    return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
    const date =
        typeof value === "string"
            ? parseIsoDate(value)
            : new Date(value.getTime());

    date.setUTCDate(date.getUTCDate() + days);

    return formatIsoDate(date);
}

function getUnitDates(sessionStart, unitNumber) {
    const startOffset = (unitNumber - 1) * 7;
    const startDate = addDays(sessionStart, startOffset);
    const endDate = addDays(startDate, 6);

    return {
        startDate,
        endDate
    };
}

function calculateDueDate(sessionStart, unitNumber, typeName) {
    const { endDate } = getUnitDates(sessionStart, unitNumber);

    if (typeName.toLowerCase() === "discussion") {
        return addDays(endDate, -4);
    }

    return endDate;
}

/*
 * ------------------------------------------------------------
 * CSV parser
 * ------------------------------------------------------------
 *
 * This parser handles:
 *   - commas inside quoted values
 *   - escaped quotes
 *   - CRLF/LF line endings
 *
 * It deliberately does not use an external npm dependency.
 * ------------------------------------------------------------
 */

function parseCsv(text) {
    const rows = [];

    let row = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (quoted) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    quoted = false;
                }
            } else {
                field += char;
            }

            continue;
        }

        if (char === '"') {
            quoted = true;
            continue;
        }

        if (char === ",") {
            row.push(field);
            field = "";
            continue;
        }

        if (char === "\n") {
            row.push(field);
            rows.push(row);

            row = [];
            field = "";
            continue;
        }

        if (char !== "\r") {
            field += char;
        }
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

/*
 * ------------------------------------------------------------
 * CSV interpretation
 * ------------------------------------------------------------
 */

function clean(value) {
    return String(value ?? "").trim();
}

function normalizeHeader(value) {
    return clean(value).toLowerCase();
}

function parseBoolean(value) {
    const normalized = clean(value).toLowerCase();

    return (
        normalized === "true" ||
        normalized === "yes" ||
        normalized === "1" ||
        normalized === "checked"
    );
}

function parseNullableNumber(value) {
    const text = clean(value);

    if (text === "") {
        return null;
    }

    const number = Number(text);

    if (!Number.isFinite(number)) {
        throw new Error(`Invalid number: "${value}"`);
    }

    return number;
}

function findHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const headers = rows[i].map(normalizeHeader);

        const hasDue = headers.includes("due");
        const hasStatus = headers.includes("status");
        const hasSection = headers.includes("section");
        const hasType = headers.includes("type");
        const hasPossible = headers.includes("possible");
        const hasGrade = headers.includes("grade");

        if (
            hasDue &&
            hasStatus &&
            hasSection &&
            hasType &&
            hasPossible &&
            hasGrade
        ) {
            return i;
        }
    }

    throw new Error("Could not locate assignment table header row.");
}

function getColumnIndexes(headerRow) {
    const headers = headerRow.map(normalizeHeader);

    const find = (name) => headers.indexOf(name);

    const descriptionIndexes = [];

    headers.forEach((header, index) => {
        if (header === "description") {
            descriptionIndexes.push(index);
        }
    });

    return {
        due: find("due"),
        status: find("status"),
        section: find("section"),
        type: find("type"),
        possible: find("possible"),
        grade: find("grade"),
        descriptions: descriptionIndexes
    };
}

function extractUnitNumber(section) {
    const value = clean(section);

    const match = value.match(/(\d+)/);

    if (!match) {
        throw new Error(`Unable to determine unit from Section "${section}"`);
    }

    const unitNumber = Number(match[1]);

    if (
        !Number.isInteger(unitNumber) ||
        unitNumber < 1 ||
        unitNumber > 10
    ) {
        throw new Error(`Invalid unit number in Section "${section}"`);
    }

    return unitNumber;
}

function getDescription(row, indexes) {
    const values = indexes.descriptions
        .map((index) => clean(row[index]))
        .filter(Boolean);

    if (values.length === 0) {
        return null;
    }

    /*
     * Some historical sheets contain more than one Description
     * column. Preserve all distinct nonempty values.
     */
    return [...new Set(values)].join(" - ");
}

function parseCourseFilename(filename) {
    /*
     * Examples:
     *
     * Assignment Tracking - 202508 IN150.csv
     * Assignment Tracking - 202508 IN150(1).csv
     */

    const match = filename.match(
        /^Assignment Tracking - (\d{6}) ([A-Za-z]+\d+)(?:\(\d+\))?\.csv$/i
    );

    if (!match) {
        throw new Error(
            `Filename does not match expected format: ${filename}`
        );
    }

    return {
        sessionCode: match[1],
        courseCode: match[2].toUpperCase()
    };
}

function findCourseName(rows, headerRowIndex, courseCode) {
    /*
     * The historical exports contain the course title above the
     * assignment table. Look through those cells for a reasonable
     * title.
     *
     * If we cannot confidently determine one, use the course code
     * rather than inventing a title.
     */

    const candidates = [];

    for (let r = 0; r < headerRowIndex; r++) {
        for (const rawValue of rows[r]) {
            const value = clean(rawValue);

            if (!value) {
                continue;
            }

            if (value === courseCode) {
                continue;
            }

            if (/^\d{6}$/.test(value)) {
                continue;
            }

            if (/^(due|status|section|type|possible|grade)$/i.test(value)) {
                continue;
            }

            if (value.length >= 8) {
                candidates.push(value);
            }
        }
    }

    /*
     * Course titles tend to be the longest useful text above
     * the table.
     */
    candidates.sort((a, b) => b.length - a.length);

    const courseName = candidates[0] || courseCode;

    return courseName
        .replace(/\s*\|\s*Remaining Assignments:\s*\d+\s*$/i, "")
        .trim();

    return candidates[0] || courseCode;
}

function parseCourseFile(filepath) {
    const filename = path.basename(filepath);
    const { sessionCode, courseCode } =
        parseCourseFilename(filename);

    const sessionStart = SESSION_STARTS[sessionCode];

    if (!sessionStart) {
        throw new Error(
            `No historical start date configured for session ${sessionCode}`
        );
    }

    const text = fs.readFileSync(filepath, "utf8");
    const rows = parseCsv(text);

    const headerRowIndex = findHeaderRow(rows);
    const indexes = getColumnIndexes(rows[headerRowIndex]);

    const courseName = findCourseName(
        rows,
        headerRowIndex,
        courseCode
    );

    const assignments = [];

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];

        const section = clean(row[indexes.section]);
        const type = clean(row[indexes.type]);
        const possibleText = clean(row[indexes.possible]);

        /*
         * Ignore summary rows and blank material beneath the
         * assignment table.
         */
        if (!section || !type || !possibleText) {
            continue;
        }

        let unitNumber;

        try {
            unitNumber = extractUnitNumber(section);
        } catch {
            /*
             * Rows outside the assignment table can contain values
             * in these columns. Ignore them unless they look like
             * actual assignment rows.
             */
            continue;
        }

        const possible = parseNullableNumber(
            row[indexes.possible]
        );

        if (possible === null) {
            continue;
        }

        const grade = parseNullableNumber(row[indexes.grade]);
        const completed = parseBoolean(row[indexes.status]);
        const name = getDescription(row, indexes);

        const dueDate = calculateDueDate(
            sessionStart,
            unitNumber,
            type
        );

        assignments.push({
            sourceRow: i + 1,
            unitNumber,
            type,
            name,
            dueDate,
            possible,
            grade,
            completed,
            discussionProgress:
                type.toLowerCase() === "discussion" && completed
                    ? 3
                    : 0
        });
    }

    return {
        filename,
        sessionCode,
        sessionStart,
        courseCode,
        courseName,
        assignments
    };
}

/*
 * ------------------------------------------------------------
 * Load files
 * ------------------------------------------------------------
 */

const csvFiles = fs
    .readdirSync(csvDirectory)
    .filter((filename) => filename.toLowerCase().endsWith(".csv"))
    .sort();

if (csvFiles.length === 0) {
    console.error(`No CSV files found in ${csvDirectory}`);
    process.exit(1);
}

const courses = [];
const validationErrors = [];

for (const filename of csvFiles) {
    const filepath = path.join(csvDirectory, filename);

    try {
        courses.push(parseCourseFile(filepath));
    } catch (error) {
        validationErrors.push(`${filename}: ${error.message}`);
    }
}

/*
 * ------------------------------------------------------------
 * Validate parsed data
 * ------------------------------------------------------------
 */

const seenCourses = new Set();

for (const course of courses) {
    const key = `${course.sessionCode}:${course.courseCode}`;

    if (seenCourses.has(key)) {
        validationErrors.push(
            `${course.filename}: duplicate course ${course.courseCode} ` +
            `for session ${course.sessionCode}`
        );
    }

    seenCourses.add(key);

    if (course.assignments.length === 0) {
        validationErrors.push(
            `${course.filename}: no assignments found`
        );
        continue;
    }

    const totalPossible = course.assignments.reduce(
        (sum, assignment) => sum + assignment.possible,
        0
    );

    if (Math.abs(totalPossible - EXPECTED_TOTAL_POSSIBLE) > 0.001) {
        validationErrors.push(
            `${course.filename}: expected ${EXPECTED_TOTAL_POSSIBLE} ` +
            `possible points but found ${totalPossible}`
        );
    }

    for (const assignment of course.assignments) {
        if (!assignment.type) {
            validationErrors.push(
                `${course.filename} row ${assignment.sourceRow}: ` +
                `missing assignment type`
            );
        }

        if (assignment.possible < 0) {
            validationErrors.push(
                `${course.filename} row ${assignment.sourceRow}: ` +
                `negative possible points`
            );
        }
    }
}

/*
 * ------------------------------------------------------------
 * Validate against database
 * ------------------------------------------------------------
 */

const getSessionByCode = db.prepare(`
    SELECT *
    FROM sessions
    WHERE code = ?
`);

const getCourseBySessionAndCode = db.prepare(`
    SELECT c.*
    FROM courses c
    WHERE c.session_id = ?
      AND UPPER(c.code) = UPPER(?)
`);

const getTypeByName = db.prepare(`
    SELECT *
    FROM assignment_types
    WHERE LOWER(name) = LOWER(?)
`);

for (const course of courses) {
    const existingSession =
        getSessionByCode.get(course.sessionCode);

    if (existingSession) {
        if (existingSession.start_date !== course.sessionStart) {
            validationErrors.push(
                `${course.sessionCode}: existing session starts ` +
                `${existingSession.start_date}, expected ${course.sessionStart}`
            );
        }

        const existingCourse =
            getCourseBySessionAndCode.get(
                existingSession.id,
                course.courseCode
            );

        if (existingCourse) {
            validationErrors.push(
                `${course.sessionCode} ${course.courseCode}: ` +
                `course already exists in database`
            );
        }
    }

    const types = new Set(
        course.assignments.map((assignment) => assignment.type)
    );

    for (const typeName of types) {
        if (!getTypeByName.get(typeName)) {
            validationErrors.push(
                `${course.filename}: assignment type "${typeName}" ` +
                `does not exist in assignment_types`
            );
        }
    }
}

/*
 * ------------------------------------------------------------
 * Report
 * ------------------------------------------------------------
 */

console.log("");
console.log("Historical Assignment Import");
console.log("============================");
console.log(`Mode: ${COMMIT ? "COMMIT" : "DRY RUN"}`);
console.log(`CSV directory: ${csvDirectory}`);
console.log("");

let totalAssignments = 0;
let grandPossible = 0;

for (const sessionCode of Object.keys(SESSION_STARTS)) {
    const sessionCourses = courses.filter(
        (course) => course.sessionCode === sessionCode
    );

    if (sessionCourses.length === 0) {
        continue;
    }

    console.log(
        `Session ${sessionCode} (${SESSION_STARTS[sessionCode]})`
    );

    for (const course of sessionCourses) {
        const possible = course.assignments.reduce(
            (sum, assignment) => sum + assignment.possible,
            0
        );

        const graded = course.assignments.filter(
            (assignment) => assignment.grade !== null
        ).length;

        const completed = course.assignments.filter(
            (assignment) => assignment.completed
        ).length;

        const gradeTotal = course.assignments.reduce(
            (sum, assignment) =>
                sum +
                (assignment.grade === null
                    ? 0
                    : assignment.grade),
            0
        );

        console.log(
            `  ${course.courseCode} - ${course.courseName}`
        );
        console.log(
            `    ${course.assignments.length} assignments | ` +
            `${possible} possible | ` +
            `${gradeTotal} recorded grade | ` +
            `${graded} graded | ` +
            `${completed} completed`
        );

        totalAssignments += course.assignments.length;
        grandPossible += possible;
    }

    console.log("");
}

console.log(`Courses: ${courses.length}`);
console.log(`Assignments: ${totalAssignments}`);
console.log(`Total possible: ${grandPossible}`);
console.log("");

if (validationErrors.length > 0) {
    console.error("VALIDATION FAILED");
    console.error("=================");
    console.error("");

    for (const error of validationErrors) {
        console.error(`- ${error}`);
    }

    console.error("");
    console.error("No database changes were made.");
    process.exit(1);
}

console.log("Validation passed.");

if (!COMMIT) {
    console.log("");
    console.log("No database changes were made.");
    console.log("");
    console.log(
        "Review the results above. To perform the import, run:"
    );
    console.log("");
    console.log(
        `  node scripts/import-history.js ${csvDirectoryArg} --commit`
    );
    console.log("");

    process.exit(0);
}

/*
 * ------------------------------------------------------------
 * Import
 * ------------------------------------------------------------
 */

const insertSession = db.prepare(`
    INSERT INTO sessions (
        code,
        start_date
    )
    VALUES (?, ?)
`);

const insertUnit = db.prepare(`
    INSERT INTO units (
        session_id,
        unit_number,
        start_date,
        end_date
    )
    VALUES (?, ?, ?, ?)
`);

const getUnit = db.prepare(`
    SELECT *
    FROM units
    WHERE session_id = ?
      AND unit_number = ?
`);

const insertCourse = db.prepare(`
    INSERT INTO courses (
        session_id,
        code,
        name,
        archived
    )
    VALUES (?, ?, ?, 1)
`);

const insertAssignment = db.prepare(`
    INSERT INTO assignments (
        course_id,
        unit_id,
        type_id,
        name,
        due_date,
        possible,
        grade,
        completed,
        discussion_progress
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function ensureSession(sessionCode) {
    const expectedStart = SESSION_STARTS[sessionCode];

    let session = getSessionByCode.get(sessionCode);

    if (!session) {
        const result = insertSession.run(
            sessionCode,
            expectedStart
        );

        session = {
            id: Number(result.lastInsertRowid),
            code: sessionCode,
            start_date: expectedStart
        };

        for (let unitNumber = 1; unitNumber <= 10; unitNumber++) {
            const { startDate, endDate } =
                getUnitDates(expectedStart, unitNumber);

            insertUnit.run(
                session.id,
                unitNumber,
                startDate,
                endDate
            );
        }

        return session;
    }

    /*
     * Existing sessions, particularly 202607, should already
     * have units. Verify every unit rather than silently creating
     * or changing anything.
     */

    for (let unitNumber = 1; unitNumber <= 10; unitNumber++) {
        const unit = getUnit.get(session.id, unitNumber);

        if (!unit) {
            throw new Error(
                `Session ${sessionCode} is missing Unit ${unitNumber}`
            );
        }

        const expected =
            getUnitDates(expectedStart, unitNumber);

        if (
            unit.start_date !== expected.startDate ||
            unit.end_date !== expected.endDate
        ) {
            throw new Error(
                `Session ${sessionCode} Unit ${unitNumber} has ` +
                `${unit.start_date} through ${unit.end_date}; expected ` +
                `${expected.startDate} through ${expected.endDate}`
            );
        }
    }

    return session;
}

const importAll = db.transaction(() => {
    const sessions = new Map();

    for (const sessionCode of Object.keys(SESSION_STARTS)) {
        if (
            courses.some(
                (course) => course.sessionCode === sessionCode
            )
        ) {
            sessions.set(
                sessionCode,
                ensureSession(sessionCode)
            );
        }
    }

    for (const course of courses) {
        const session = sessions.get(course.sessionCode);

        if (!session) {
            throw new Error(
                `Session ${course.sessionCode} was not prepared`
            );
        }

        /*
         * Check again inside the transaction. This also protects
         * against accidentally rerunning the importer.
         */
        const duplicate =
            getCourseBySessionAndCode.get(
                session.id,
                course.courseCode
            );

        if (duplicate) {
            throw new Error(
                `${course.sessionCode} ${course.courseCode} already exists`
            );
        }

        const courseResult = insertCourse.run(
            session.id,
            course.courseCode,
            course.courseName
        );

        const courseId = Number(courseResult.lastInsertRowid);

        for (const assignment of course.assignments) {
            const unit = getUnit.get(
                session.id,
                assignment.unitNumber
            );

            if (!unit) {
                throw new Error(
                    `${course.courseCode}: Unit ` +
                    `${assignment.unitNumber} does not exist`
                );
            }

            const type = getTypeByName.get(assignment.type);

            if (!type) {
                throw new Error(
                    `${course.courseCode}: assignment type ` +
                    `"${assignment.type}" does not exist`
                );
            }

            insertAssignment.run(
                courseId,
                unit.id,
                type.id,
                assignment.name,
                assignment.dueDate,
                assignment.possible,
                assignment.grade,
                assignment.completed ? 1 : 0,
                assignment.discussionProgress
            );
        }
    }
});

try {
    importAll();

    console.log("");
    console.log("IMPORT COMPLETE");
    console.log("===============");
    console.log(
        `${courses.length} archived courses imported successfully.`
    );
    console.log(
        `${totalAssignments} assignments imported successfully.`
    );
    console.log("");
} catch (error) {
    console.error("");
    console.error("IMPORT FAILED");
    console.error("=============");
    console.error(error.message);
    console.error("");
    console.error(
        "The transaction was rolled back. No partial import was retained."
    );
    process.exit(1);
}