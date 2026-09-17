const express = require("express");
const path = require("path");

const db = require("./db/database");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


/* ============================================================
   Date Helpers
   ============================================================ */

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function parseDate(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}


/* ============================================================
   Sessions
   ============================================================ */

app.get("/api/sessions", (req, res) => {
    const sessions = db.prepare(`
        SELECT
            sessions.*,
            COUNT(courses.id) AS course_count,
            GROUP_CONCAT(courses.code, ' · ') AS course_codes
        FROM sessions
        LEFT JOIN courses
            ON courses.session_id = sessions.id
        GROUP BY sessions.id
        ORDER BY sessions.start_date DESC
    `).all();

    res.json(sessions);
});


app.post("/api/sessions", (req, res) => {
    const { code, startDate } = req.body;

    if (!code || !startDate) {
        return res.status(400).json({
            error: "code and startDate are required"
        });
    }

    try {
        const createSession = db.transaction(() => {
            const sessionResult = db.prepare(`
                INSERT INTO sessions (
                    code,
                    start_date
                )
                VALUES (?, ?)
            `).run(code, startDate);

            const sessionId = sessionResult.lastInsertRowid;

            const insertUnit = db.prepare(`
                INSERT INTO units (
                    session_id,
                    unit_number,
                    start_date,
                    end_date
                )
                VALUES (?, ?, ?, ?)
            `);

            const sessionStart = parseDate(startDate);

            for (let unit = 1; unit <= 10; unit++) {
                const unitStart = addDays(
                    sessionStart,
                    (unit - 1) * 7
                );

                const unitEnd = addDays(unitStart, 6);

                insertUnit.run(
                    sessionId,
                    unit,
                    formatDate(unitStart),
                    formatDate(unitEnd)
                );
            }

            return sessionId;
        });

        const sessionId = createSession();

        const session = db.prepare(`
            SELECT *
            FROM sessions
            WHERE id = ?
        `).get(sessionId);

        res.status(201).json(session);

    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(409).json({
                error: "A session with that code already exists."
            });
        }

        console.error(error);

        res.status(500).json({
            error: "Unable to create session."
        });
    }
});


app.get("/api/sessions/:id/units", (req, res) => {
    const units = db.prepare(`
        SELECT *
        FROM units
        WHERE session_id = ?
        ORDER BY unit_number
    `).all(req.params.id);

    res.json(units);
});

app.patch("/api/sessions/:id", (req, res) => {
    const sessionId = Number(req.params.id);

    const session = db.prepare(`
        SELECT *
        FROM sessions
        WHERE id = ?
    `).get(sessionId);

    if (!session) {
        return res.status(404).json({
            error: "Session not found."
        });
    }

    const code =
        req.body.code === undefined
            ? session.code
            : String(req.body.code).trim();

    const startDate =
        req.body.startDate === undefined
            ? session.start_date
            : String(req.body.startDate);

    if (!code || !startDate) {
        return res.status(400).json({
            error: "Session code and start date are required."
        });
    }

    try {
        const updateSession = db.transaction(() => {
            db.prepare(`
                UPDATE sessions
                SET
                    code = ?,
                    start_date = ?
                WHERE id = ?
            `).run(
                code,
                startDate,
                sessionId
            );

            /*
             * Rebuild the dates of the existing
             * Unit 1 through Unit 10 records.
             *
             * Assignment due dates are NOT touched.
             */
            const updateUnit = db.prepare(`
                UPDATE units
                SET
                    start_date = ?,
                    end_date = ?
                WHERE session_id = ?
                  AND unit_number = ?
            `);

            const sessionStart = parseDate(startDate);

            for (let unit = 1; unit <= 10; unit++) {
                const unitStart = addDays(
                    sessionStart,
                    (unit - 1) * 7
                );

                const unitEnd = addDays(
                    unitStart,
                    6
                );

                updateUnit.run(
                    formatDate(unitStart),
                    formatDate(unitEnd),
                    sessionId,
                    unit
                );
            }
        });

        updateSession();

        const updated = db.prepare(`
            SELECT *
            FROM sessions
            WHERE id = ?
        `).get(sessionId);

        res.json(updated);

    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(409).json({
                error: "A session with that code already exists."
            });
        }

        console.error(error);

        res.status(500).json({
            error: "Unable to update session."
        });
    }
});

