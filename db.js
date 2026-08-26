const path = require("path");

const knex = require("knex");

const DB_CLIENT = String(process.env.DB_CLIENT || "sqlite3").toLowerCase();
const DB_POOL_MAX = Math.max(2, Number(process.env.DB_POOL_MAX || 20));

function schoolYearForDate(value) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "numeric" }).formatToParts(safeDate);
  const year = Number(parts.find((part) => part.type === "year").value);
  const month = Number(parts.find((part) => part.type === "month").value);
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function resolveKnexConfig() {
  if (DB_CLIENT === "mysql2") {
    if (!process.env.DB_CONNECTION_STRING) {
      throw new Error("DB_CONNECTION_STRING is required for MySQL.");
    }

    return {
      client: "mysql2",
      connection: process.env.DB_CONNECTION_STRING,
      pool: { min: 0, max: DB_POOL_MAX }
    };
  }

  if (DB_CLIENT === "pg") {
    if (!process.env.DB_CONNECTION_STRING) {
      throw new Error("DB_CONNECTION_STRING is required for PostgreSQL.");
    }

    return {
      client: "pg",
      connection: process.env.DB_CONNECTION_STRING,
      pool: { min: 0, max: DB_POOL_MAX }
    };
  }

  const sqliteFile = process.env.SQLITE_FILE || path.join(__dirname, "data", "app.db");
  return {
    client: "sqlite3",
    connection: {
      filename: sqliteFile
    },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate(connection, done) {
        connection.run("PRAGMA busy_timeout = 5000");
        connection.run("PRAGMA journal_mode = WAL", (error) => done(error, connection));
      }
    }
  };
}

const db = knex(resolveKnexConfig());

