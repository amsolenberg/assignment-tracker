const courseSelector = document.getElementById("course-selector");

const noCourse = document.getElementById("no-course");

const courseView = document.getElementById("course-view");

const homeView = document.getElementById("home-view");

const setupDialog = document.getElementById("setup-dialog");

const setupButton = document.getElementById("setup-button");

const cancelSetup = document.getElementById("cancel-setup");

const setupForm = document.getElementById("setup-form");

const assignmentDialog = document.getElementById("assignment-dialog");

const addAssignmentButton = document.getElementById("add-assignment-button");

const assignmentTable = document.getElementById("assignment-table");

const summaryTable = document.getElementById("summary-table");

const homeLink = document.getElementById("home-link");

let courses = [];
let currentCourse = null;
let currentUnits = [];
let assignmentTypes = [];
let assignments = [];
let selectionMode = false;
const selectedAssignments = new Set();
let sessions = [];
let dashboardData = null;
let currentView = "home";

/* ============================================================
   API
   ============================================================ */

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },

    ...options
  });

  let data;

  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

/* ============================================================
   Formatting
   ============================================================ */

function formatDate(dateString) {
  if (!dateString) {
    return "";
  }

  const [year, month, day] = dateString.split("-").map(Number);

  return `${month}/${day}/${year}`;
}