/* ============================================================
   Dashboard
   ============================================================ */

app.get("/api/dashboard", (req, res) => {
    try {
        const today = formatDate(new Date());

        const dashboardCourses = db.prepare(`
            SELECT
                courses.id,
                courses.code,
                courses.name,
                courses.session_id,
                sessions.code AS session_code
            FROM courses
            JOIN sessions
                ON sessions.id = courses.session_id
            WHERE courses.archived = 0
            ORDER BY
                sessions.start_date DESC,
                courses.code
        `).all();

        const getUnits = db.prepare(`
            SELECT
                id,
                unit_number,
                start_date,
                end_date
            FROM units
            WHERE session_id = ?
            ORDER BY unit_number
        `);

        const getAssignments = db.prepare(`
            SELECT
                assignments.id,
                assignments.course_id,
                assignments.unit_id,
                assignments.type_id,
                assignments.name,
                assignments.due_date,
                assignments.possible,
                assignments.grade,
                assignments.completed,
                assignments.discussion_progress,

                units.unit_number,

                assignment_types.name AS type_name

            FROM assignments

            JOIN units
                ON units.id = assignments.unit_id

            JOIN assignment_types
                ON assignment_types.id =
                   assignments.type_id

            WHERE assignments.course_id = ?

            ORDER BY
                assignments.due_date,
                units.unit_number,
                assignments.id
        `);

        const result = dashboardCourses.map(course => {
            const units = getUnits.all(course.session_id);

            const currentUnit =
                units.find(unit =>
                    today >= unit.start_date &&
                    today <= unit.end_date
                ) || null;

            let nextUnit = null;

            if (currentUnit) {
                nextUnit =
                    units.find(
                        unit =>
                            unit.unit_number ===
                            currentUnit.unit_number + 1
                    ) || null;
            } else {
                /*
                 * If the session has not started yet,
                 * treat Unit 1 as the next upcoming unit.
                 */
                nextUnit =
                    units.find(
                        unit => today < unit.start_date
                    ) || null;
            }

            const courseAssignments =
                getAssignments.all(course.id);

            const overdue =
                courseAssignments.filter(
                    assignment =>
                        !assignment.completed &&
                        assignment.due_date < today
                );

            const thisWeek =
                currentUnit
                    ? courseAssignments.filter(
                        assignment =>
                            Number(assignment.unit_id) ===
                            Number(currentUnit.id)
                    )
                    : [];

            const nextWeek =
                nextUnit
                    ? courseAssignments.filter(
                        assignment =>
                            Number(assignment.unit_id) ===
                            Number(nextUnit.id)
                    )
                    : [];

            return {
                ...course,

                current_unit: currentUnit,
                next_unit: nextUnit,

                overdue,
                this_week: thisWeek,
                next_week: nextWeek
            };
        });

        res.json({
            today,
            courses: result
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Unable to load dashboard."
        });
    }
});


/* ============================================================
   Courses
   ============================================================ */

app.get("/api/courses", (req, res) => {
    const archivedMode =
        req.query.archived || "false";

    let query = `
        SELECT
            courses.*,
            sessions.code AS session_code
        FROM courses
        JOIN sessions
            ON sessions.id = courses.session_id
    `;

    if (archivedMode === "only") {
        query += `
            WHERE courses.archived = 1
        `;
    } else if (archivedMode !== "true") {
        query += `
            WHERE courses.archived = 0
        `;
    }

    query += `
        ORDER BY
            sessions.start_date DESC,
            courses.code
    `;

    res.json(db.prepare(query).all());
});


