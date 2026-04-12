import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'

interface TableInfoRow {
  name: string
  notnull?: number
}

let db: Database.Database | null = null

function ensureProjectsStatusColumn(database: Database.Database): void {
  const columns = database.prepare("PRAGMA table_info(projects)").all() as TableInfoRow[]
  const hasStatus = columns.some((column) => column.name === 'status')

  if (!hasStatus) {
    database.exec("ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'")
  }

  database.exec("UPDATE projects SET status='idle' WHERE status IS NULL OR status='' ")
}

function ensureRequirementsColumns(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(requirements)').all() as TableInfoRow[]
  const hasSource = columns.some((column) => column.name === 'source')
  const hasStandardizedData = columns.some((column) => column.name === 'standardized_data')
  const hasAgentProcess = columns.some((column) => column.name === 'agent_process')
  const hasAgentSessionId = columns.some((column) => column.name === 'agent_session_id')
  const hasPrdReviewRejectCount = columns.some((column) => column.name === 'prd_review_reject_count')
  const hasWaitingContext = columns.some((column) => column.name === 'waiting_context')
  const hasHumanRevisionNote = columns.some((column) => column.name === 'human_revision_note')

  if (!hasSource) {
    database.exec("ALTER TABLE requirements ADD COLUMN source TEXT NOT NULL DEFAULT ''")
  }

  if (!hasStandardizedData) {
    database.exec("ALTER TABLE requirements ADD COLUMN standardized_data TEXT")
  }

  if (!hasAgentProcess) {
    database.exec("ALTER TABLE requirements ADD COLUMN agent_process TEXT NOT NULL DEFAULT ''")
  }

  if (!hasAgentSessionId) {
    database.exec('ALTER TABLE requirements ADD COLUMN agent_session_id TEXT')
  }

  if (!hasPrdReviewRejectCount) {
    database.exec("ALTER TABLE requirements ADD COLUMN prd_review_reject_count INTEGER NOT NULL DEFAULT 0")
  }

  if (!hasWaitingContext) {
    database.exec("ALTER TABLE requirements ADD COLUMN waiting_context TEXT NOT NULL DEFAULT ''")
  }

  if (!hasHumanRevisionNote) {
    database.exec("ALTER TABLE requirements ADD COLUMN human_revision_note TEXT NOT NULL DEFAULT ''")
  }

  database.exec(`
    DELETE FROM requirements
    WHERE status IN ('processing', 'clarifying', 'skipped', 'failed')
  `)

  database.exec(`
    UPDATE requirements
    SET status = CASE
      WHEN status = 'todo' THEN 'pending'
      WHEN status = 'evaluating' THEN 'evaluating'
      WHEN status = 'canceled' THEN 'canceled'
      WHEN status = 'doing' THEN 'prd_designing'
      WHEN status = 'pending' THEN 'pending'
      WHEN status IN ('queued', 'completed', 'confirmed', 'done') THEN 'queued'
      WHEN status = 'prd_reviewing' THEN 'prd_reviewing'
      WHEN status = 'prd_designing' THEN 'prd_designing'
      ELSE 'pending'
    END
  `)

  database.exec("UPDATE requirements SET source='' WHERE source IS NULL")
  database.exec("UPDATE requirements SET agent_process='' WHERE agent_process IS NULL")
  database.exec("UPDATE requirements SET prd_review_reject_count=0 WHERE prd_review_reject_count IS NULL")
  database.exec("UPDATE requirements SET waiting_context='' WHERE waiting_context IS NULL")
  database.exec("UPDATE requirements SET human_revision_note='' WHERE human_revision_note IS NULL")
}

function ensureRequirementsIndexes(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_requirements_project_created_at
    ON requirements(project_id, created_at DESC)
  `)

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_requirements_project_status_created_at
    ON requirements(project_id, status, created_at DESC)
  `)
}

function ensureRequirementsTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS requirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      source TEXT NOT NULL DEFAULT '',
      standardized_data TEXT,
      prd_review_reject_count INTEGER NOT NULL DEFAULT 0,
      waiting_context TEXT NOT NULL DEFAULT '',
      human_revision_note TEXT NOT NULL DEFAULT '',
      agent_process TEXT NOT NULL DEFAULT '',
      agent_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `)

  ensureRequirementsColumns(database)
  ensureRequirementsIndexes(database)
}

function ensureTasksColumns(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(tasks)').all() as TableInfoRow[]
  const hasProjectId = columns.some((column) => column.name === 'project_id')
  const hasTechReviewRejectCount = columns.some((column) => column.name === 'tech_review_reject_count')
  const hasQaRejectCount = columns.some((column) => column.name === 'qa_reject_count')
  const hasWaitingContext = columns.some((column) => column.name === 'waiting_context')
  const hasHumanRevisionNote = columns.some((column) => column.name === 'human_revision_note')

  if (!hasProjectId) {
    database.exec('ALTER TABLE tasks ADD COLUMN project_id INTEGER')
  }

  if (!hasTechReviewRejectCount) {
    database.exec("ALTER TABLE tasks ADD COLUMN tech_review_reject_count INTEGER NOT NULL DEFAULT 0")
  }

  if (!hasQaRejectCount) {
    database.exec("ALTER TABLE tasks ADD COLUMN qa_reject_count INTEGER NOT NULL DEFAULT 0")
  }

  if (!hasWaitingContext) {
    database.exec("ALTER TABLE tasks ADD COLUMN waiting_context TEXT NOT NULL DEFAULT ''")
  }

  if (!hasHumanRevisionNote) {
    database.exec("ALTER TABLE tasks ADD COLUMN human_revision_note TEXT NOT NULL DEFAULT ''")
  }

  database.exec(`
    UPDATE tasks
    SET project_id = (
      SELECT r.project_id
      FROM requirements r
      WHERE r.id = tasks.requirement_id
    )
    WHERE project_id IS NULL
  `)

  database.exec('UPDATE tasks SET project_id = (SELECT COALESCE(MIN(id), 1) FROM projects) WHERE project_id IS NULL')
}

function ensureTasksSchema(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(tasks)').all() as TableInfoRow[]
  const hasProjectId = columns.some((column) => column.name === 'project_id')
  const requirementIdColumn = columns.find((column) => column.name === 'requirement_id')
  const requirementIdNotNull = requirementIdColumn?.notnull === 1
  const needsRebuild = !hasProjectId || requirementIdNotNull

  if (!needsRebuild) {
    return
  }

  database.exec('DROP TABLE IF EXISTS tasks_new')
  database.exec(`
    CREATE TABLE tasks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      requirement_id INTEGER,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle',
      tech_review_reject_count INTEGER NOT NULL DEFAULT 0,
      qa_reject_count INTEGER NOT NULL DEFAULT 0,
      waiting_context TEXT NOT NULL DEFAULT '',
      human_revision_note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE
    )
  `)

  database.exec(`
    INSERT INTO tasks_new (id, project_id, requirement_id, title, content, status, tech_review_reject_count, qa_reject_count, waiting_context, human_revision_note, created_at, updated_at)
    SELECT
      t.id,
      COALESCE(
        t.project_id,
        (
          SELECT r.project_id
          FROM requirements r
          WHERE r.id = t.requirement_id
        ),
        (SELECT COALESCE(MIN(id), 1) FROM projects)
      ) AS project_id,
      t.requirement_id,
      t.title,
      COALESCE(t.content, ''),
      t.status,
      COALESCE(t.tech_review_reject_count, 0),
      COALESCE(t.qa_reject_count, 0),
      COALESCE(t.waiting_context, ''),
      COALESCE(t.human_revision_note, ''),
      t.created_at,
      t.updated_at
    FROM tasks t
  `)

  database.exec('DROP TABLE tasks')
  database.exec('ALTER TABLE tasks_new RENAME TO tasks')
}

function ensureTasksIndexes(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_project_created_at
    ON tasks(project_id, created_at DESC)
  `)

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_project_status_created_at
    ON tasks(project_id, status, created_at DESC)
  `)

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_requirement_created_at
    ON tasks(requirement_id, created_at DESC)
  `)

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_requirement_status_created_at
    ON tasks(requirement_id, status, created_at DESC)
  `)
}

function ensureTasksTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      requirement_id INTEGER,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle',
      tech_review_reject_count INTEGER NOT NULL DEFAULT 0,
      qa_reject_count INTEGER NOT NULL DEFAULT 0,
      waiting_context TEXT NOT NULL DEFAULT '',
      human_revision_note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE
    )
  `)

  ensureTasksColumns(database)
  ensureTasksSchema(database)

  database.exec(`
    UPDATE tasks
    SET status = CASE
      WHEN status IN ('todo', 'doing', 'queued', 'idle') THEN 'idle'
      WHEN status = 'arch_revising' THEN 'arch_designing'
      WHEN status = 'code_fixing' THEN 'coding'
      WHEN status = 'waiting_human' THEN CASE
        WHEN waiting_context IN ('qa_gate', 'coding_gate') THEN 'coding'
        ELSE 'arch_designing'
      END
      WHEN status IN ('arch_designing', 'tech_reviewing', 'coding', 'qa_reviewing', 'deploying', 'done') THEN status
      WHEN status IN ('done', 'completed') THEN 'done'
      ELSE 'idle'
    END
  `)

  database.exec("UPDATE tasks SET content='' WHERE content IS NULL")
  database.exec("UPDATE tasks SET waiting_context='' WHERE waiting_context IS NULL")
  database.exec("UPDATE tasks SET human_revision_note='' WHERE human_revision_note IS NULL")
  ensureTasksIndexes(database)
}