function formatNumber(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const number = Number(value);

  if (Number.isInteger(number)) {
    return String(number);
  }

  return number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ============================================================
   Sessions
   ============================================================ */
async function loadSessions() {
  sessions = await api("/api/sessions");

  populateSessionControls();
}

function populateSessionControls() {
  const select = document.getElementById("add-course-session");

  select.innerHTML = "";

  for (const session of sessions) {
    const option = document.createElement("option");

    option.value = session.id;

    option.textContent = `${session.code} (${session.course_count} ${
      Number(session.course_count) === 1 ? "course" : "courses"
    })`;

    select.appendChild(option);
  }

  /*
   * If we're currently viewing a course,
   * default to its session.
   */
  if (currentCourse && currentCourse.session_id) {
    select.value = currentCourse.session_id;
  }
}

/* ============================================================
   Courses
   ============================================================ */

async function loadCourses() {
  courses = await api("/api/courses");

  courseSelector.innerHTML = `
    <option value="home">Home</option>
  `;

  if (courses.length > 0) {
    const separator = document.createElement("option");

    separator.disabled = true;
    separator.textContent = "──────────────";

    courseSelector.appendChild(separator);
  }

  for (const course of courses) {
    const option = document.createElement("option");

    option.value = course.id;
    option.textContent = `${course.code} - ${course.name}`;

    courseSelector.appendChild(option);
  }

  if (currentView === "home") {
    courseSelector.value = "home";
  } else if (currentCourse) {
    courseSelector.value = String(currentCourse.id);
  }
}

function showNoCourse() {
  currentCourse = null;
  currentView = "empty";

  homeView.classList.add("hidden");
  courseView.classList.add("hidden");
  noCourse.classList.remove("hidden");
}

async function selectCourse(course) {
  currentCourse = course;
  currentView = "course";

  noCourse.classList.add("hidden");
  homeView.classList.add("hidden");
  courseView.classList.remove("hidden");

  document.getElementById("course-name").textContent = course.name;

  document.getElementById("course-code").textContent =
    `${course.code} • ${course.session_code}`;

  await Promise.all([loadUnits(), loadAssignmentTypes(), loadAssignments()]);
}

async function showHome() {
  currentCourse = null;
  currentView = "home";

  noCourse.classList.add("hidden");
  courseView.classList.add("hidden");
  homeView.classList.remove("hidden");

  courseSelector.value = "home";

  await loadDashboard();
}


async function loadDashboard() {
  dashboardData = await api("/api/dashboard");

  renderDashboard();
}


function renderDashboard() {
  const overdueContainer =
    document.getElementById("home-overdue");

  const thisWeekContainer =
    document.getElementById("home-this-week");

  const nextWeekContainer =
    document.getElementById("home-next-week");

  overdueContainer.innerHTML = "";
  thisWeekContainer.innerHTML = "";
  nextWeekContainer.innerHTML = "";

  const overdueAssignments = [];

  for (const course of dashboardData.courses) {
    for (const assignment of course.overdue) {
      overdueAssignments.push({
        course,
        assignment
      });
    }
  }

  overdueAssignments.sort((a, b) =>
    a.assignment.due_date.localeCompare(
      b.assignment.due_date
    )
  );

  const overdueSection =
    document.getElementById(
      "home-overdue-section"
    );

  if (overdueAssignments.length > 0) {
    overdueSection.classList.remove("hidden");

    document.getElementById(
      "home-overdue-count"
    ).textContent =
      `${overdueAssignments.length} ` +
      `${overdueAssignments.length === 1
        ? "assignment"
        : "assignments"}`;

    renderOverdueAssignments(
      overdueContainer,
      overdueAssignments
    );
  } else {
    overdueSection.classList.add("hidden");
  }

  renderDashboardPeriod(
    thisWeekContainer,
    "this_week",
    "current_unit"
  );

  renderDashboardPeriod(
    nextWeekContainer,
    "next_week",
    "next_unit"
  );

  bindDashboardEvents();
}


function renderOverdueAssignments(
  container,
  items
) {
  const wrapper = document.createElement("div");

  wrapper.className =
    "home-course-card overdue-card";

  wrapper.innerHTML = `
    <div class="home-table-wrapper">
      <table class="home-assignment-table">
        <thead>
          <tr>
            <th>Course</th>
            <th>Due</th>
            <th>Status</th>
            <th>Section</th>
            <th>Type</th>
            <th>Possible</th>
            <th>Grade</th>
          </tr>
        </thead>

        <tbody>
          ${items
            .map(({ course, assignment }) =>
              dashboardAssignmentRow(
                course,
                assignment,
                true
              )
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  container.appendChild(wrapper);
}


function renderDashboardPeriod(
  container,
  assignmentProperty,
  unitProperty
) {
  let renderedCourses = 0;

  for (const course of dashboardData.courses) {
    const periodAssignments =
      course[assignmentProperty] || [];

    const unit = course[unitProperty];

    /*
     * Don't render a course when it has no
     * applicable academic unit.
     */
    if (!unit) {
      continue;
    }

    renderedCourses++;

    const card = document.createElement("div");

    card.className = "home-course-card";

    card.innerHTML = `
      <div class="home-course-heading">
        <button
            type="button"
            class="home-course-link"
            data-course-id="${course.id}"
        >
            ${escapeHtml(course.code)}
            -
            ${escapeHtml(course.name)}
        </button>

        <span class="home-unit-label">
            Unit ${unit.unit_number}
        </span>
        </div>

      ${
        periodAssignments.length > 0
          ? `
            <div class="home-table-wrapper">
              <table class="home-assignment-table">
                <thead>
                  <tr>
                    <th>Due</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Possible</th>
                    <th>Grade</th>
                  </tr>
                </thead>

                <tbody>
                  ${periodAssignments
                    .map(assignment =>
                      dashboardAssignmentRow(
                        course,
                        assignment,
                        false,
                        false
                      )
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          : `
            <div class="home-empty-course">
              No assignments for this unit.
            </div>
          `
      }
    `;

    container.appendChild(card);
  }

  if (renderedCourses === 0) {
    container.innerHTML = `
      <div class="home-empty-period">
        No active academic unit.
      </div>
    `;
  }
}


function dashboardAssignmentRow(
  course,
  assignment,
  showCourse,
  showSection = true
) {
  const discussion =
    assignment.type_name
      .toLowerCase() === "discussion";

  return `
    <tr
      class="home-assignment-row
        ${assignment.completed
          ? "completed-row"
          : ""}"
      data-course-id="${course.id}"
      data-assignment-id="${assignment.id}"
    >
      ${
        showCourse
          ? `
            <td class="home-course-code">
              ${escapeHtml(course.code)}
            </td>
          `
          : ""
      }

      <td class="due-cell">
        ${formatDate(assignment.due_date)}
      </td>

      <td class="status-cell">
        <input
          type="checkbox"
          class="home-status-checkbox"
          data-course-id="${course.id}"
          data-id="${assignment.id}"
          ${assignment.completed ? "checked" : ""}
        >
      </td>

      ${
        showSection
            ? `
            <td>
                Unit ${assignment.unit_number}
            </td>
            `
            : ""
        }

      <td>
        <div class="assignment-type-line">
          <span>
            ${escapeHtml(assignment.type_name)}
          </span>

          ${
            discussion
              ? dashboardDiscussionProgress(
                  course,
                  assignment
                )
              : ""
          }
        </div>

        <div class="assignment-name">
          ${
            assignment.name
              ? escapeHtml(assignment.name)
              : "&nbsp;"
          }
        </div>
      </td>

      <td>
        ${formatNumber(assignment.possible)}
      </td>

      <td>
        <input
          type="number"
          class="inline-number
                 home-grade-input"
          data-course-id="${course.id}"
          data-id="${assignment.id}"
          min="0"
          step="0.01"
          value="${assignment.grade ?? ""}"
        >
      </td>
    </tr>
  `;
}


function dashboardDiscussionProgress(
  course,
  assignment
) {
  const progress =
    Number(
      assignment.discussion_progress
    ) || 0;

  return `
    <div
      class="discussion-progress"
      data-id="${assignment.id}"
    >
      <label>
        <input
          type="checkbox"
          class="home-discussion-checkbox"
          data-course-id="${course.id}"
          data-id="${assignment.id}"
          data-progress="1"
          ${progress >= 1 ? "checked" : ""}
        >
        Initial
      </label>

      <label>
        <input
          type="checkbox"
          class="home-discussion-checkbox"
          data-course-id="${course.id}"
          data-id="${assignment.id}"
          data-progress="2"
          ${progress >= 2 ? "checked" : ""}
        >
        R1
      </label>

      <label>
        <input
          type="checkbox"
          class="home-discussion-checkbox"
          data-course-id="${course.id}"
          data-id="${assignment.id}"
          data-progress="3"
          ${progress >= 3 ? "checked" : ""}
        >
        R2
      </label>
    </div>
  `;
}

function findDashboardAssignment(
  courseId,
  assignmentId
) {
  const course =
    dashboardData.courses.find(
      item =>
        Number(item.id) === Number(courseId)
    );

  if (!course) {
    return null;
  }

  const collections = [
    course.overdue,
    course.this_week,
    course.next_week
  ];

  for (const collection of collections) {
    const assignment =
      collection.find(
        item =>
          Number(item.id) ===
          Number(assignmentId)
      );

    if (assignment) {
      return assignment;
    }
  }

  return null;
}


async function updateDashboardAssignment(
  courseId,
  assignmentId,
  changes
) {
  try {
    await api(
      `/api/assignments/${assignmentId}`,
      {
        method: "PATCH",
        body: JSON.stringify(changes)
      }
    );

    await loadDashboard();

  } catch (error) {
    alert(error.message);

    await loadDashboard();
  }
}


function bindDashboardEvents() {
  document
    .querySelectorAll(".home-status-checkbox")
    .forEach(input => {
      input.addEventListener(
        "click",
        event =>
          event.stopPropagation()
      );

      input.addEventListener(
        "change",
        async event => {
          await updateDashboardAssignment(
            event.target.dataset.courseId,
            event.target.dataset.id,
            {
              completed:
                event.target.checked
            }
          );
        }
      );
    });


  document
    .querySelectorAll(".home-grade-input")
    .forEach(input => {
      input.addEventListener(
        "click",
        event =>
          event.stopPropagation()
      );

      input.addEventListener(
        "change",
        async event => {
          await updateDashboardAssignment(
            event.target.dataset.courseId,
            event.target.dataset.id,
            {
              grade: event.target.value
            }
          );
        }
      );
    });


  document
    .querySelectorAll(
      ".home-discussion-checkbox"
    )
    .forEach(input => {
      input.addEventListener(
        "click",
        event =>
          event.stopPropagation()
      );

      input.addEventListener(
        "change",
        async event => {
          const courseId =
            Number(
              event.target.dataset.courseId
            );

          const assignmentId =
            Number(event.target.dataset.id);

          const level =
            Number(
              event.target.dataset.progress
            );

          const assignment =
            findDashboardAssignment(
              courseId,
              assignmentId
            );

          if (!assignment) {
            return;
          }

          let newProgress;

          if (event.target.checked) {
            newProgress = Math.max(
              Number(
                assignment.discussion_progress
              ) || 0,
              level
            );
          } else {
            newProgress = level - 1;
          }

          await updateDashboardAssignment(
            courseId,
            assignmentId,
            {
              discussionProgress:
                newProgress
            }
          );
        }
      );
    });


  document
    .querySelectorAll(
      ".home-assignment-row"
    )
    .forEach(row => {
      row.addEventListener(
        "click",
        async () => {
          const courseId =
            Number(row.dataset.courseId);

          const assignmentId =
            Number(
              row.dataset.assignmentId
            );

          await openDashboardAssignment(
            courseId,
            assignmentId
          );
        }
      );
    });


  document
    .querySelectorAll(
      ".home-course-link"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        async () => {
          const courseId =
            Number(
              button.dataset.courseId
            );

          const course =
            courses.find(
              item =>
                item.id === courseId
            );

          if (!course) {
            return;
          }

          courseSelector.value =
            String(course.id);

          await selectCourse(course);
        }
      );
    });
}

async function openDashboardAssignment(
  courseId,
  assignmentId
) {
  const course =
    courses.find(
      item => item.id === courseId
    );

  if (!course) {
    return;
  }

  await selectCourse(course);

  courseSelector.value =
    String(course.id);

  openEditAssignment(assignmentId);
}

homeLink.addEventListener(
  "click",
  async event => {
    event.preventDefault();

    await showHome();
  }
);

courseSelector.addEventListener(
  "change",
  async () => {
    if (
      courseSelector.value === "home"
    ) {
      await showHome();
      return;
    }

    const course =
      courses.find(
        item =>
          item.id ===
          Number(courseSelector.value)
      );

    if (!course) {
      showNoCourse();
      return;
    }

    await selectCourse(course);
  }
);