app.post("/api/courses", (req, res) => {
    const { sessionId, code, name } = req.body;

    if (!sessionId || !code || !name) {
        return res.status(400).json({
            error: "sessionId, code, and name are required"
        });
    }

    try {
        const result = db.prepare(`
            INSERT INTO courses (
                session_id,
                code,
                name
            )
            VALUES (?, ?, ?)
        `).run(
            sessionId,
            code.trim().toUpperCase(),
            name.trim()
        );

        const course = db.prepare(`
            SELECT
                courses.*,
                sessions.code AS session_code
            FROM courses
            JOIN sessions
                ON sessions.id = courses.session_id
            WHERE courses.id = ?
        `).get(result.lastInsertRowid);

        res.status(201).json(course);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Unable to create course."
        });
    }
});

app.patch("/api/courses/:id", (req, res) => {
    const courseId =
        Number(req.params.id);

    const course = db.prepare(`
        SELECT *
        FROM courses
        WHERE id = ?
    `).get(courseId);

    if (!course) {
        return res.status(404).json({
            error: "Course not found."
        });
    }

    const code =
        req.body.code === undefined
            ? course.code
            : String(req.body.code)
                .trim()
                .toUpperCase();

    const name =
        req.body.name === undefined
            ? course.name
            : String(req.body.name).trim();

    const archived =
        req.body.archived === undefined
            ? course.archived
            : (req.body.archived ? 1 : 0);

    const sessionId =
        req.body.sessionId === undefined
            ? course.session_id
            : Number(req.body.sessionId);

    const recalculateDates =
        req.body.recalculateDates === true;

    if (!code || !name) {
        return res.status(400).json({
            error:
                "Course code and course name are required."
        });
    }

    const destinationSession =
        db.prepare(`
            SELECT *
            FROM sessions
            WHERE id = ?
        `).get(sessionId);

    if (!destinationSession) {
        return res.status(400).json({
            error: "Destination session not found."
        });
    }

    try {
        const updateCourse =
            db.transaction(() => {

                /*
                 * If the session changed,
                 * remap every assignment from
                 * Unit N in the old session to
                 * Unit N in the new session.
                 */
                if (
                    Number(sessionId) !==
                    Number(course.session_id)
                ) {
                    const assignments =
                        db.prepare(`
                            SELECT
                                assignments.id,
                                assignments.type_id,
                                units.unit_number
                            FROM assignments
                            JOIN units
                                ON units.id =
                                   assignments.unit_id
                            WHERE assignments.course_id = ?
                        `).all(courseId);

                    const destinationUnits =
                        db.prepare(`
                            SELECT *
                            FROM units
                            WHERE session_id = ?
                        `).all(sessionId);

                    const unitMap =
                        new Map(
                            destinationUnits.map(
                                unit => [
                                    unit.unit_number,
                                    unit
                                ]
                            )
                        );

                    const updateAssignmentUnit =
                        db.prepare(`
                            UPDATE assignments
                            SET unit_id = ?
                            WHERE id = ?
                        `);

                    const updateAssignmentDate =
                        db.prepare(`
                            UPDATE assignments
                            SET
                                unit_id = ?,
                                due_date = ?
                            WHERE id = ?
                        `);

                    const getType =
                        db.prepare(`
                            SELECT *
                            FROM assignment_types
                            WHERE id = ?
                        `);

                    for (
                        const assignment
                        of assignments
                    ) {
                        const destinationUnit =
                            unitMap.get(
                                assignment.unit_number
                            );

                        if (!destinationUnit) {
                            throw new Error(
                                `Unit ${assignment.unit_number} ` +
                                "does not exist in the destination session."
                            );
                        }

                        if (recalculateDates) {
                            const type =
                                getType.get(
                                    assignment.type_id
                                );

                            if (!type) {
                                throw new Error(
                                    "Assignment type not found."
                                );
                            }

                            const dueDate =
                                formatDate(
                                    addDays(
                                        parseDate(
                                            destinationUnit.end_date
                                        ),
                                        type.due_offset_days
                                    )
                                );

                            updateAssignmentDate.run(
                                destinationUnit.id,
                                dueDate,
                                assignment.id
                            );

                        } else {
                            /*
                             * Preserve the assignment's
                             * existing stored due date.
                             */
                            updateAssignmentUnit.run(
                                destinationUnit.id,
                                assignment.id
                            );
                        }
                    }
                }

                db.prepare(`
                    UPDATE courses
                    SET
                        session_id = ?,
                        code = ?,
                        name = ?,
                        archived = ?
                    WHERE id = ?
                `).run(
                    sessionId,
                    code,
                    name,
                    archived,
                    courseId
                );
            });

        updateCourse();

        const updated = db.prepare(`
            SELECT
                courses.*,
                sessions.code AS session_code
            FROM courses
            JOIN sessions
                ON sessions.id =
                   courses.session_id
            WHERE courses.id = ?
        `).get(courseId);

        res.json(updated);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error:
                error.message ||
                "Unable to update course."
        });
    }
});