async function ensureSchema() {
  const exists = await db.schema.hasTable("users");
  if (!exists) {
    await db.schema.createTable("users", (table) => {
      table.string("id", 64).primary();
      table.string("email", 320).notNullable().unique();
      table.string("password_hash", 255).notNullable();
      table.string("firstname", 120).notNullable();
      table.string("lastname", 120).notNullable();
      table.string("middlename", 120).nullable();
      table.string("district", 150).notNullable();
      table.string("school", 150).notNullable();
	  table.string("account_type", 20).notNullable().defaultTo("school");
	  table.string("username", 120).nullable();
	  table.string("lrn", 12).nullable();
	  table.string("school_id", 30).nullable();
      table.string("position", 80).nullable();
      table.string("role", 20).notNullable().defaultTo("teacher");
      table.boolean("verified").notNullable().defaultTo(false);
      table.boolean("approved").notNullable().defaultTo(false);
      table.string("verification_token_hash", 128).nullable();
      table.bigInteger("verification_token_expires_at").nullable();
      table.bigInteger("verification_email_sent_at").nullable();
      table.bigInteger("resend_window_started_at").nullable();
      table.integer("resend_count").notNullable().defaultTo(0);
      table.integer("failed_login_count").notNullable().defaultTo(0);
      table.bigInteger("lockout_until").nullable();
      table.string("created_at", 40).notNullable();
      table.string("updated_at", 40).notNullable();
    });

    await db.schema.alterTable("users", (table) => {
      table.index(["email"], "idx_users_email");
      table.index(["verification_token_hash"], "idx_users_verification_token_hash");
    });
  }

  const columns = await db("users").columnInfo();
  if (!columns.verification_email_sent_at) {
    await db.schema.alterTable("users", (table) => {
      table.bigInteger("verification_email_sent_at").nullable();
    });
  }
  if (!columns.resend_window_started_at) {
    await db.schema.alterTable("users", (table) => {
      table.bigInteger("resend_window_started_at").nullable();
    });
  }
  if (!columns.resend_count) {
    await db.schema.alterTable("users", (table) => {
      table.integer("resend_count").notNullable().defaultTo(0);
    });
  }
  if (!columns.approved) {
    await db.schema.alterTable("users", (table) => {
      table.boolean("approved").notNullable().defaultTo(false);
    });

    // Keep already verified legacy users active after migration.
    await db("users").where({ verified: true }).update({ approved: true });
  }
  if (!columns.failed_login_count) {
    await db.schema.alterTable("users", (table) => {
      table.integer("failed_login_count").notNullable().defaultTo(0);
    });
  }
  if (!columns.lockout_until) {
    await db.schema.alterTable("users", (table) => {
      table.bigInteger("lockout_until").nullable();
    });
  }
  if (!columns.role) {
    await db.schema.alterTable("users", (table) => {
      table.string("role", 20).notNullable().defaultTo("teacher");
    });
  }
	if (!columns.account_type) {
	  await db.schema.alterTable("users", (table) => table.string("account_type", 20).notNullable().defaultTo("school"));
	}
	if (!columns.username) {
	  await db.schema.alterTable("users", (table) => table.string("username", 120).nullable());
	}
	if (!columns.lrn) {
	  await db.schema.alterTable("users", (table) => table.string("lrn", 12).nullable());
	}
	if (!columns.school_id) {
	  await db.schema.alterTable("users", (table) => table.string("school_id", 30).nullable());
	}
	if (!columns.position) {
	  await db.schema.alterTable("users", (table) => table.string("position", 80).nullable());
	}
	if (!columns.active_session_id) {
	  await db.schema.alterTable("users", (table) => table.string("active_session_id", 128).nullable());
	}
	if (!columns.last_seen_at) {
	  await db.schema.alterTable("users", (table) => table.string("last_seen_at", 40).nullable());
	}
	try {
	  if (DB_CLIENT === "mysql2") {
		await db.raw("CREATE UNIQUE INDEX uq_users_username ON users (username)");
	  } else {
		await db.raw("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON users (username) WHERE username IS NOT NULL");
	  }
	} catch (error) {
	  const message = String((error && error.message) || "").toLowerCase();
	  if (!message.includes("already exists") && !message.includes("duplicate key name")) throw error;
	}
	const studentProfileColumns = {
	  profile_image: 500, extension_name: 40, gender: 30, birth_date: 40,
	  current_residence: 500, religion: 120, mother_tongue: 120, ethnicity: 120,
	  mothers_maiden_name: 240, fathers_name: 240, guardian_name: 240, guardian_contact: 80
	};
	for (const [columnName, length] of Object.entries(studentProfileColumns)) {
	  if (!columns[columnName]) {
		try {
		  await db.schema.alterTable("users", (table) => table.string(columnName, length).nullable());
		} catch (error) {
		  const message = String((error && error.message) || "").toLowerCase();
		  if (!message.includes("duplicate column") && !message.includes("already exists")) throw error;
		}
	  }
	}
	if (!columns.profile_image_data) {
	  await db.schema.alterTable("users", (table) => table.binary("profile_image_data").nullable());
	}
	if (!columns.profile_image_mime_type) {
	  await db.schema.alterTable("users", (table) => table.string("profile_image_mime_type", 120).nullable());
	}

  const sessionsExists = await db.schema.hasTable("sessions");
  if (!sessionsExists) {
    await db.schema.createTable("sessions", (table) => {
      table.string("sid", 160).primary();
      table.text("data").notNullable();
      table.bigInteger("expires_at").notNullable();
      table.index(["expires_at"], "idx_sessions_expires_at");
    });
  }

  const learnersExists = await db.schema.hasTable("learners");
  if (!learnersExists) {
    await db.schema.createTable("learners", (table) => {
      table.string("id", 64).primary();
      table.string("user_id", 64).notNullable();
      table.string("learner_code", 50).notNullable();
      table.string("family_name", 120).notNullable();
      table.string("firstname", 120).notNullable();
      table.string("middlename", 120).nullable();
      table.string("grade", 30).notNullable();
      table.string("district", 150).notNullable();
      table.string("school", 150).notNullable();
      table.string("school_address", 255).nullable();
      table.string("modality", 120).notNullable();
      table.string("type_of_instruction", 100).notNullable();
      table.string("type_of_distance_learning", 150).nullable();
      table.string("date_started", 20).notNullable();
      table.integer("first_grading_grade").nullable();
      table.string("first_grading_verbal", 60).nullable();
      table.string("first_grading_interpretation", 255).nullable();
      table.integer("second_quarter_grade").nullable();
      table.string("second_quarter_verbal", 60).nullable();
      table.string("second_quarter_interpretation", 255).nullable();
      table.integer("third_quarter_grade").nullable();
      table.string("third_quarter_verbal", 60).nullable();
      table.string("third_quarter_interpretation", 255).nullable();
      table.string("intervention", 255).nullable();
      table.integer("fourth_quarter_grade").nullable();
      table.string("fourth_quarter_verbal", 60).nullable();
      table.string("fourth_quarter_interpretation", 255).nullable();
      table.string("phil_iri_result", 80).nullable();
      table.string("rma_result", 80).nullable();
      table.string("ellna_result", 80).nullable();
      table.string("flexible_learning_delivery", 255).nullable();
      table.string("alternative_learning_spaces", 255).nullable();
      table.string("learning_resources_materials", 255).nullable();
      table.string("assessment_monitoring", 255).nullable();
      table.string("parent_community_engagement", 255).nullable();
      table.string("technology_connectivity_support", 255).nullable();
      table.string("academic_recovery_reintegration", 255).nullable();
      table.string("equity_inclusion_measures", 255).nullable();
      table.string("utilization_learning_gadgets", 80).nullable();
      table.string("provision_learning_gadgets", 80).nullable();
      table.string("created_at", 40).notNullable();
      table.string("updated_at", 40).notNullable();
    });
  } else {
    // Add grading columns to existing tables (migration)
    const hasFgg = await db.schema.hasColumn("learners", "first_grading_grade");
    if (!hasFgg) {
      await db.schema.alterTable("learners", (t) => {
        t.integer("first_grading_grade").nullable();
        t.string("first_grading_verbal", 60).nullable();
      });
    }

    const hasFgi = await db.schema.hasColumn("learners", "first_grading_interpretation");
    if (!hasFgi) {
      await db.schema.alterTable("learners", (t) => {
        t.string("first_grading_interpretation", 255).nullable();
      });
    }

    const hasSqg = await db.schema.hasColumn("learners", "second_quarter_grade");
    if (!hasSqg) {
      await db.schema.alterTable("learners", (t) => {
        t.integer("second_quarter_grade").nullable();
        t.string("second_quarter_verbal", 60).nullable();
        t.string("second_quarter_interpretation", 255).nullable();
      });
    }

    const hasTqg = await db.schema.hasColumn("learners", "third_quarter_grade");
    if (!hasTqg) {
      await db.schema.alterTable("learners", (t) => {
        t.integer("third_quarter_grade").nullable();
        t.string("third_quarter_verbal", 60).nullable();
        t.string("third_quarter_interpretation", 255).nullable();
      });
    }

    const hasIntervention = await db.schema.hasColumn("learners", "intervention");
    if (!hasIntervention) {
      await db.schema.alterTable("learners", (t) => {
        t.string("intervention", 255).nullable();
      });
    }

    const hasFoqg = await db.schema.hasColumn("learners", "fourth_quarter_grade");
    if (!hasFoqg) {
      await db.schema.alterTable("learners", (t) => {
        t.integer("fourth_quarter_grade").nullable();
        t.string("fourth_quarter_verbal", 60).nullable();
        t.string("fourth_quarter_interpretation", 255).nullable();
      });
    }

    const hasPhilIri = await db.schema.hasColumn("learners", "phil_iri_result");
    if (!hasPhilIri) {
      await db.schema.alterTable("learners", (t) => {
        t.string("phil_iri_result", 80).nullable();
        t.string("rma_result", 80).nullable();
        t.string("ellna_result", 80).nullable();
        t.string("flexible_learning_delivery", 255).nullable();
        t.string("alternative_learning_spaces", 255).nullable();
        t.string("learning_resources_materials", 255).nullable();
        t.string("assessment_monitoring", 255).nullable();
        t.string("parent_community_engagement", 255).nullable();
        t.string("technology_connectivity_support", 255).nullable();
        t.string("academic_recovery_reintegration", 255).nullable();
        t.string("equity_inclusion_measures", 255).nullable();
        t.string("utilization_learning_gadgets", 80).nullable();
        t.string("provision_learning_gadgets", 80).nullable();
      });
    }
  }

  const learnerColumns = await db("learners").columnInfo();
  if (!learnerColumns.adviser_user_id || !learnerColumns.teacher_adviser) {
    await db.schema.alterTable("learners", (table) => {
      if (!learnerColumns.adviser_user_id) table.string("adviser_user_id", 64).nullable();
      if (!learnerColumns.teacher_adviser) table.string("teacher_adviser", 240).nullable();
    });
  }

  if (!(await db.schema.hasTable("learning_resources"))) {
    await db.schema.createTable("learning_resources", (table) => {
      table.string("id", 64).primary();
      table.string("teacher_user_id", 64).notNullable();
      table.string("student_user_id", 64).notNullable();
      table.string("learner_id", 64).notNullable();
      table.string("resource_type", 40).notNullable();
      table.string("title", 220).notNullable();
      table.string("subject", 120).nullable();
      table.string("description", 600).nullable();
      table.string("original_name", 255).notNullable();
      table.string("stored_path", 500).notNullable();
      table.string("mime_type", 120).nullable();
      table.integer("file_size").notNullable().defaultTo(0);
      table.string("created_at", 40).notNullable();
      table.index(["teacher_user_id"], "idx_learning_resource_teacher");
      table.index(["student_user_id"], "idx_learning_resource_student");
    });
  }
  const resourceColumns = await db("learning_resources").columnInfo();
  const missingResourceColumns = ["term", "module_number", "status", "started_at", "resource_file_data", "resource_file_durable", "answer_original_name", "answer_stored_path", "answer_mime_type", "answer_file_size", "answer_file_data", "answer_file_durable", "submitted_at", "final_grade", "graded_at", "graded_by_user_id"];
  if (missingResourceColumns.some((name) => !resourceColumns[name])) {
    await db.schema.alterTable("learning_resources", (table) => {
      if (!resourceColumns.term) table.integer("term").notNullable().defaultTo(1);
      if (!resourceColumns.module_number) table.integer("module_number").notNullable().defaultTo(1);
      if (!resourceColumns.status) table.string("status", 30).notNullable().defaultTo("assigned");
      if (!resourceColumns.started_at) table.string("started_at", 40).nullable();
      if (!resourceColumns.resource_file_data) table.binary("resource_file_data").nullable();
      if (!resourceColumns.resource_file_durable) table.boolean("resource_file_durable").notNullable().defaultTo(false);
      if (!resourceColumns.answer_original_name) table.string("answer_original_name", 255).nullable();
      if (!resourceColumns.answer_stored_path) table.string("answer_stored_path", 500).nullable();
      if (!resourceColumns.answer_mime_type) table.string("answer_mime_type", 120).nullable();
      if (!resourceColumns.answer_file_size) table.integer("answer_file_size").nullable();
      if (!resourceColumns.answer_file_data) table.binary("answer_file_data").nullable();
      if (!resourceColumns.answer_file_durable) table.boolean("answer_file_durable").notNullable().defaultTo(false);
      if (!resourceColumns.submitted_at) table.string("submitted_at", 40).nullable();
      if (!resourceColumns.final_grade) table.integer("final_grade").nullable();
      if (!resourceColumns.graded_at) table.string("graded_at", 40).nullable();
      if (!resourceColumns.graded_by_user_id) table.string("graded_by_user_id", 64).nullable();
    });
  }

  if (!(await db.schema.hasTable("online_quizzes"))) {
    await db.schema.createTable("online_quizzes", (table) => {
      table.string("id", 64).primary();
      table.string("teacher_user_id", 64).notNullable();
      table.string("student_user_id", 64).notNullable();
      table.string("learner_id", 64).notNullable();
      table.integer("term").notNullable().defaultTo(1);
      table.integer("activity_number").notNullable().defaultTo(1);
      table.string("title", 220).notNullable();
      table.string("subject", 120).nullable();
      table.text("instructions").nullable();
      table.integer("total_points").notNullable().defaultTo(0);
      table.string("created_at", 40).notNullable();
      table.index(["teacher_user_id"], "idx_online_quiz_teacher");
      table.index(["student_user_id"], "idx_online_quiz_student");
    });
  }

  if (!(await db.schema.hasTable("online_quiz_questions"))) {
    await db.schema.createTable("online_quiz_questions", (table) => {
      table.string("id", 64).primary();
      table.string("quiz_id", 64).notNullable();
      table.integer("question_order").notNullable();
      table.string("question_type", 30).notNullable();
      table.text("prompt").notNullable();
      table.text("options_json").nullable();
      table.text("correct_answer").notNullable();
      table.integer("points").notNullable().defaultTo(1);
      table.index(["quiz_id"], "idx_online_quiz_question_quiz");
    });
  }

  if (!(await db.schema.hasTable("online_quiz_attempts"))) {
    await db.schema.createTable("online_quiz_attempts", (table) => {
      table.string("id", 64).primary();
      table.string("quiz_id", 64).notNullable();
      table.string("student_user_id", 64).notNullable();
      table.string("status", 30).notNullable().defaultTo("ongoing");
      table.text("answers_json").nullable();
      table.integer("score").nullable();
      table.integer("total_points").nullable();
      table.float("percentage").nullable();
      table.string("started_at", 40).notNullable();
      table.string("submitted_at", 40).nullable();
      table.unique(["quiz_id", "student_user_id"], "uq_online_quiz_attempt_student");
      table.index(["student_user_id"], "idx_online_quiz_attempt_student");
    });
  }

  const approvalRequestsExists = await db.schema.hasTable("approval_requests");
  if (!approvalRequestsExists) {
    await db.schema.createTable("approval_requests", (table) => {
      table.string("id", 64).primary();
      table.string("learner_id", 64).notNullable();
      table.string("requestor_user_id", 64).notNullable();
      table.string("district", 150).notNullable();
      table.string("school", 150).notNullable();
      table.string("requestor_name", 255).notNullable();
      table.string("learner_name", 255).notNullable();
      table.string("document_path", 255).notNullable();
      table.string("status", 30).notNullable().defaultTo("pending");
      table.string("review_note", 255).nullable();
      table.string("reviewed_by", 255).nullable();
      table.string("reviewed_by_user_id", 64).nullable();
      table.string("reviewed_at", 40).nullable();
      table.string("created_at", 40).notNullable();
      table.string("updated_at", 40).notNullable();
    });

    await db.schema.alterTable("approval_requests", (table) => {
      table.index(["requestor_user_id"], "idx_approval_requests_requestor");
      table.index(["learner_id"], "idx_approval_requests_learner");
      table.index(["status"], "idx_approval_requests_status");
    });
  } else {
    const requestColumns = await db("approval_requests").columnInfo();
    if (!requestColumns.review_note) {
      await db.schema.alterTable("approval_requests", (table) => {
        table.string("review_note", 255).nullable();
      });
    }
    if (!requestColumns.reviewed_by) {
      await db.schema.alterTable("approval_requests", (table) => {
        table.string("reviewed_by", 255).nullable();
      });
    }
    if (!requestColumns.reviewed_by_user_id) {
      await db.schema.alterTable("approval_requests", (table) => {
        table.string("reviewed_by_user_id", 64).nullable();
      });
    }
    if (!requestColumns.reviewed_at) {
      await db.schema.alterTable("approval_requests", (table) => {
        table.string("reviewed_at", 40).nullable();
      });
    }
  }

  const admRequestsExists = await db.schema.hasTable("adm_requests");
  if (!admRequestsExists) {
    await db.schema.createTable("adm_requests", (table) => {
      table.string("id", 64).primary();
      table.string("requestor_user_id", 64).notNullable();
      table.string("request_date", 20).notNullable();
      table.string("district", 150).notNullable();
      table.string("school", 150).notNullable();
      table.string("adm_focal", 255).notNullable();
      table.text("reason_for_adm").notNullable();
      table.string("duration_from", 20).notNullable();
      table.string("duration_to", 20).notNullable();
      table.string("requestor_name", 255).notNullable();
      table.string("psds_endorsement_path", 255).notNullable();
      table.string("secondary_document_path", 255).notNullable();
      table.string("approval_pdf_path", 255).nullable();
      table.string("status", 30).notNullable().defaultTo("pending");
      table.string("review_note", 255).nullable();
      table.string("reviewed_by", 255).nullable();
      table.string("reviewed_by_user_id", 64).nullable();
      table.string("reviewed_at", 40).nullable();
      table.string("created_at", 40).notNullable();
      table.string("updated_at", 40).notNullable();
    });

    await db.schema.alterTable("adm_requests", (table) => {
      table.index(["requestor_user_id"], "idx_adm_requests_requestor");
      table.index(["status"], "idx_adm_requests_status");
      table.index(["request_date"], "idx_adm_requests_request_date");
    });
  } else {
    const admRequestColumns = await db("adm_requests").columnInfo();
    if (!admRequestColumns.review_note) {
      await db.schema.alterTable("adm_requests", (table) => {
        table.string("review_note", 255).nullable();
      });
    }
    if (!admRequestColumns.reviewed_by) {
      await db.schema.alterTable("adm_requests", (table) => {
        table.string("reviewed_by", 255).nullable();
      });
    }
    if (!admRequestColumns.reviewed_by_user_id) {
      await db.schema.alterTable("adm_requests", (table) => {
        table.string("reviewed_by_user_id", 64).nullable();
      });
    }
    if (!admRequestColumns.reviewed_at) {
      await db.schema.alterTable("adm_requests", (table) => {
        table.string("reviewed_at", 40).nullable();
      });
    }
    if (!admRequestColumns.approval_pdf_path) {
      await db.schema.alterTable("adm_requests", (table) => {
        table.string("approval_pdf_path", 255).nullable();
      });
    }
    if (!admRequestColumns.reason_for_adm) {
      await db.schema.alterTable("adm_requests", (table) => {
        table.text("reason_for_adm").nullable();
      });
    }
    if (!admRequestColumns.duration_from) {
      await db.schema.alterTable("adm_requests", (table) => {
        table.string("duration_from", 20).nullable();
      });
    }
    if (!admRequestColumns.duration_to) {
      await db.schema.alterTable("adm_requests", (table) => {
        table.string("duration_to", 20).nullable();
      });
    }

    // Add theme preference to users table
    const userColumns = await db("users").columnInfo();
    if (!userColumns.theme_preference) {
      await db.schema.alterTable("users", (table) => {
        table.string("theme_preference", 10).notNullable().defaultTo("light");
      });
    }
  }

  if (!(await db.schema.hasTable("student_module_progress"))) {
    await db.schema.createTable("student_module_progress", (table) => {
      table.string("id", 64).primary();
      table.string("student_user_id", 64).notNullable();
      table.integer("module_no").notNullable();
      table.string("module_title", 180).notNullable();
      table.string("status", 30).notNullable().defaultTo("not_answered");
      table.string("answered_at", 40).nullable();
      table.string("updated_at", 40).notNullable();
      table.unique(["student_user_id", "module_no"], "uq_student_module_progress");
      table.index(["student_user_id"], "idx_student_module_student");
    });
  }

  if (!(await db.schema.hasTable("student_attendance"))) {
    await db.schema.createTable("student_attendance", (table) => {
      table.string("id", 64).primary();
      table.string("student_user_id", 64).notNullable();
      table.string("school_year", 20).notNullable();
      table.string("first_day", 20).nullable();
      ["jun", "jul", "aug", "sep", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may"].forEach((month) => table.integer(month).notNullable().defaultTo(0));
      table.integer("total").notNullable().defaultTo(0);
      table.float("percentage").notNullable().defaultTo(0);
      table.string("updated_at", 40).notNullable();
      table.unique(["student_user_id", "school_year"], "uq_student_attendance_year");
      table.index(["student_user_id"], "idx_student_attendance_student");
    });
  }

  const schoolYearTables = [
    ["learners", "date_started"],
    ["learning_resources", "created_at"],
    ["online_quizzes", "created_at"],
    ["approval_requests", "created_at"],
    ["adm_requests", "request_date"],
    ["student_module_progress", "updated_at"]
  ];
  for (const [tableName, dateColumn] of schoolYearTables) {
    const columns = await db(tableName).columnInfo();
    if (!columns.school_year) {
      await db.schema.alterTable(tableName, (table) => table.string("school_year", 20).nullable());
    }
    const recordsWithoutSchoolYear = await db(tableName).whereNull("school_year").select("id", dateColumn);
    for (const record of recordsWithoutSchoolYear) {
      await db(tableName).where({ id: record.id }).update({ school_year: schoolYearForDate(record[dateColumn]) });
    }
  }
}

module.exports = {
  db,
  DB_CLIENT,
  ensureSchema
};