/* ============================================================
   Units / Types
   ============================================================ */

async function loadUnits() {
  if (!currentCourse) {
    return;
  }

  currentUnits = await api(`/api/sessions/${currentCourse.session_id}/units`);

  populateUnitControls();
}

async function loadAssignmentTypes() {
  assignmentTypes = await api("/api/assignment-types");

  populateTypeControls();
}

function populateUnitControls() {
  const select = document.getElementById("assignment-unit");

  const editSelect = document.getElementById("edit-assignment-unit");

  select.innerHTML = "";
  editSelect.innerHTML = "";

  for (const unit of currentUnits) {
    for (const target of [select, editSelect]) {
      const option = document.createElement("option");

      option.value = unit.id;
      option.textContent = `Unit ${unit.unit_number}`;

      target.appendChild(option);
    }
  }

  renderBulkUnits();
  updateDuePreview();
}

function populateTypeControls() {
  const selects = [
    document.getElementById("assignment-type"),
    document.getElementById("bulk-assignment-type"),
    document.getElementById("edit-assignment-type")
  ];

  for (const select of selects) {
    select.innerHTML = "";

    for (const type of assignmentTypes) {
      const option = document.createElement("option");

      option.value = type.id;
      option.textContent = type.name;

      select.appendChild(option);
    }
  }

  updateDuePreview();
}

function getBulkPointsMode() {
  return document.querySelector('input[name="bulk-points-mode"]:checked').value;
}

function renderBulkUnits() {
  const bulkList = document.getElementById("bulk-unit-list");

  const mode = getBulkPointsMode();

  bulkList.innerHTML = "";

  for (const unit of currentUnits) {
    const row = document.createElement("div");

    row.className = "bulk-unit-row";

    row.innerHTML = `
            <label class="bulk-unit-check">
                <input
                    type="checkbox"
                    class="bulk-unit-checkbox"
                    value="${unit.id}"
                    checked
                >

                <span>
                    Unit ${unit.unit_number}
                </span>
            </label>

            <input
                type="number"
                class="bulk-unit-points
                    ${mode === "same" ? "hidden" : ""}"
                data-unit-id="${unit.id}"
                min="0"
                step="0.01"
                placeholder="Points"
            >
        `;

    bulkList.appendChild(row);
  }

  document
    .getElementById("shared-points-container")
    .classList.toggle("hidden", mode === "individual");
}

document.querySelectorAll('input[name="bulk-points-mode"]').forEach((input) => {
  input.addEventListener("change", renderBulkUnits);
});

/* ============================================================
   Assignment Loading
   ============================================================ */

async function loadAssignments() {
  if (!currentCourse) {
    return;
  }

  assignments = await api(`/api/courses/${currentCourse.id}/assignments`);

  renderAssignments();
  renderSummary();
}

/* ============================================================
   Assignment Table
   ============================================================ */

function renderAssignments() {
  assignmentTable.innerHTML = "";

  for (const assignment of assignments) {
    const row = document.createElement("tr");

    row.classList.add("assignment-row");
    row.dataset.id = assignment.id;

    if (assignment.completed) {
      row.classList.add("completed-row");
    }

    if (selectedAssignments.has(assignment.id)) {
      row.classList.add("selected-row");
    }

    row.innerHTML = `
            ${
              selectionMode
                ? `
                        <td class="selection-cell">
                            <input
                                type="checkbox"
                                class="selection-checkbox"
                                data-id="${assignment.id}"
                                ${
                                  selectedAssignments.has(assignment.id)
                                    ? "checked"
                                    : ""
                                }
                            >
                        </td>
                    `
                : ""
            }

            <td class="due-cell">
                ${formatDate(assignment.due_date)}
            </td>

            <td class="status-cell">
                <input
                    type="checkbox"
                    class="status-checkbox"
                    data-id="${assignment.id}"
                    ${assignment.completed ? "checked" : ""}
                >
            </td>

            <td>
                Unit ${assignment.unit_number}
            </td>

                        <td>
                <div class="assignment-type-line">
                    <span>
                        ${escapeHtml(assignment.type_name)}
                    </span>

                    ${
                      assignment.type_name.toLowerCase() === "discussion"
                        ? `
                            <div
                                class="discussion-progress"
                                data-id="${assignment.id}"
                            >
                                <label>
                                    <input
                                        type="checkbox"
                                        class="discussion-progress-checkbox"
                                        data-id="${assignment.id}"
                                        data-progress="1"
                                        ${
                                          assignment.discussion_progress >= 1
                                            ? "checked"
                                            : ""
                                        }
                                    >
                                    Initial
                                </label>

                                <label>
                                    <input
                                        type="checkbox"
                                        class="discussion-progress-checkbox"
                                        data-id="${assignment.id}"
                                        data-progress="2"
                                        ${
                                          assignment.discussion_progress >= 2
                                            ? "checked"
                                            : ""
                                        }
                                    >
                                    R1
                                </label>

                                <label>
                                    <input
                                        type="checkbox"
                                        class="discussion-progress-checkbox"
                                        data-id="${assignment.id}"
                                        data-progress="3"
                                        ${
                                          assignment.discussion_progress >= 3
                                            ? "checked"
                                            : ""
                                        }
                                    >
                                    R2
                                </label>
                            </div>
                        `
                        : ""
                    }
                </div>

                <div class="assignment-name">
                    ${
                    assignment.name
                        ? escapeHtml(assignment.name)
                        : "&nbsp;"
                    }
                </div>
            </td>

            <td>
                ${formatNumber(assignment.possible)}
            </td>

            <td>
                <input
                    type="number"
                    class="inline-number grade-input"
                    data-id="${assignment.id}"
                    min="0"
                    step="0.01"
                    value="${assignment.grade ?? ""}"
                >
            </td>
        `;

    assignmentTable.appendChild(row);
  }

  updateSelectionHeader();
  bindAssignmentEvents();
  updateTotals();
}

function bindAssignmentEvents() {
  document.querySelectorAll(".selection-checkbox").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());

    input.addEventListener("change", (event) => {
      const id = Number(event.target.dataset.id);

      if (event.target.checked) {
        selectedAssignments.add(id);
      } else {
        selectedAssignments.delete(id);
      }

      updateSelectionControls();
      renderAssignments();
    });
  });

  document.querySelectorAll(".status-checkbox").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());

    input.addEventListener("change", async (event) => {
      await updateAssignment(event.target.dataset.id, {
        completed: event.target.checked
      });
    });
  });

  document.querySelectorAll(".grade-input").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());

    input.addEventListener("change", async (event) => {
      await updateAssignment(event.target.dataset.id, {
        grade: event.target.value
      });
    });
  });

  document.querySelectorAll(".assignment-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = Number(row.dataset.id);

      if (selectionMode) {
        if (selectedAssignments.has(id)) {
          selectedAssignments.delete(id);
        } else {
          selectedAssignments.add(id);
        }

        updateSelectionControls();
        renderAssignments();

        return;
      }

      openEditAssignment(id);
    });
  });

  document
    .querySelectorAll(".discussion-progress-checkbox")
    .forEach((input) => {
      input.addEventListener("click", (event) => event.stopPropagation());

      input.addEventListener("change", async (event) => {
        const id = Number(event.target.dataset.id);

        const level = Number(event.target.dataset.progress);

        const assignment = assignments.find((item) => item.id === id);

        if (!assignment) {
          return;
        }

        let newProgress;

        if (event.target.checked) {
          /*
           * Checking a later stage
           * implicitly completes every
           * earlier stage.
           */
          newProgress = Math.max(
            Number(assignment.discussion_progress) || 0,
            level
          );
        } else {
          /*
           * Unchecking a stage removes
           * that stage and everything
           * after it.
           *
           * Example:
           * unchecking R1 changes
           * progress from 3 to 1.
           */
          newProgress = level - 1;
        }

        try {
          await updateAssignment(id, {
            discussionProgress: newProgress
          });
        } catch (error) {
          alert(error.message);

          await loadAssignments();
        }
      });
    });
}

