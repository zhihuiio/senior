import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions,
} from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  askAgent,
  getRequirementConversation,
  getTaskHumanConversation,
  getTaskStageRunTrace,
  listTaskArtifacts,
  orchestrateTask,
  processRequirement,
  readTaskArtifact,
  replyTaskHumanConversation,
  replyRequirementConversation,
} from "./agent";
import {
  IPC_CHANNELS,
  type AgentAskReq,
  type AgentAskResult,
  type ProjectCreateReq,
  type ProjectCreateResult,
  type ProjectListResult,
  type ProjectRevealInFinderReq,
  type ProjectRevealInFinderResult,
  type RequirementCreateReq,
  type RequirementCreateResult,
  type RequirementListByProjectReq,
  type RequirementListByProjectResult,
  type RequirementUpdateReq,
  type RequirementUpdateResult,
  type RequirementApplyActionReq,
  type RequirementApplyActionResult,
  type RequirementProcessReq,
  type RequirementProcessResult,
  type RequirementGetConversationReq,
  type RequirementGetConversationResult,
  type RequirementReplyConversationReq,
  type RequirementReplyConversationResult,
  type RequirementAutoProcessorStartReq,
  type RequirementAutoProcessorStartResult,
  type RequirementAutoProcessorStopResult,
  type RequirementAutoProcessorStatusResult,
  type RequirementStageRunListReq,
  type RequirementStageRunListResult,
  type TaskAutoProcessorStartReq,
  type TaskAutoProcessorStartResult,
  type TaskAutoProcessorStopResult,
  type TaskAutoProcessorStatusResult,
  type TaskCreateReq,
  type TaskCreateResult,
  type TaskListByProjectReq,
  type TaskListByProjectResult,
  type TaskListByRequirementReq,
  type TaskListByRequirementResult,
  type TaskUpdateReq,
  type TaskUpdateResult,
  type TaskApplyActionReq,
  type TaskApplyActionResult,
  type TaskHumanCommandReq,
  type TaskHumanCommandResult,
  type TaskHumanConversationGetReq,
  type TaskHumanConversationGetResult,
  type TaskHumanConversationReplyReq,
  type TaskHumanConversationReplyResult,
  type TaskOrchestrateReq,
  type TaskOrchestrateResult,
  type TaskArtifactListReq,
  type TaskArtifactListResult,
  type TaskArtifactReadReq,
  type TaskArtifactReadResult,
  type TaskStageRunListReq,
  type TaskStageRunListResult,
  type TaskStageRunTraceGetReq,
  type TaskStageRunTraceGetResult,
} from "../shared/ipc";
import { getDb } from "./db";
import {
  createProjectByPath,
  getProject,
  getProjects,
  ProjectServiceError,
} from "./project-service";
import {
  applyRequirementAction,
  createRequirement,
  getRequirementsByProject,
  getRequirementsGlobal,
  RequirementServiceError,
  updateRequirementDetail,
} from "./requirement-service";
import { getRequirementById } from "./requirement-repo";
import type { Requirement, Task, TaskStatus } from "../shared/types";
import {
  applyTaskAction,
  applyTaskHumanCommand,
  createTask,
  ensureTaskCurrentStageRun,
  getTaskDetail,
  getTaskWaitingContext,
  getTasksByProject,
  getTasksByRequirement,
  getTasksGlobal,
  getTaskStageRuns,
  isTaskWaitingHumanStatus,
  TaskServiceError,
  updateTaskDetail,
} from "./task-service";
import { failAllRunningTaskStageRuns } from "./task-stage-run-repo";
import { failAllRunningRequirementStageRuns, listRequirementStageRuns } from "./requirement-stage-run-repo";
import { onTaskStageTraceChanged } from "./task-stage-trace-events";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const REQUIREMENT_AUTO_PROCESSOR_INTERVAL_MS = 10_000;
const REQUIREMENT_AUTO_PROCESSOR_MAX_PROCESSING = 3;
const TASK_AUTO_PROCESSOR_INTERVAL_MS = 10_000;
const TASK_AUTO_PROCESSOR_MAX_PROCESSING = 3;