app.delete("/api/courses/:id", (req, res) => {
    const courseId =
        Number(req.params.id);

    const course = db.prepare(`
        SELECT *
        FROM courses
        WHERE id = ?
    `).get(courseId);

    if (!course) {
        return res.status(404).json({
            error: "Course not found."
        });
    }

    const assignmentCount =
        db.prepare(`
            SELECT COUNT(*) AS count
            FROM assignments
            WHERE course_id = ?
        `).get(courseId).count;

    try {
        const deleteCourse =
            db.transaction(() => {
                db.prepare(`
                    DELETE FROM assignments
                    WHERE course_id = ?
                `).run(courseId);

                db.prepare(`
                    DELETE FROM courses
                    WHERE id = ?
                `).run(courseId);
            });

        deleteCourse();

        res.json({
            deleted: true,
            assignmentCount
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Unable to delete course."
        });
    }
});

/* ============================================================
   Assignment Types
   ============================================================ */

app.get("/api/assignment-types", (req, res) => {
    const types = db.prepare(`
        SELECT *
        FROM assignment_types
        ORDER BY name
    `).all();

    res.json(types);
});


/* ============================================================
   Assignments
   ============================================================ */

/*
 * Return all assignments for a course.
 */
app.get("/api/courses/:courseId/assignments", (req, res) => {
    const assignments = db.prepare(`
        SELECT
            assignments.id,
            assignments.course_id,
            assignments.unit_id,
            assignments.type_id,
            assignments.name,
            assignments.due_date,
            assignments.possible,
            assignments.grade,
            assignments.completed,
            assignments.discussion_progress,

            units.unit_number,

            assignment_types.name AS type_name

        FROM assignments

        JOIN units
            ON units.id = assignments.unit_id

        JOIN assignment_types
            ON assignment_types.id = assignments.type_id

        WHERE assignments.course_id = ?

        ORDER BY
            assignments.due_date,
            units.unit_number,
            assignments.id
    `).all(req.params.courseId);

    res.json(assignments);
});


/*
 * Create one assignment.
 *
 * Due date is calculated NOW and permanently stored.
 */