function updateSelectionHeader() {
  const headerRow = document.querySelector(".assignments-panel thead tr");

  const footerRow = document.querySelector(".assignments-panel tfoot tr");

  let selectionHeader = headerRow.querySelector(".selection-header");

  if (selectionMode) {
    if (!selectionHeader) {
      selectionHeader = document.createElement("th");

      selectionHeader.className = "selection-header";

      selectionHeader.textContent = "";

      headerRow.prepend(selectionHeader);
    }

    footerRow.querySelector("td").setAttribute("colspan", "5");
  } else {
    if (selectionHeader) {
      selectionHeader.remove();
    }

    footerRow.querySelector("td").setAttribute("colspan", "4");
  }
}

function updateSelectionControls() {
  const count = selectedAssignments.size;

  const deleteButton = document.getElementById("delete-selected-button");

  deleteButton.textContent = `Delete Selected (${count})`;

  deleteButton.disabled = count === 0;
}

function enterSelectionMode() {
  selectionMode = true;

  selectedAssignments.clear();

  document.getElementById("normal-assignment-actions").classList.add("hidden");

  document.getElementById("selection-actions").classList.remove("hidden");

  updateSelectionControls();
  renderAssignments();
}

function exitSelectionMode() {
  selectionMode = false;

  selectedAssignments.clear();

  document.getElementById("selection-actions").classList.add("hidden");

  document
    .getElementById("normal-assignment-actions")
    .classList.remove("hidden");

  renderAssignments();
}

document
  .getElementById("select-assignments-button")
  .addEventListener("click", enterSelectionMode);

document
  .getElementById("cancel-selection-button")
  .addEventListener("click", exitSelectionMode);

document
  .getElementById("select-all-assignments-button")
  .addEventListener("click", () => {
    for (const assignment of assignments) {
      selectedAssignments.add(assignment.id);
    }

    updateSelectionControls();
    renderAssignments();
  });

document
  .getElementById("delete-selected-button")
  .addEventListener("click", async () => {
    const count = selectedAssignments.size;

    if (count === 0) {
      return;
    }

    if (
      !confirm(
        `Permanently delete ${count} selected assignment${count === 1 ? "" : "s"}?`
      )
    ) {
      return;
    }

    try {
      await api("/api/assignments/bulk-delete", {
        method: "POST",

        body: JSON.stringify({
          ids: Array.from(selectedAssignments)
        })
      });

      selectionMode = false;
      selectedAssignments.clear();

      document.getElementById("selection-actions").classList.add("hidden");

      document
        .getElementById("normal-assignment-actions")
        .classList.remove("hidden");

      await loadAssignments();
    } catch (error) {
      alert(error.message);
    }
  });

async function updateAssignment(id, changes) {
  try {
    await api(`/api/assignments/${id}`, {
      method: "PATCH",

      body: JSON.stringify(changes)
    });

    await loadAssignments();
  } catch (error) {
    alert(error.message);

    await loadAssignments();
  }
}

/* ============================================================
   Totals / Grade
   ============================================================ */

function updateTotals() {
  const remaining = assignments.filter(
    (assignment) => !assignment.completed
  ).length;

  document.getElementById("remaining-count").textContent = remaining;

  /*
   * Match the spreadsheet behavior:
   *
   * Possible points only count assignments that
   * are completed AND have a grade entered.
   */

  const gradedAssignments = assignments.filter(
    (assignment) =>
      assignment.completed &&
      assignment.grade !== null &&
      assignment.grade !== undefined &&
      assignment.possible !== null &&
      assignment.possible !== undefined
  );

  const possible = gradedAssignments.reduce(
    (sum, assignment) => sum + Number(assignment.possible),
    0
  );

  const earned = gradedAssignments.reduce(
    (sum, assignment) => sum + Number(assignment.grade),
    0
  );

  document.getElementById("total-possible").textContent =
    formatNumber(possible);

  document.getElementById("total-grade").textContent = formatNumber(earned);

  const gradeDisplay = document.getElementById("grade-display");

  if (possible === 0) {
    gradeDisplay.textContent = "Grade: N/A";

    return;
  }

  const percent = (earned / possible) * 100;

  gradeDisplay.textContent = `Grade: ${letterGrade(percent)} (${Math.round(percent)}%)`;
}

function letterGrade(percent) {
  if (percent >= 90) return "A";
  if (percent >= 80) return "B";
  if (percent >= 70) return "C";
  if (percent >= 60) return "D";

  return "F";
}

/* ============================================================
   Summary
   ============================================================ */

function renderSummary() {
  summaryTable.innerHTML = "";

  const groups = new Map();

  for (const assignment of assignments) {
    if (!groups.has(assignment.type_name)) {
      groups.set(assignment.type_name, {
        type: assignment.type_name,
        count: 0,
        possible: 0,
        gradedPossible: 0,
        actual: 0
      });
    }

    const group = groups.get(assignment.type_name);

    group.count++;

    group.possible += Number(assignment.possible || 0);

    if (
      assignment.completed &&
      assignment.grade !== null &&
      assignment.grade !== undefined
    ) {
      group.gradedPossible += Number(assignment.possible || 0);

      group.actual += Number(assignment.grade);
    }
  }

  const totalCoursePossible = assignments.reduce(
    (sum, assignment) => sum + Number(assignment.possible || 0),
    0
  );

  let totalActual = 0;

  for (const group of groups.values()) {
    totalActual += group.actual;

    const weight =
      totalCoursePossible > 0
        ? (group.possible / totalCoursePossible) * 100
        : 0;

    const percent =
      group.gradedPossible > 0
        ? (group.actual / group.gradedPossible) * 100
        : null;

    const row = document.createElement("tr");

    row.innerHTML = `
            <td>${escapeHtml(group.type)}</td>

            <td>${group.count}</td>

            <td>
                ${formatNumber(group.possible)}
            </td>

            <td>
                ${formatNumber(group.actual)}
            </td>

            <td>
                ${percent === null ? "" : `${formatNumber(percent)}%`}
            </td>

            <td>
                ${formatNumber(weight)}%
            </td>
        `;

    summaryTable.appendChild(row);
  }

  document.getElementById("summary-count").textContent = assignments.length;

  document.getElementById("summary-possible").textContent =
    formatNumber(totalCoursePossible);

  document.getElementById("summary-actual").textContent =
    formatNumber(totalActual);
}