let autoProcessorRunning = false;
let autoProcessorTimer: NodeJS.Timeout | null = null;
let autoProcessorTicking = false;
let autoProcessorStartedAt: number | null = null;
let taskAutoProcessorRunning = false;
let taskAutoProcessorTimer: NodeJS.Timeout | null = null;
let taskAutoProcessorTicking = false;
let taskAutoProcessorStartedAt: number | null = null;
const taskOrchestratingRuns = new Map<number, Promise<Task>>();

function emitRequirementStatusChanged(requirement: Requirement): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.REQUIREMENT_STATUS_CHANGED, {
      requirementId: requirement.id,
      projectId: requirement.projectId,
      status: requirement.status,
    });
  }
}

function emitTaskStatusChanged(task: Task): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.TASK_STATUS_CHANGED, {
      taskId: task.id,
      projectId: task.projectId,
      status: task.status,
      waitingContext: task.waitingContext,
    });
  }
}

function emitTaskStageTraceChanged(payload: {
  taskId: number;
  stageRunId: number;
  stageKey: TaskStatus;
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.TASK_STAGE_TRACE_CHANGED, payload);
  }
}

async function runRequirementWithStatusBroadcast<T>(
  getBefore: () => Requirement | null,
  run: () => Promise<T>,
  resolveAfter: (result: T) => Requirement | null,
): Promise<T> {
  const before = getBefore();
  const result = await run();
  const after = resolveAfter(result);
  if (
    after &&
    (!before ||
      before.status !== after.status ||
      before.waitingContext !== after.waitingContext)
  ) {
    emitRequirementStatusChanged(after);
  }
  return result;
}

async function runTaskWithStatusBroadcast<T>(
  getBefore: () => Task | null,
  run: () => Promise<T>,
  resolveAfter: (result: T) => Task | null,
): Promise<T> {
  const before = getBefore();
  const result = await run();
  const after = resolveAfter(result);
  if (
    after &&
    (!before ||
      before.status !== after.status ||
      before.waitingContext !== after.waitingContext)
  ) {
    emitTaskStatusChanged(after);
  }
  return result;
}

function shouldBroadcastTaskStatusChange(
  before: Task | null,
  after: Task,
): boolean {
  if (!before) {
    return true;
  }

  return (
    before.status !== after.status ||
    before.waitingContext !== after.waitingContext
  );
}

function safeGetTaskDetail(taskId: number): Task | null {
  try {
    return getTaskDetail(taskId);
  } catch {
    return null;
  }
}

function runTaskOrchestration(taskId: number): Promise<Task> {
  const existing = taskOrchestratingRuns.get(taskId);
  if (existing) {
    return existing;
  }

  const run = orchestrateTask(taskId, {
    onTaskTransition: (before, after) => {
      if (shouldBroadcastTaskStatusChange(before, after)) {
        emitTaskStatusChanged(after);
      }
    },
  }).finally(() => {
    taskOrchestratingRuns.delete(taskId);
  });
  taskOrchestratingRuns.set(taskId, run);
  return run;
}

function getAutoProcessorStatusData(): {
  running: boolean;
  startedAt: number | null;
} {
  return {
    running: autoProcessorRunning,
    startedAt: autoProcessorStartedAt,
  };
}

function clearAutoProcessorTimer(): void {
  if (!autoProcessorTimer) {
    return;
  }

  clearTimeout(autoProcessorTimer);
  autoProcessorTimer = null;
}

function scheduleNextAutoProcessorTick(): void {
  clearAutoProcessorTimer();

  if (!autoProcessorRunning) {
    return;
  }

  autoProcessorTimer = setTimeout(() => {
    void runRequirementAutoProcessorTick();
  }, REQUIREMENT_AUTO_PROCESSOR_INTERVAL_MS);
}

