const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /students - List all registered students
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT enrollment_number, full_name, class_section, created_at FROM students ORDER BY enrollment_number ASC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[Students List] Error:", err);
    res.status(500).json({ error: "Failed to list students." });
  }
});

// GET /students/:enrollmentNumber - Lookup a specific student
router.get("/:enrollmentNumber", async (req, res) => {
  try {
    const { enrollmentNumber } = req.params;
    const result = await db.query(
      "SELECT enrollment_number, full_name, class_section, created_at FROM students WHERE LOWER(enrollment_number) = LOWER($1)",
      [enrollmentNumber.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Student "${enrollmentNumber}" not found.` });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[Student Lookup] Error:", err);
    res.status(500).json({ error: "Failed to fetch student." });
  }
});

// POST /students - Register or update a student
// Body: { enrollmentNumber, fullName, classSection }
router.post("/", async (req, res) => {
  try {
    const { enrollmentNumber, fullName, classSection } = req.body;

    if (!enrollmentNumber || typeof enrollmentNumber !== "string" || !enrollmentNumber.trim()) {
      return res.status(400).json({ error: "enrollmentNumber is required." });
    }
    if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
      return res.status(400).json({ error: "fullName is required." });
    }

    const cleanEnrollment = enrollmentNumber.trim();
    const cleanName = fullName.trim();
    const cleanSection = classSection ? classSection.trim() : null;

    const upsertSql = `
      INSERT INTO students (enrollment_number, full_name, class_section)
      VALUES ($1, $2, $3)
      ON CONFLICT (enrollment_number) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        class_section = EXCLUDED.class_section
      RETURNING enrollment_number, full_name, class_section, created_at
    `;

    const result = await db.query(upsertSql, [cleanEnrollment, cleanName, cleanSection]);

    res.status(201).json({
      message: "Student saved successfully.",
      student: result.rows[0],
    });
  } catch (err) {
    console.error("[Student Register] Error:", err);
    res.status(500).json({ error: "Failed to register student." });
  }
});

// DELETE /students/:enrollmentNumber - Delete a student
router.delete("/:enrollmentNumber", async (req, res) => {
  try {
    const { enrollmentNumber } = req.params;
    const result = await db.query(
      "DELETE FROM students WHERE LOWER(enrollment_number) = LOWER($1) RETURNING enrollment_number",
      [enrollmentNumber.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Student "${enrollmentNumber}" not found.` });
    }

    res.json({ message: `Student "${enrollmentNumber}" removed successfully.` });
  } catch (err) {
    console.error("[Student Delete] Error:", err);
    res.status(500).json({ error: "Failed to delete student." });
  }
});

module.exports = router;