/* ============================================================
   Assignment Dialog
   ============================================================ */

addAssignmentButton.addEventListener("click", () => {
  showSingleMode();

  assignmentDialog.showModal();

  updateDuePreview();
});

document
  .getElementById("close-assignment-dialog")
  .addEventListener("click", () => assignmentDialog.close());

document.querySelectorAll(".cancel-assignment").forEach((button) => {
  button.addEventListener("click", () => assignmentDialog.close());
});

const singleModeButton = document.getElementById("single-mode-button");

const bulkModeButton = document.getElementById("bulk-mode-button");

const singleForm = document.getElementById("single-assignment-form");

const bulkForm = document.getElementById("bulk-assignment-form");

function showSingleMode() {
  singleForm.classList.remove("hidden");
  bulkForm.classList.add("hidden");

  singleModeButton.classList.add("active");
  bulkModeButton.classList.remove("active");
}

function showBulkMode() {
  singleForm.classList.add("hidden");
  bulkForm.classList.remove("hidden");

  singleModeButton.classList.remove("active");
  bulkModeButton.classList.add("active");
}

singleModeButton.addEventListener("click", showSingleMode);

bulkModeButton.addEventListener("click", showBulkMode);

/* Due preview */

function updateDuePreview() {
  const unitId = Number(document.getElementById("assignment-unit").value);

  const typeId = Number(document.getElementById("assignment-type").value);

  const unit = currentUnits.find((item) => item.id === unitId);

  const type = assignmentTypes.find((item) => item.id === typeId);

  const preview = document.getElementById("due-preview");

  if (!unit || !type) {
    preview.textContent = "Select a unit and type";

    return;
  }

  const [year, month, day] = unit.end_date.split("-").map(Number);

  const date = new Date(year, month - 1, day);

  date.setDate(date.getDate() + Number(type.due_offset_days));

  preview.textContent = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

document
  .getElementById("assignment-unit")
  .addEventListener("change", updateDuePreview);

document
  .getElementById("assignment-type")
  .addEventListener("change", updateDuePreview);

/* Single assignment */

singleForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await api(`/api/courses/${currentCourse.id}/assignments`, {
      method: "POST",

      body: JSON.stringify({
        unitId: Number(document.getElementById("assignment-unit").value),

        typeId: Number(document.getElementById("assignment-type").value),

        name: document.getElementById("assignment-name").value,

        possible: document.getElementById("assignment-possible").value
      })
    });

    document.getElementById("assignment-name").value = "";

    document.getElementById("assignment-possible").value = "";

    await loadAssignments();

    /*
     * Keep the dialog open so several
     * assignments can be entered quickly.
     */
  } catch (error) {
    alert(error.message);
  }
});

/* Bulk assignment */

document.getElementById("select-all-units").addEventListener("click", () => {
  document
    .querySelectorAll(".bulk-unit-checkbox")
    .forEach((input) => (input.checked = true));
});

document.getElementById("clear-all-units").addEventListener("click", () => {
  document
    .querySelectorAll(".bulk-unit-checkbox")
    .forEach((input) => (input.checked = false));
});

const editAssignmentDialog = document.getElementById("edit-assignment-dialog");

const editAssignmentForm = document.getElementById("edit-assignment-form");

function openEditAssignment(id) {
  const assignment = assignments.find((item) => item.id === id);

  if (!assignment) {
    return;
  }

  document.getElementById("edit-assignment-id").value = assignment.id;

  document.getElementById("edit-assignment-unit").value = assignment.unit_id;

  document.getElementById("edit-assignment-type").value = assignment.type_id;

  document.getElementById("edit-assignment-name").value = assignment.name || "";

  document.getElementById("edit-assignment-due").value = assignment.due_date;

  document.getElementById("edit-assignment-possible").value =
    assignment.possible ?? "";

  document.getElementById("edit-assignment-grade").value =
    assignment.grade ?? "";

  document.getElementById("edit-assignment-completed").checked = Boolean(
    assignment.completed
  );

  editAssignmentDialog.showModal();
}

document
  .getElementById("close-edit-dialog")
  .addEventListener("click", () => editAssignmentDialog.close());

document
  .getElementById("cancel-edit-assignment")
  .addEventListener("click", () => editAssignmentDialog.close());

editAssignmentForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const id = document.getElementById("edit-assignment-id").value;

  try {
    await api(`/api/assignments/${id}`, {
      method: "PATCH",

      body: JSON.stringify({
        unitId: Number(document.getElementById("edit-assignment-unit").value),

        typeId: Number(document.getElementById("edit-assignment-type").value),

        name: document.getElementById("edit-assignment-name").value,

        dueDate: document.getElementById("edit-assignment-due").value,

        possible: document.getElementById("edit-assignment-possible").value,

        grade: document.getElementById("edit-assignment-grade").value,

        completed: document.getElementById("edit-assignment-completed").checked
      })
    });

    editAssignmentDialog.close();

    await loadAssignments();
  } catch (error) {
    alert(error.message);
  }
});

document
  .getElementById("delete-assignment-button")
  .addEventListener("click", async () => {
    const id = document.getElementById("edit-assignment-id").value;

    if (!confirm("Permanently delete this assignment?")) {
      return;
    }

    try {
      await api(`/api/assignments/${id}`, {
        method: "DELETE"
      });

      editAssignmentDialog.close();

      await loadAssignments();
    } catch (error) {
      alert(error.message);
    }
  });

bulkForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const mode = getBulkPointsMode();

  const selected = Array.from(
    document.querySelectorAll(".bulk-unit-checkbox:checked")
  );

  if (selected.length === 0) {
    alert("Select at least one unit.");
    return;
  }

  const sharedPossible = document.getElementById(
    "bulk-assignment-possible"
  ).value;

  const requestedAssignments = selected.map((checkbox) => {
    const unitId = Number(checkbox.value);

    let possible;

    if (mode === "same") {
      possible = sharedPossible;
    } else {
      possible = document.querySelector(
        `.bulk-unit-points[data-unit-id="${unitId}"]`
      ).value;
    }

    return {
      unitId,
      possible
    };
  });

  if (mode === "same" && sharedPossible === "") {
    alert("Enter possible points per assignment.");

    return;
  }

  if (
    mode === "individual" &&
    requestedAssignments.some((item) => item.possible === "")
  ) {
    alert("Enter possible points for every selected unit.");

    return;
  }

  try {
    await api(`/api/courses/${currentCourse.id}/assignments/bulk`, {
      method: "POST",

      body: JSON.stringify({
        typeId: Number(document.getElementById("bulk-assignment-type").value),

        assignments: requestedAssignments
      })
    });

    assignmentDialog.close();

    await loadAssignments();
  } catch (error) {
    alert(error.message);
  }
});

/* ============================================================
   Theme
   ============================================================ */

const THEME_STORAGE_KEY = "assignment-tracker-theme";

