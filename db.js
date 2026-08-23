const path = require("path");

const knex = require("knex");

const DB_CLIENT = String(process.env.DB_CLIENT || "sqlite3").toLowerCase();

function resolveKnexConfig() {
  if (DB_CLIENT === "mysql2") {
    if (!process.env.DB_CONNECTION_STRING) {
      throw new Error("DB_CONNECTION_STRING is required for MySQL.");
    }

    return {
      client: "mysql2",
      connection: process.env.DB_CONNECTION_STRING,
      pool: { min: 0, max: 10 }
    };
  }

  if (DB_CLIENT === "pg") {
    if (!process.env.DB_CONNECTION_STRING) {
      throw new Error("DB_CONNECTION_STRING is required for PostgreSQL.");
    }

    return {
      client: "pg",
      connection: process.env.DB_CONNECTION_STRING,
      pool: { min: 0, max: 10 }
    };
  }

  const sqliteFile = process.env.SQLITE_FILE || path.join(__dirname, "data", "app.db");
  return {
    client: "sqlite3",
    connection: {
      filename: sqliteFile
    },
    useNullAsDefault: true
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
	if (!columns.active_session_id) {
	  await db.schema.alterTable("users", (table) => table.string("active_session_id", 128).nullable());
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
}

module.exports = {
  db,
  DB_CLIENT,
  ensureSchema
};