app.post("/api/courses/:courseId/assignments", (req, res) => {
    const courseId = Number(req.params.courseId);

    const {
        unitId,
        typeId,
        possible,
        name
    } = req.body;

    if (!unitId || !typeId) {
        return res.status(400).json({
            error: "Unit and assignment type are required."
        });
    }

    const course = db.prepare(`
        SELECT *
        FROM courses
        WHERE id = ?
    `).get(courseId);

    if (!course) {
        return res.status(404).json({
            error: "Course not found."
        });
    }

    const unit = db.prepare(`
        SELECT *
        FROM units
        WHERE id = ?
          AND session_id = ?
    `).get(unitId, course.session_id);

    if (!unit) {
        return res.status(400).json({
            error: "That unit does not belong to this course session."
        });
    }

    const type = db.prepare(`
        SELECT *
        FROM assignment_types
        WHERE id = ?
    `).get(typeId);

    if (!type) {
        return res.status(400).json({
            error: "Assignment type not found."
        });
    }

    const dueDate = formatDate(
        addDays(
            parseDate(unit.end_date),
            type.due_offset_days
        )
    );

    const result = db.prepare(`
        INSERT INTO assignments (
            course_id,
            unit_id,
            type_id,
            name,
            due_date,
            possible
        )
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        courseId,
        unitId,
        typeId,
        name?.trim() || null,
        dueDate,
        possible === "" || possible == null
            ? null
            : Number(possible)
    );

    res.status(201).json({
        id: result.lastInsertRowid
    });
});


/*
 * Bulk-create one assignment type across selected units.
 *
 * Example:
 * Discussion, Units 1-10, 20 points
 */
app.post("/api/courses/:courseId/assignments/bulk", (req, res) => {
    const courseId = Number(req.params.courseId);

    const {
        typeId,
        assignments: requestedAssignments
    } = req.body;

    if (
        !typeId ||
        !Array.isArray(requestedAssignments) ||
        requestedAssignments.length === 0
    ) {
        return res.status(400).json({
            error: "Type and at least one assignment are required."
        });
    }

    const course = db.prepare(`
        SELECT *
        FROM courses
        WHERE id = ?
    `).get(courseId);

    if (!course) {
        return res.status(404).json({
            error: "Course not found."
        });
    }

    const type = db.prepare(`
        SELECT *
        FROM assignment_types
        WHERE id = ?
    `).get(typeId);

    if (!type) {
        return res.status(400).json({
            error: "Assignment type not found."
        });
    }

    const findUnit = db.prepare(`
        SELECT *
        FROM units
        WHERE id = ?
          AND session_id = ?
    `);

    const insertAssignment = db.prepare(`
        INSERT INTO assignments (
            course_id,
            unit_id,
            type_id,
            due_date,
            possible
        )
        VALUES (?, ?, ?, ?, ?)
    `);

    try {
        const createAssignments = db.transaction(() => {
            let created = 0;

            for (const requested of requestedAssignments) {
                const unit = findUnit.get(
                    requested.unitId,
                    course.session_id
                );

                if (!unit) {
                    throw new Error(
                        `Invalid unit ID: ${requested.unitId}`
                    );
                }

                const dueDate = formatDate(
                    addDays(
                        parseDate(unit.end_date),
                        type.due_offset_days
                    )
                );

                const possible =
                    requested.possible === "" ||
                    requested.possible === null ||
                    requested.possible === undefined
                        ? null
                        : Number(requested.possible);

                if (
                    possible !== null &&
                    (!Number.isFinite(possible) || possible < 0)
                ) {
                    throw new Error(
                        `Invalid possible points for Unit ${unit.unit_number}`
                    );
                }

                insertAssignment.run(
                    courseId,
                    unit.id,
                    type.id,
                    dueDate,
                    possible
                );

                created++;
            }

            return created;
        });

        const created = createAssignments();

        res.status(201).json({ created });

    } catch (error) {
        console.error(error);

        res.status(400).json({
            error: error.message || "Unable to create assignments."
        });
    }
});


/*
 * Update editable assignment fields.
 */
app.patch("/api/assignments/:id", (req, res) => {
    const assignmentId = Number(req.params.id);

    const assignment = db.prepare(`
        SELECT
            assignments.*,
            courses.session_id
        FROM assignments
        JOIN courses
            ON courses.id = assignments.course_id
        WHERE assignments.id = ?
    `).get(assignmentId);

    if (!assignment) {
        return res.status(404).json({
            error: "Assignment not found."
        });
    }

    const unitId =
        req.body.unitId === undefined
            ? assignment.unit_id
            : Number(req.body.unitId);

    const typeId =
        req.body.typeId === undefined
            ? assignment.type_id
            : Number(req.body.typeId);

    const dueDate =
        req.body.dueDate === undefined
            ? assignment.due_date
            : req.body.dueDate;

    let completed =
        req.body.completed === undefined
            ? assignment.completed
            : (req.body.completed ? 1 : 0);

    let discussionProgress =
            req.body.discussionProgress === undefined
                ? assignment.discussion_progress
                : Number(req.body.discussionProgress);

        if (
            !Number.isInteger(discussionProgress) ||
            discussionProgress < 0 ||
            discussionProgress > 3
        ) {
            return res.status(400).json({
                error:
                    "Discussion progress must be between 0 and 3."
            });
        }

    /*
        * Discussion progress and completed status
        * stay synchronized.
        *
        * Progress 3 = completely finished.
        * Progress 0-2 = not completely finished.
        */
        if (req.body.discussionProgress !== undefined) {
            completed =
                discussionProgress === 3
                    ? 1
                    : 0;
        }

    if (
            req.body.completed !== undefined &&
            req.body.discussionProgress === undefined
        ) {
            const type = db.prepare(`
                SELECT name
                FROM assignment_types
                WHERE id = ?
            `).get(assignment.type_id);

            if (
                type &&
                type.name.toLowerCase() === "discussion"
            ) {
                discussionProgress =
                    completed ? 3 : 0;
            }
        }

    const grade =
        req.body.grade === undefined
            ? assignment.grade
            : (
                req.body.grade === "" ||
                req.body.grade === null
                    ? null
                    : Number(req.body.grade)
            );

    const possible =
        req.body.possible === undefined
            ? assignment.possible
            : (
                req.body.possible === "" ||
                req.body.possible === null
                    ? null
                    : Number(req.body.possible)
            );

    const name =
        req.body.name === undefined
            ? assignment.name
            : (
                req.body.name.trim() === ""
                    ? null
                    : req.body.name.trim()
            );

    const unit = db.prepare(`
        SELECT *
        FROM units
        WHERE id = ?
          AND session_id = ?
    `).get(unitId, assignment.session_id);

    if (!unit) {
        return res.status(400).json({
            error: "Invalid unit."
        });
    }

    const type = db.prepare(`
        SELECT *
        FROM assignment_types
        WHERE id = ?
    `).get(typeId);

    if (!type) {
        return res.status(400).json({
            error: "Invalid assignment type."
        });
    }

    db.prepare(`
        UPDATE assignments
        SET
            unit_id = ?,
            type_id = ?,
            name = ?,
            due_date = ?,
            possible = ?,
            grade = ?,
            completed = ?,
            discussion_progress = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        unitId,
        typeId,
        name,
        dueDate,
        possible,
        grade,
        completed,
        discussionProgress,
        assignmentId
    );

    res.json({ success: true });
});