function getThemePreference() {
  const savedTheme =
    localStorage.getItem(THEME_STORAGE_KEY);

  if (
    savedTheme === "light" ||
    savedTheme === "dark" ||
    savedTheme === "system"
  ) {
    return savedTheme;
  }

  return "system";
}

function getEffectiveTheme(preference) {
  if (preference !== "system") {
    return preference;
  }

  return window.matchMedia(
    "(prefers-color-scheme: dark)"
  ).matches
    ? "dark"
    : "light";
}

function applyTheme(preference) {
  const effectiveTheme =
    getEffectiveTheme(preference);

  document.documentElement.dataset.theme =
    effectiveTheme;

  document.documentElement.dataset.themePreference =
    preference;

  document
    .querySelectorAll(".theme-option")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.theme === preference
      );
    });
}

function setTheme(preference) {
  localStorage.setItem(
    THEME_STORAGE_KEY,
    preference
  );

  applyTheme(preference);
}

document
  .querySelectorAll(".theme-option")
  .forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();

      setTheme(button.dataset.theme);
    });
  });

const systemThemeQuery =
  window.matchMedia(
    "(prefers-color-scheme: dark)"
  );

systemThemeQuery.addEventListener(
  "change",
  () => {
    if (getThemePreference() === "system") {
      applyTheme("system");
    }
  }
);

applyTheme(getThemePreference());

const manageButton = document.getElementById("manage-button");

const manageMenu = document.getElementById("manage-menu");

const addCourseDialog = document.getElementById("add-course-dialog");

const addCourseForm = document.getElementById("add-course-form");

manageButton.addEventListener("click", (event) => {
  event.stopPropagation();

  manageMenu.classList.toggle("hidden");
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".manage-menu-container")) {
    manageMenu.classList.add("hidden");
  }
});

document
  .getElementById("manage-add-course")
  .addEventListener("click", async () => {
    manageMenu.classList.add("hidden");

    await loadSessions();

    document.getElementById("add-course-code").value = "";

    document.getElementById("add-course-name").value = "";

    addCourseDialog.showModal();

    document.getElementById("add-course-code").focus();
  });

document
  .getElementById("close-add-course-dialog")
  .addEventListener("click", () => addCourseDialog.close());

document
  .getElementById("cancel-add-course")
  .addEventListener("click", () => addCourseDialog.close());

addCourseForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const sessionId = Number(document.getElementById("add-course-session").value);

  const code = document.getElementById("add-course-code").value.trim();

  const name = document.getElementById("add-course-name").value.trim();

  try {
    const newCourse = await api("/api/courses", {
      method: "POST",

      body: JSON.stringify({
        sessionId,
        code,
        name
      })
    });

    addCourseDialog.close();

    /*
     * Reload the selectors so the new
     * course immediately appears.
     */
    await loadCourses();
    await loadSessions();

    /*
     * Switch directly to the course
     * we just created.
     */
    courseSelector.value = String(newCourse.id);

    await selectCourse(newCourse);
  } catch (error) {
    alert(error.message);
  }
});

/* ============================================================
   Session Management
   ============================================================ */

const sessionManagementDialog =
  document.getElementById("session-management-dialog");

const sessionManagementList =
  document.getElementById("session-management-list");

const addSessionDialog =
  document.getElementById("add-session-dialog");

const addSessionForm =
  document.getElementById("add-session-form");

const editSessionDialog =
  document.getElementById("edit-session-dialog");

const editSessionForm =
  document.getElementById("edit-session-form");


function buildSessionSchedule(startDate) {
  if (!startDate) {
    return [];
  }

  const [year, month, day] =
    startDate.split("-").map(Number);

  const start =
    new Date(year, month - 1, day);

  const schedule = [];

  for (let unit = 1; unit <= 10; unit++) {
    const unitStart =
      new Date(start);

    unitStart.setDate(
      unitStart.getDate() +
      ((unit - 1) * 7)
    );

    const unitEnd =
      new Date(unitStart);

    unitEnd.setDate(
      unitEnd.getDate() + 6
    );

    schedule.push({
      unit,
      start: unitStart,
      end: unitEnd
    });
  }

  return schedule;
}


function formatScheduleDate(date) {
  return (
    `${date.getMonth() + 1}/` +
    `${date.getDate()}/` +
    `${date.getFullYear()}`
  );
}


function renderSessionSchedule(
  containerId,
  startDate
) {
  const container =
    document.getElementById(containerId);

  const schedule =
    buildSessionSchedule(startDate);

  if (schedule.length === 0) {
    container.innerHTML = `
      <div class="session-schedule-empty">
        Select the first day of Unit 1.
      </div>
    `;

    return;
  }

  container.innerHTML =
    schedule
      .map(
        item => `
          <div class="session-schedule-row">
            <strong>
              Unit ${item.unit}
            </strong>

            <span>
              ${formatScheduleDate(item.start)}
              –
              ${formatScheduleDate(item.end)}
            </span>
          </div>
        `
      )
      .join("");
}


async function openSessionManagement() {
  manageMenu.classList.add("hidden");

  sessionManagementDialog.showModal();

  await renderSessionManagement();
}


async function renderSessionManagement() {
  sessionManagementList.innerHTML = `
    <div class="management-loading">
      Loading...
    </div>
  `;

  try {
    await loadSessions();

    if (sessions.length === 0) {
      sessionManagementList.innerHTML = `
        <div class="management-empty">
          No sessions have been created.
        </div>
      `;

      return;
    }

    sessionManagementList.innerHTML =
      sessions
        .map(
          session => `
            <div
              class="session-management-row"
              data-session-id="${session.id}"
            >
              <div class="managed-session-info">
                <strong>
                  ${escapeHtml(session.code)}
                </strong>

                <span>
                  Started
                  ${formatDate(session.start_date)}
                </span>

                <small>
                  ${Number(session.course_count)}
                  ${
                    Number(session.course_count) === 1
                      ? "course"
                      : "courses"
                  }
                  ${
                    session.course_codes
                      ? ` · ${escapeHtml(session.course_codes)}`
                      : ""
                  }
                </small>
              </div>

              <div class="managed-session-actions">
                <button
                    type="button"
                    class="edit-session-button secondary-button"
                    data-session-id="${session.id}"
                >
                    Edit
                </button>

                ${
                    Number(session.course_count) === 0
                    ? `
                        <button
                            type="button"
                            class="delete-session-button danger-button"
                            data-session-id="${session.id}"
                        >
                            Delete
                        </button>
                        `
                    : ""
                }
                </div>
            </div>
          `
        )
        .join("");

    bindSessionManagementEvents();

  } catch (error) {
    console.error(error);

    sessionManagementList.innerHTML = `
      <div class="management-empty">
        Unable to load sessions.
      </div>
    `;
  }
}