function ensureStageRunsIndexes(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_stage_runs_entity_stage_round
    ON stage_runs(entity_type, entity_id, stage_key, round DESC)
  `)

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_stage_runs_entity_started
    ON stage_runs(entity_type, entity_id, start_at ASC)
  `)
}

function ensureStageRunsColumns(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(stage_runs)').all() as TableInfoRow[]
  const hasResultStatus = columns.some((column) => column.name === 'result_status')
  const hasFailureReason = columns.some((column) => column.name === 'failure_reason')
  const hasAgentProcess = columns.some((column) => column.name === 'agent_process')
  const hasAgentSessionId = columns.some((column) => column.name === 'agent_session_id')

  if (!hasResultStatus) {
    database.exec("ALTER TABLE stage_runs ADD COLUMN result_status TEXT")
  }

  if (!hasFailureReason) {
    database.exec("ALTER TABLE stage_runs ADD COLUMN failure_reason TEXT NOT NULL DEFAULT ''")
  }

  if (!hasAgentProcess) {
    database.exec("ALTER TABLE stage_runs ADD COLUMN agent_process TEXT NOT NULL DEFAULT ''")
  }

  if (!hasAgentSessionId) {
    database.exec('ALTER TABLE stage_runs ADD COLUMN agent_session_id TEXT')
  }

  database.exec("UPDATE stage_runs SET failure_reason='' WHERE failure_reason IS NULL")
  database.exec("UPDATE stage_runs SET agent_process='' WHERE agent_process IS NULL")
  database.exec("UPDATE stage_runs SET result_status='pending' WHERE result_status IS NULL")
  database.exec("UPDATE stage_runs SET result_status='pending' WHERE result_status=''")
}

function ensureStageRunsTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS stage_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      stage_key TEXT NOT NULL,
      round INTEGER NOT NULL DEFAULT 1,
      start_at INTEGER NOT NULL,
      end_at INTEGER,
      result_status TEXT,
      failure_reason TEXT NOT NULL DEFAULT '',
      artifact_file_names TEXT NOT NULL DEFAULT '[]',
      agent_process TEXT NOT NULL DEFAULT '',
      agent_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  ensureStageRunsColumns(database)
  ensureStageRunsIndexes(database)

  database.exec("UPDATE stage_runs SET result_status='pending' WHERE result_status IS NULL")
  database.exec("UPDATE stage_runs SET result_status='pending' WHERE result_status=''")
}

export function getDb(): Database.Database {
  if (db) {
    return db
  }

  const dbPath = join(app.getPath('userData'), 'app.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'idle',
      created_at INTEGER NOT NULL
    )
  `)

  ensureProjectsStatusColumn(db)

  ensureRequirementsTable(db)
  ensureTasksTable(db)
  ensureStageRunsTable(db)

  return db
}