app.delete("/api/sessions/:id", (req, res) => {
    const sessionId = Number(req.params.id);

    const session = db.prepare(`
        SELECT *
        FROM sessions
        WHERE id = ?
    `).get(sessionId);

    if (!session) {
        return res.status(404).json({
            error: "Session not found."
        });
    }

    const courseCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM courses
        WHERE session_id = ?
    `).get(sessionId).count;

    if (courseCount > 0) {
        return res.status(409).json({
            error:
                "This session cannot be deleted " +
                "while it contains courses."
        });
    }

    try {
        const deleteSession = db.transaction(() => {
            db.prepare(`
                DELETE FROM units
                WHERE session_id = ?
            `).run(sessionId);

            db.prepare(`
                DELETE FROM sessions
                WHERE id = ?
            `).run(sessionId);
        });

        deleteSession();

        res.json({
            deleted: true
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Unable to delete session."
        });
    }
});

app.post("/api/assignments/bulk-delete", (req, res) => {
    const { ids } = req.body;

    if (
        !Array.isArray(ids) ||
        ids.length === 0
    ) {
        return res.status(400).json({
            error: "Select at least one assignment."
        });
    }

    const cleanIds = ids
        .map(Number)
        .filter(Number.isInteger);

    if (cleanIds.length !== ids.length) {
        return res.status(400).json({
            error: "Invalid assignment selection."
        });
    }

    const placeholders =
        cleanIds.map(() => "?").join(", ");

    const result = db.prepare(`
        DELETE FROM assignments
        WHERE id IN (${placeholders})
    `).run(...cleanIds);

    res.json({
        success: true,
        deleted: result.changes
    });
});

/*
 * Delete an assignment.
 */
app.delete("/api/assignments/:id", (req, res) => {
    const result = db.prepare(`
        DELETE FROM assignments
        WHERE id = ?
    `).run(req.params.id);

    if (result.changes === 0) {
        return res.status(404).json({
            error: "Assignment not found."
        });
    }

    res.json({ success: true });
});


/* ============================================================
   Start
   ============================================================ */

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Assignment Tracker listening on port ${PORT}`
    );
});