function bindSessionManagementEvents() {
  document
    .querySelectorAll(".edit-session-button")
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          const session =
            sessions.find(
              item =>
                item.id ===
                Number(button.dataset.sessionId)
            );

          if (!session) {
            return;
          }

          document.getElementById(
            "edit-session-id"
          ).value = session.id;

          document.getElementById(
            "edit-session-code"
          ).value = session.code;

          document.getElementById(
            "edit-session-start"
          ).value = session.start_date;

          renderSessionSchedule(
            "edit-session-schedule",
            session.start_date
          );

          editSessionDialog.showModal();
        }
      );
    });

    document
        .querySelectorAll(
            ".delete-session-button"
        )
        .forEach(button => {
            button.addEventListener(
            "click",
            async () => {
                const session =
                sessions.find(
                    item =>
                    item.id ===
                    Number(
                        button.dataset.sessionId
                    )
                );

                if (!session) {
                return;
                }

                if (
                !confirm(
                    `Delete session ${session.code}?\n\n` +
                    "This session contains no courses."
                )
                ) {
                return;
                }

                try {
                await api(
                    `/api/sessions/${session.id}`,
                    {
                    method: "DELETE"
                    }
                );

                await loadSessions();
                await renderSessionManagement();

                } catch (error) {
                alert(error.message);
                }
            }
            );
        });
}


document.getElementById(
  "manage-sessions"
).addEventListener(
  "click",
  openSessionManagement
);


document.getElementById(
  "close-session-management"
).addEventListener(
  "click",
  () => sessionManagementDialog.close()
);


document.getElementById(
  "close-session-management-bottom"
).addEventListener(
  "click",
  () => sessionManagementDialog.close()
);


document.getElementById(
  "add-session-button"
).addEventListener(
  "click",
  () => {
    addSessionForm.reset();

    renderSessionSchedule(
      "add-session-schedule",
      ""
    );

    addSessionDialog.showModal();

    document.getElementById(
      "add-session-code"
    ).focus();
  }
);


document.getElementById(
  "close-add-session"
).addEventListener(
  "click",
  () => addSessionDialog.close()
);


document.getElementById(
  "cancel-add-session"
).addEventListener(
  "click",
  () => addSessionDialog.close()
);


document.getElementById(
  "add-session-start"
).addEventListener(
  "change",
  event => {
    renderSessionSchedule(
      "add-session-schedule",
      event.target.value
    );
  }
);


addSessionForm.addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    const code =
      document.getElementById(
        "add-session-code"
      ).value.trim();

    const startDate =
      document.getElementById(
        "add-session-start"
      ).value;

    try {
      await api(
        "/api/sessions",
        {
          method: "POST",

          body: JSON.stringify({
            code,
            startDate
          })
        }
      );

      addSessionDialog.close();

      await loadSessions();
      await renderSessionManagement();

    } catch (error) {
      alert(error.message);
    }
  }
);


document.getElementById(
  "close-edit-session"
).addEventListener(
  "click",
  () => editSessionDialog.close()
);


document.getElementById(
  "cancel-edit-session"
).addEventListener(
  "click",
  () => editSessionDialog.close()
);


document.getElementById(
  "edit-session-start"
).addEventListener(
  "change",
  event => {
    renderSessionSchedule(
      "edit-session-schedule",
      event.target.value
    );
  }
);


editSessionForm.addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    const sessionId =
      Number(
        document.getElementById(
          "edit-session-id"
        ).value
      );

    const code =
      document.getElementById(
        "edit-session-code"
      ).value.trim();

    const startDate =
      document.getElementById(
        "edit-session-start"
      ).value;

    try {
      await api(
        `/api/sessions/${sessionId}`,
        {
          method: "PATCH",

          body: JSON.stringify({
            code,
            startDate
          })
        }
      );

      editSessionDialog.close();

      await loadSessions();
      await loadCourses();

      /*
       * Refresh the currently displayed
       * course object because its
       * session_code may have changed.
       */
      if (currentCourse) {
        const refreshedCourse =
          courses.find(
            course =>
              course.id === currentCourse.id
          );

        if (refreshedCourse) {
          currentCourse =
            refreshedCourse;

          courseSelector.value =
            String(refreshedCourse.id);

          document.getElementById(
            "course-code"
          ).textContent =
            `${refreshedCourse.code} • ${refreshedCourse.session_code}`;

          /*
           * The unit records may have
           * changed, so reload them too.
           */
          await loadUnits();
        }
      }

      await renderSessionManagement();

    } catch (error) {
      alert(error.message);
    }
  }
);

/* ============================================================
   Course Management
   ============================================================ */

const courseManagementDialog = document.getElementById(
  "course-management-dialog"
);

const courseManagementList = document.getElementById("course-management-list");

const activeCoursesTab = document.getElementById("active-courses-tab");

const archivedCoursesTab = document.getElementById("archived-courses-tab");

const editCourseDialog = document.getElementById("edit-course-dialog");

const editCourseForm = document.getElementById("edit-course-form");

let courseManagementMode = "active";

async function openCourseManagement(mode = "active") {
  courseManagementMode = mode;

  manageMenu.classList.add("hidden");

  courseManagementDialog.showModal();

  await renderCourseManagement();
}

async function renderCourseManagement() {
  const archived = courseManagementMode === "archived";

  activeCoursesTab.classList.toggle("active", !archived);

  archivedCoursesTab.classList.toggle("active", archived);

  courseManagementList.innerHTML = `
        <div class="management-loading">
            Loading...
        </div>
    `;

  try {
    const managedCourses = await api(
      archived ? "/api/courses?archived=only" : "/api/courses"
    );

    if (managedCourses.length === 0) {
      courseManagementList.innerHTML = `
                <div class="management-empty">
                    ${archived ? "No archived courses." : "No active courses."}
                </div>
            `;

      return;
    }

    courseManagementList.innerHTML = managedCourses
      .map(
        (course) => `
                    <div
                        class="course-management-row"
                        data-course-id="${course.id}"
                    >

                        <div class="managed-course-info">

                            <strong>
                                ${escapeHtml(course.code)}
                            </strong>

                            <span>
                                ${escapeHtml(course.name)}
                            </span>

                            <small>
                                Session
                                ${escapeHtml(course.session_code)}
                            </small>

                        </div>

                        <div class="managed-course-actions">

                            ${
                              archived
                                ? `
                                        <button
                                            type="button"
                                            class="restore-course-button secondary-button"
                                            data-course-id="${course.id}"
                                        >
                                            Restore
                                        </button>
                                    `
                                : `
                                        <button
                                            type="button"
                                            class="edit-course-button secondary-button"
                                            data-course-id="${course.id}"
                                        >
                                            Edit
                                        </button>

                                        <button
                                            type="button"
                                            class="archive-course-button secondary-button"
                                            data-course-id="${course.id}"
                                        >
                                            Archive
                                        </button>
                                    `
                            }

                        </div>

                    </div>
                `
      )
      .join("");

    bindCourseManagementEvents(managedCourses);
  } catch (error) {
    courseManagementList.innerHTML = `
            <div class="management-empty">
                Unable to load courses.
            </div>
        `;

    console.error(error);
  }
}