async function runRequirementAutoProcessorTick(): Promise<void> {
  if (!autoProcessorRunning) {
    return;
  }

  if (autoProcessorTicking) {
    scheduleNextAutoProcessorTick();
    return;
  }

  autoProcessorTicking = true;

  try {
    const db = getDb();
    const processingCountRow = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM stage_runs
         WHERE entity_type = 'requirement'
           AND result_status = 'running'
           AND end_at IS NULL`,
      )
      .get() as { count: number };

    const processingCount = Number.isInteger(processingCountRow?.count)
      ? processingCountRow.count
      : 0;
    if (processingCount >= REQUIREMENT_AUTO_PROCESSOR_MAX_PROCESSING) {
      return;
    }

    const requirements = getRequirementsGlobal();
    const candidate = requirements.find(
      (item: Requirement) =>
        item.status === "pending" ||
        item.status === "evaluating" ||
        (item.status === "prd_designing" && !item.waitingContext) ||
        item.status === "prd_reviewing",
    );

    if (!candidate) {
      return;
    }

    await runRequirementWithStatusBroadcast(
      () => getRequirementById(candidate.id),
      () =>
        processRequirement({
          requirementId: candidate.id,
          type: "product",
          source: "自动轮询",
        }),
      (outcome) => outcome.requirement,
    );
  } catch (error) {
    console.error("[requirement-auto-processor] tick failed", error);
  } finally {
    autoProcessorTicking = false;
    scheduleNextAutoProcessorTick();
  }
}

function startRequirementAutoProcessor(): {
  running: boolean;
  startedAt: number | null;
} {
  if (autoProcessorRunning) {
    return getAutoProcessorStatusData();
  }

  autoProcessorRunning = true;
  autoProcessorStartedAt = Date.now();
  clearAutoProcessorTimer();
  void runRequirementAutoProcessorTick();

  return getAutoProcessorStatusData();
}

function stopRequirementAutoProcessor(): {
  running: boolean;
  startedAt: number | null;
} {
  autoProcessorRunning = false;
  autoProcessorStartedAt = null;
  clearAutoProcessorTimer();

  return getAutoProcessorStatusData();
}

function getTaskAutoProcessorStatusData(): {
  running: boolean;
  startedAt: number | null;
} {
  return {
    running: taskAutoProcessorRunning,
    startedAt: taskAutoProcessorStartedAt,
  };
}

function clearTaskAutoProcessorTimer(): void {
  if (!taskAutoProcessorTimer) {
    return;
  }

  clearTimeout(taskAutoProcessorTimer);
  taskAutoProcessorTimer = null;
}

function scheduleNextTaskAutoProcessorTick(): void {
  clearTaskAutoProcessorTimer();

  if (!taskAutoProcessorRunning) {
    return;
  }

  taskAutoProcessorTimer = setTimeout(() => {
    void runTaskAutoProcessorTick();
  }, TASK_AUTO_PROCESSOR_INTERVAL_MS);
}

function isTaskProcessingStatus(status: string): boolean {
  return (
    status === "arch_designing" ||
    status === "tech_reviewing" ||
    status === "coding" ||
    status === "qa_reviewing" ||
    status === "deploying"
  );
}

function hasOpenTaskStageRunForStatus(
  taskId: number,
  status: TaskStatus,
): boolean {
  return getTaskStageRuns(taskId).some(
    (run) =>
      run.stageKey === status &&
      run.endAt === null &&
      (run.resultStatus === "running" || run.resultStatus === "waiting_human"),
  );
}

async function runTaskAutoProcessorTick(): Promise<void> {
  if (!taskAutoProcessorRunning) {
    return;
  }

  if (taskAutoProcessorTicking) {
    scheduleNextTaskAutoProcessorTick();
    return;
  }

  taskAutoProcessorTicking = true;

  try {
    const tasks = getTasksGlobal();
    const processingCount = taskOrchestratingRuns.size;

    if (processingCount >= TASK_AUTO_PROCESSOR_MAX_PROCESSING) {
      return;
    }

    const runnableProcessingTask = tasks.find((task) => {
      if (!isTaskProcessingStatus(task.status)) {
        return false;
      }
      if (isTaskWaitingHumanStatus(task)) {
        return false;
      }
      if (taskOrchestratingRuns.has(task.id)) {
        return false;
      }
      return true;
    });

    let picked: Task | null = null;
    if (runnableProcessingTask) {
      if (!hasOpenTaskStageRunForStatus(runnableProcessingTask.id, runnableProcessingTask.status)) {
        ensureTaskCurrentStageRun(runnableProcessingTask.id);
      }
      picked = runnableProcessingTask;
    } else {
      const idleTask = tasks.find(
        (task) => task.status === "idle" && !taskOrchestratingRuns.has(task.id),
      );
      if (!idleTask) {
        return;
      }

      const before = safeGetTaskDetail(idleTask.id);
      const moved = applyTaskAction({ id: idleTask.id, action: "pick_next" });
      if (shouldBroadcastTaskStatusChange(before, moved)) {
        emitTaskStatusChanged(moved);
      }
      if (moved.status !== "arch_designing") {
        return;
      }
      picked = moved;
    }

    if (!picked) {
      return;
    }

    void runTaskWithStatusBroadcast(
      () => safeGetTaskDetail(picked.id),
      () => runTaskOrchestration(picked.id),
      (result) => result,
    )
      .catch((error) => {
        console.error(
          `[task-auto-processor] orchestrate task ${String(picked.id)} failed`,
          error,
        );
      });
  } catch (error) {
    console.error("[task-auto-processor] tick failed", error);
  } finally {
    taskAutoProcessorTicking = false;
    scheduleNextTaskAutoProcessorTick();
  }
}

function startTaskAutoProcessor(): {
  running: boolean;
  startedAt: number | null;
} {
  if (taskAutoProcessorRunning) {
    return getTaskAutoProcessorStatusData();
  }

  taskAutoProcessorRunning = true;
  taskAutoProcessorStartedAt = Date.now();
  clearTaskAutoProcessorTimer();
  void runTaskAutoProcessorTick();

  return getTaskAutoProcessorStatusData();
}
function stopTaskAutoProcessor(): {
  running: boolean;
  startedAt: number | null;
} {
  taskAutoProcessorRunning = false;
  taskAutoProcessorStartedAt = null;
  clearTaskAutoProcessorTimer();

  return getTaskAutoProcessorStatusData();
}
function resolvePreloadPath(): string {
  const candidates = [
    join(__dirname, "../preload/index.mjs"),
    join(process.cwd(), "out/preload/index.mjs"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`preload script not found. tried: ${candidates.join(", ")}`);
}

function createWindow(): void {
  const preloadPath = resolvePreloadPath();
  console.info(`[bootstrap] preload path: ${preloadPath}`);

  const win = new BrowserWindow({
    width: 1320,
    height: 780,
    minWidth: 1000,
    minHeight: 600,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  if (app.isPackaged) {
    win.webContents.on("before-input-event", (event, input) => {
      const isRefreshShortcut =
        (input.type === "keyDown" &&
          input.key.toLowerCase() === "r" &&
          (input.meta || input.control)) ||
        (input.type === "keyDown" && input.key === "F5");

      if (isRefreshShortcut) {
        event.preventDefault();
      }
    });
  }

  win.webContents.once("did-finish-load", () => {
    void win.webContents
      .executeJavaScript(
        'Boolean(window.api && typeof window.api.selectDirectory === "function")',
      )
      .then((ok) => {
        console.info(`[bootstrap] preload api ready: ${String(ok)}`);
        if (!ok) {
          console.error(
            "[bootstrap] preload api is missing: window.api.selectDirectory unavailable",
          );
        }
      })
      .catch((error) => {
        console.error("[bootstrap] failed to probe preload api", error);
      });
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.DIALOG_SELECT_DIRECTORY,
    async (event): Promise<string | null> => {
      const options: OpenDialogOptions = {
        properties: ["openDirectory", "createDirectory"],
      };

      try {
        const ownerWindow = BrowserWindow.fromWebContents(event.sender);
        const result =
          ownerWindow && !ownerWindow.isDestroyed()
            ? await dialog.showOpenDialog(ownerWindow, options)
            : await dialog.showOpenDialog(options);

        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }

        return result.filePaths[0];
      } catch (error) {
        // Fallback to detached open dialog in case owner-window binding fails on specific macOS runtime states.
        const result = await dialog.showOpenDialog(options);
        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }
        if (!result.filePaths[0]) {
          throw error;
        }
        return result.filePaths[0];
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.AGENT_ASK,
    async (_event, req: AgentAskReq): Promise<AgentAskResult> => {
      if (!req?.prompt?.trim()) {
        return {
          ok: false,
          error: {
            code: "INVALID_PROMPT",
            message: "提示词不能为空",
          },
        };
      }

      try {
        const project = req.projectId ? getProject(req.projectId) : null;
        if (req.projectId && !project) {
          return {
            ok: false,
            error: {
              code: "INVALID_PROJECT",
              message: "项目不存在",
            },
          };
        }

        const text = await askAgent({
          prompt: req.prompt,
          cwd: project?.path,
        });
        return {
          ok: true,
          data: { text },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "AGENT_ERROR",
            message: error instanceof Error ? error.message : "未知错误",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_CREATE,
    async (_event, req: ProjectCreateReq): Promise<ProjectCreateResult> => {
      if (!req?.path?.trim()) {
        return {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "项目目录不能为空",
          },
        };
      }

      try {
        const project = await createProjectByPath(req.path);
        return {
          ok: true,
          data: {
            project,
          },
        };
      } catch (error) {
        if (error instanceof ProjectServiceError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "PROJECT_CREATE_ERROR",
            message: error instanceof Error ? error.message : "创建项目失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_LIST,
    async (): Promise<ProjectListResult> => {
      try {
        const projects = getProjects();
        return {
          ok: true,
          data: {
            projects,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "PROJECT_LIST_ERROR",
            message:
              error instanceof Error ? error.message : "读取项目列表失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_REVEAL_IN_FINDER,
    async (
      _event,
      req: ProjectRevealInFinderReq,
    ): Promise<ProjectRevealInFinderResult> => {
      const projectPath = req?.path?.trim();
      if (!projectPath) {
        return {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "项目目录不能为空",
          },
        };
      }

      try {
        const opened = await shell.openPath(projectPath);
        if (opened !== "") {
          return {
            ok: false,
            error: {
              code: "PROJECT_REVEAL_IN_FINDER_ERROR",
              message: opened,
            },
          };
        }

        return {
          ok: true,
          data: {
            opened: true,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "PROJECT_REVEAL_IN_FINDER_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "在 Finder 中打开项目失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENT_CREATE,
    async (
      _event,
      req: RequirementCreateReq,
    ): Promise<RequirementCreateResult> => {
      try {
        const requirement = createRequirement({
          projectId: req.projectId,
          title: req.title,
          content: req.content,
          source: req.source,
        });

        return {
          ok: true,
          data: {
            requirement,
          },
        };
      } catch (error) {
        if (error instanceof RequirementServiceError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "REQUIREMENT_CREATE_ERROR",
            message: error instanceof Error ? error.message : "创建需求失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENT_LIST_BY_PROJECT,
    async (
      _event,
      req: RequirementListByProjectReq,
    ): Promise<RequirementListByProjectResult> => {
      try {
        const requirements = getRequirementsByProject(req.projectId);
        return {
          ok: true,
          data: {
            requirements,
          },
        };
      } catch (error) {
        if (error instanceof RequirementServiceError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "REQUIREMENT_LIST_ERROR",
            message: error instanceof Error ? error.message : "读取需求失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENT_UPDATE,
    async (
      _event,
      req: RequirementUpdateReq,
    ): Promise<RequirementUpdateResult> => {
      try {
        const before = getRequirementById(req.id);
        const requirement = updateRequirementDetail(req);
        if (
          !before ||
          before.status !== requirement.status ||
          before.waitingContext !== requirement.waitingContext
        ) {
          emitRequirementStatusChanged(requirement);
        }
        return {
          ok: true,
          data: {
            requirement,
          },
        };
      } catch (error) {
        if (error instanceof RequirementServiceError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "REQUIREMENT_UPDATE_ERROR",
            message: error instanceof Error ? error.message : "更新需求失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENT_APPLY_ACTION,
    async (
      _event,
      req: RequirementApplyActionReq,
    ): Promise<RequirementApplyActionResult> => {
      try {
        const before = getRequirementById(req.id);
        const requirement = applyRequirementAction(req);
        if (
          !before ||
          before.status !== requirement.status ||
          before.waitingContext !== requirement.waitingContext
        ) {
          emitRequirementStatusChanged(requirement);
        }
        return {
          ok: true,
          data: {
            requirement,
          },
        };
      } catch (error) {
        if (error instanceof RequirementServiceError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "REQUIREMENT_APPLY_ACTION_ERROR",
            message: error instanceof Error ? error.message : "更新需求状态失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENT_PROCESS,
    async (
      _event,
      req: RequirementProcessReq,
    ): Promise<RequirementProcessResult> => {
      try {
        const outcome = await runRequirementWithStatusBroadcast(
          () => getRequirementById(req.requirementId),
          () => processRequirement(req),
          (result) => result.requirement,
        );
        return {
          ok: true,
          data: {
            requirement: outcome.requirement,
            resultType: outcome.result.resultType,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "REQUIREMENT_PROCESS_ERROR",
            message: error instanceof Error ? error.message : "处理需求失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENT_GET_CONVERSATION,
    async (
      _event,
      req: RequirementGetConversationReq,
    ): Promise<RequirementGetConversationResult> => {
      try {
        const data = await getRequirementConversation(req.requirementId, {
          sessionId: req.sessionId,
        });
        return {
          ok: true,
          data,
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "REQUIREMENT_GET_CONVERSATION_ERROR",
            message: error instanceof Error ? error.message : "读取会话失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENT_REPLY_CONVERSATION,
    async (
      _event,
      req: RequirementReplyConversationReq,
    ): Promise<RequirementReplyConversationResult> => {
      try {
        const data = await runRequirementWithStatusBroadcast(
          () => getRequirementById(req.requirementId),
          () => replyRequirementConversation(req),
          (result) => result.requirement,
        );
        return {
          ok: true,
          data,
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "REQUIREMENT_REPLY_CONVERSATION_ERROR",
            message: error instanceof Error ? error.message : "发送澄清消息失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENT_AUTO_PROCESSOR_START,
    async (
      _event,
      _req: RequirementAutoProcessorStartReq,
    ): Promise<RequirementAutoProcessorStartResult> => {
      try {
        const data = startRequirementAutoProcessor();
        return {
          ok: true,
          data,
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "REQUIREMENT_AUTO_PROCESSOR_START_ERROR",
            message: error instanceof Error ? error.message : "启动自动处理失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENT_AUTO_PROCESSOR_STOP,
    async (): Promise<RequirementAutoProcessorStopResult> => {
      try {
        const data = stopRequirementAutoProcessor();
        return {
          ok: true,
          data,
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "REQUIREMENT_AUTO_PROCESSOR_STOP_ERROR",
            message: error instanceof Error ? error.message : "关闭自动处理失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENT_AUTO_PROCESSOR_STATUS,
    async (): Promise<RequirementAutoProcessorStatusResult> => {
      return {
        ok: true,
        data: getAutoProcessorStatusData(),
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENT_STAGE_RUN_LIST,
    async (_event, req: RequirementStageRunListReq): Promise<RequirementStageRunListResult> => {
      try {
        const stageRuns = listRequirementStageRuns(req.requirementId);
        return {
          ok: true,
          data: {
            stageRuns,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "REQUIREMENT_STAGE_RUN_LIST_ERROR",
            message: error instanceof Error ? error.message : "读取需求阶段记录失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_AUTO_PROCESSOR_START,
    async (
      _event,
      _req: TaskAutoProcessorStartReq,
    ): Promise<TaskAutoProcessorStartResult> => {
      try {
        const data = startTaskAutoProcessor();
        return {
          ok: true,
          data,
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "TASK_AUTO_PROCESSOR_START_ERROR",
            message: error instanceof Error ? error.message : "启动任务自动处理失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_AUTO_PROCESSOR_STOP,
    async (): Promise<TaskAutoProcessorStopResult> => {
      try {
        const data = stopTaskAutoProcessor();
        return {
          ok: true,
          data,
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "TASK_AUTO_PROCESSOR_STOP_ERROR",
            message: error instanceof Error ? error.message : "关闭任务自动处理失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_AUTO_PROCESSOR_STATUS,
    async (): Promise<TaskAutoProcessorStatusResult> => {
      return {
        ok: true,
        data: getTaskAutoProcessorStatusData(),
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_CREATE,
    async (_event, req: TaskCreateReq): Promise<TaskCreateResult> => {
      try {
        const task = createTask(req);
        return {
          ok: true,
          data: {
            task,
          },
        };
      } catch (error) {
        if (error instanceof TaskServiceError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "TASK_CREATE_ERROR",
            message: error instanceof Error ? error.message : "创建任务失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_LIST_BY_REQUIREMENT,
    async (
      _event,
      req: TaskListByRequirementReq,
    ): Promise<TaskListByRequirementResult> => {
      try {
        const tasks = getTasksByRequirement(req.requirementId);
        return {
          ok: true,
          data: {
            tasks,
          },
        };
      } catch (error) {
        if (error instanceof TaskServiceError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "TASK_LIST_ERROR",
            message: error instanceof Error ? error.message : "读取任务失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_LIST_BY_PROJECT,
    async (
      _event,
      req: TaskListByProjectReq,
    ): Promise<TaskListByProjectResult> => {
      try {
        const tasks = getTasksByProject(req.projectId);
        return {
          ok: true,
          data: {
            tasks,
          },
        };
      } catch (error) {
        if (error instanceof TaskServiceError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "TASK_LIST_ERROR",
            message: error instanceof Error ? error.message : "读取任务失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_UPDATE,
    async (_event, req: TaskUpdateReq): Promise<TaskUpdateResult> => {
      try {
        const before = safeGetTaskDetail(req.id);
        const task = updateTaskDetail(req);
        if (shouldBroadcastTaskStatusChange(before, task)) {
          emitTaskStatusChanged(task);
        }
        return {
          ok: true,
          data: {
            task,
          },
        };
      } catch (error) {
        if (error instanceof TaskServiceError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "TASK_UPDATE_ERROR",
            message: error instanceof Error ? error.message : "更新任务失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_APPLY_ACTION,
    async (_event, req: TaskApplyActionReq): Promise<TaskApplyActionResult> => {
      try {
        const before = safeGetTaskDetail(req.id);
        const task = applyTaskAction(req);
        if (shouldBroadcastTaskStatusChange(before, task)) {
          emitTaskStatusChanged(task);
        }
        return {
          ok: true,
          data: {
            task,
          },
        };
      } catch (error) {
        if (error instanceof TaskServiceError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "TASK_APPLY_ACTION_ERROR",
            message: error instanceof Error ? error.message : "更新任务状态失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_HUMAN_COMMAND,
    async (_event, req: TaskHumanCommandReq): Promise<TaskHumanCommandResult> => {
      try {
        const before = safeGetTaskDetail(req.id);
        const task = applyTaskHumanCommand(req);
        if (shouldBroadcastTaskStatusChange(before, task)) {
          emitTaskStatusChanged(task);
        }
        return {
          ok: true,
          data: {
            task,
          },
        };
      } catch (error) {
        if (error instanceof TaskServiceError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "TASK_HUMAN_COMMAND_ERROR",
            message: error instanceof Error ? error.message : "执行人工命令失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_HUMAN_CONVERSATION_GET,
    async (
      _event,
      req: TaskHumanConversationGetReq,
    ): Promise<TaskHumanConversationGetResult> => {
      try {
        const data = await getTaskHumanConversation(req.taskId);
        const waitingContext = getTaskWaitingContext(data.task);
        if (!waitingContext) {
          return {
            ok: false,
            error: {
              code: "TASK_HUMAN_CONVERSATION_GET_ERROR",
              message: "当前任务不在等待人工状态",
            },
          };
        }

        return {
          ok: true,
          data: {
            task: data.task,
            waitingContext,
            messages: data.messages,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "TASK_HUMAN_CONVERSATION_GET_ERROR",
            message: error instanceof Error ? error.message : "读取人工会话失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_HUMAN_CONVERSATION_REPLY,
    async (
      _event,
      req: TaskHumanConversationReplyReq,
    ): Promise<TaskHumanConversationReplyResult> => {
      try {
        const data = await replyTaskHumanConversation({
          taskId: req.taskId,
          message: req.message,
        });
        const waitingContext = getTaskWaitingContext(data.task);
        if (!waitingContext) {
          return {
            ok: false,
            error: {
              code: "TASK_HUMAN_CONVERSATION_REPLY_ERROR",
              message: "当前任务不在等待人工状态",
            },
          };
        }

        return {
          ok: true,
          data: {
            task: data.task,
            waitingContext,
            messages: data.messages,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "TASK_HUMAN_CONVERSATION_REPLY_ERROR",
            message: error instanceof Error ? error.message : "人工会话回复失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_ORCHESTRATE,
    async (_event, req: TaskOrchestrateReq): Promise<TaskOrchestrateResult> => {
      try {
        const task = await runTaskWithStatusBroadcast(
          () => safeGetTaskDetail(req.taskId),
          () => runTaskOrchestration(req.taskId),
          (result) => result,
        );
        return {
          ok: true,
          data: {
            task,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "TASK_ORCHESTRATE_ERROR",
            message: error instanceof Error ? error.message : "编排任务失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_ARTIFACT_LIST,
    async (_event, req: TaskArtifactListReq): Promise<TaskArtifactListResult> => {
      try {
        const files = await listTaskArtifacts(req.taskId);
        return {
          ok: true,
          data: {
            files,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "TASK_ARTIFACT_LIST_ERROR",
            message: error instanceof Error ? error.message : "读取任务产物列表失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_ARTIFACT_READ,
    async (_event, req: TaskArtifactReadReq): Promise<TaskArtifactReadResult> => {
      try {
        const content = await readTaskArtifact(req.taskId, req.fileName);
        return {
          ok: true,
          data: {
            content,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "TASK_ARTIFACT_READ_ERROR",
            message: error instanceof Error ? error.message : "读取任务产物内容失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_STAGE_RUN_LIST,
    async (_event, req: TaskStageRunListReq): Promise<TaskStageRunListResult> => {
      try {
        const stageRuns = getTaskStageRuns(req.taskId);
        return {
          ok: true,
          data: {
            stageRuns,
          },
        };
      } catch (error) {
        if (error instanceof TaskServiceError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "TASK_STAGE_RUN_LIST_ERROR",
            message: error instanceof Error ? error.message : "读取任务阶段记录失败",
          },
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_STAGE_RUN_TRACE_GET,
    async (
      _event,
      req: TaskStageRunTraceGetReq,
    ): Promise<TaskStageRunTraceGetResult> => {
      try {
        const trace = await getTaskStageRunTrace(req.stageRunId);
        const stageRuns = getTaskStageRuns(trace.stageRun.taskId);
        const stageRun = stageRuns.find((item) => item.id === trace.stageRun.id);
        if (!stageRun) {
          return {
            ok: false,
            error: {
              code: "TASK_STAGE_RUN_TRACE_GET_ERROR",
              message: "任务阶段记录不存在",
            },
          };
        }

        return {
          ok: true,
          data: {
            stageRun,
            messages: trace.messages,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "TASK_STAGE_RUN_TRACE_GET_ERROR",
            message: error instanceof Error ? error.message : "读取阶段执行详情失败",
          },
        };
      }
    },
  );
}

app.whenReady().then(() => {
  getDb();
  onTaskStageTraceChanged((payload) => {
    emitTaskStageTraceChanged(payload);
  });
  failAllRunningRequirementStageRuns(
    "应用重启，上一轮运行未正常结束，自动回填为失败",
  );
  failAllRunningTaskStageRuns("应用重启，上一轮运行未正常结束，自动回填为失败");

  try {
    const db = getDb();
    const runningTaskRows = db
      .prepare(
        `SELECT id
         FROM tasks
         WHERE status IN ('arch_designing', 'tech_reviewing', 'coding', 'qa_reviewing', 'deploying')`,
      )
      .all() as Array<{ id: number }>;

    for (const row of runningTaskRows) {
      ensureTaskCurrentStageRun(row.id);
    }
  } catch (error) {
    console.error("[task-stage-runs] startup repair failed", error);
  }

  registerIpcHandlers();
  startRequirementAutoProcessor();
  startTaskAutoProcessor();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