function bindCourseManagementEvents(managedCourses) {
  document.querySelectorAll(".edit-course-button").forEach((button) => {
    button.addEventListener("click", () => {
      const course = managedCourses.find(
        (item) => item.id === Number(button.dataset.courseId)
      );

      if (!course) {
        return;
      }

      document.getElementById("edit-course-id").value = course.id;

      document.getElementById("edit-course-code").value = course.code;

      document.getElementById("edit-course-name").value = course.name;

      const sessionSelect =
        document.getElementById(
            "edit-course-session-select"
        );

        sessionSelect.innerHTML =
        sessions
            .map(
            session => `
                <option
                value="${session.id}"
                ${
                    session.id === course.session_id
                    ? "selected"
                    : ""
                }
                >
                ${escapeHtml(session.code)}
                </option>
            `
            )
            .join("");

        document.getElementById(
        "edit-course-recalculate-dates"
        ).checked = false;

        document.getElementById(
        "recalculate-dates-option"
        ).classList.add("hidden");

        sessionSelect.dataset.originalSessionId =
        String(course.session_id);

      editCourseDialog.showModal();
    });
  });

  document.querySelectorAll(".archive-course-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const course = managedCourses.find(
        (item) => item.id === Number(button.dataset.courseId)
      );

      if (!course) {
        return;
      }

      if (!confirm(`Archive ${course.code} - ${course.name}?`)) {
        return;
      }

      try {
        await api(`/api/courses/${course.id}`, {
          method: "PATCH",

          body: JSON.stringify({
            archived: true
          })
        });

        /*
         * If we archived the course
         * currently being viewed,
         * clear it before reloading.
         */
        if (currentCourse && currentCourse.id === course.id) {
          currentCourse = null;
        }

        await loadCourses();
        await loadSessions();
        await renderCourseManagement();

        /*
         * If there is no longer a
         * selected active course,
         * open the first remaining one.
         */
        if (!currentCourse) {
          if (courses.length > 0) {
            courseSelector.value = String(courses[0].id);

            await selectCourse(courses[0]);
          } else {
            showNoCourse();
          }
        }
      } catch (error) {
        alert(error.message);
      }
    });
  });

  document.querySelectorAll(".restore-course-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const courseId = Number(button.dataset.courseId);

      try {
        await api(`/api/courses/${courseId}`, {
          method: "PATCH",

          body: JSON.stringify({
            archived: false
          })
        });

        await loadCourses();
        await loadSessions();
        await renderCourseManagement();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

document.getElementById(
  "edit-course-session-select"
).addEventListener(
  "change",
  event => {
    const originalSessionId =
      Number(
        event.target.dataset.originalSessionId
      );

    const newSessionId =
      Number(event.target.value);

    document.getElementById(
      "recalculate-dates-option"
    ).classList.toggle(
      "hidden",
      newSessionId === originalSessionId
    );
  }
);

document.getElementById("manage-courses").addEventListener("click", () => {
  openCourseManagement("active");
});

document.getElementById("manage-archived").addEventListener("click", () => {
  openCourseManagement("archived");
});

activeCoursesTab.addEventListener("click", async () => {
  courseManagementMode = "active";
  await renderCourseManagement();
});

archivedCoursesTab.addEventListener("click", async () => {
  courseManagementMode = "archived";
  await renderCourseManagement();
});

document
  .getElementById("close-course-management")
  .addEventListener("click", () => courseManagementDialog.close());

document
  .getElementById("close-course-management-bottom")
  .addEventListener("click", () => courseManagementDialog.close());

document
  .getElementById("close-edit-course")
  .addEventListener("click", () => editCourseDialog.close());

document
  .getElementById("cancel-edit-course")
  .addEventListener("click", () => editCourseDialog.close());

editCourseForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const courseId = Number(document.getElementById("edit-course-id").value);

  const code = document.getElementById("edit-course-code").value.trim();

  const name = document.getElementById("edit-course-name").value.trim();

  const sessionId =
    Number(
        document.getElementById(
        "edit-course-session-select"
        ).value
    );

    const recalculateDates =
    document.getElementById(
        "edit-course-recalculate-dates"
    ).checked;

  try {
    const updated = await api(`/api/courses/${courseId}`, {
      method: "PATCH",

      body: JSON.stringify({
        code,
        name,
        sessionId,
        recalculateDates
      })
    });

    editCourseDialog.close();

    /*
     * Update currentCourse too if
     * we're editing the course
     * currently displayed.
     */
    if (currentCourse && currentCourse.id === courseId) {
      currentCourse = updated;

      document.getElementById("course-name").textContent = updated.name;

      document.getElementById("course-code").textContent =
        `${updated.code} • ${updated.session_code}`;
    }

    await loadCourses();
    await loadSessions();
    await renderCourseManagement();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById(
  "delete-course"
).addEventListener(
  "click",
  async () => {
    const courseId =
      Number(
        document.getElementById(
          "edit-course-id"
        ).value
      );

    const course =
      courses.find(
        item => item.id === courseId
      );

    /*
     * The course might be archived and
     * therefore absent from `courses`.
     * Fall back to the form values.
     */
    const code =
      course?.code ||
      document.getElementById(
        "edit-course-code"
      ).value.trim();

    const name =
      course?.name ||
      document.getElementById(
        "edit-course-name"
      ).value.trim();

    const confirmed =
      confirm(
        `Permanently delete ${code} - ${name}?\n\n` +
        "All assignments and grades in this course " +
        "will also be deleted.\n\n" +
        "This cannot be undone."
      );

    if (!confirmed) {
      return;
    }

    try {
      await api(
        `/api/courses/${courseId}`,
        {
          method: "DELETE"
        }
      );

      editCourseDialog.close();

      if (
        currentCourse &&
        currentCourse.id === courseId
      ) {
        currentCourse = null;
      }

      await loadCourses();
      await loadSessions();
      await renderCourseManagement();

      if (!currentCourse) {
        if (courses.length > 0) {
          courseSelector.value =
            String(courses[0].id);

          await selectCourse(courses[0]);
        } else {
          showNoCourse();
        }
      }

    } catch (error) {
      alert(error.message);
    }
  }
);

/* ============================================================
   Initial Setup
   ============================================================ */

setupButton.addEventListener("click", () => {
  setupDialog.showModal();
});

cancelSetup.addEventListener("click", () => {
  setupDialog.close();
});

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const sessionCode = document.getElementById("session-code").value.trim();

  const startDate = document.getElementById("session-start").value;

  const courseCode = document.getElementById("new-course-code").value.trim();

  const courseName = document.getElementById("new-course-name").value.trim();

  try {
    const session = await api("/api/sessions", {
      method: "POST",

      body: JSON.stringify({
        code: sessionCode,
        startDate
      })
    });

    const course = await api("/api/courses", {
      method: "POST",

      body: JSON.stringify({
        sessionId: session.id,
        code: courseCode,
        name: courseName
      })
    });

    setupDialog.close();
    setupForm.reset();

    await loadCourses();

    courseSelector.value = String(course.id);

    await selectCourse(course);
  } catch (error) {
    alert(error.message);
  }
});

/* ============================================================
   Startup
   ============================================================ */

async function initialize() {
  try {
    await loadCourses();
    await loadSessions();

    if (courses.length > 0) {
      await showHome();
    } else {
      showNoCourse();
    }

  } catch (error) {
    console.error(error);

    alert(
      "Unable to load Assignment Tracker."
    );
  }
}

initialize();
