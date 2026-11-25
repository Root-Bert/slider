/**
 * To-dos – a workspace's tasks, as Linear's issues at their simplest: a title, words to it, a
 * status, a priority, who does it, from when and by when, the milestone it leads to. One's own
 * (only one sees them) or an area's (whoever sees the area) – an area's list is its project plan
 * („Allgemein“) beside the projects made in it, each with its milestones and dates on a timeline
 * („Zeitplan“). Read and changed by agents as the person
 * they work for may.
 */
import { z } from 'zod';
import { MAX_ATTACHMENTS, type Attachment } from './attachments';
import type { Author } from './model';

export const TODO_STATUSES = ['backlog', 'todo', 'in_progress', 'done', 'canceled'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

/** Open: still to be done (not done, not dropped). */
export const isOpenTodo = (status: TodoStatus) => status !== 'done' && status !== 'canceled';

export const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  backlog: 'Backlog',
  todo: 'Zu tun',
  in_progress: 'In Arbeit',
  done: 'Erledigt',
  canceled: 'Verworfen',
};

/** Linear's numbers: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export const TODO_PRIORITIES = [0, 1, 2, 3, 4] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

export const TODO_PRIORITY_LABELS: Record<TodoPriority, string> = {
  0: 'Keine Priorität',
  1: 'Dringend',
  2: 'Hoch',
  3: 'Mittel',
  4: 'Niedrig',
};

/** Where a to-do came from: a mail conversation (its „Zu tun“) – opened from it. */
export type TodoSource = { kind: 'mail'; threadId: string; url?: string; label?: string };

export const MAX_TODO_TITLE = 300;
export const MAX_TODO_DESCRIPTION = 20_000;
export const MAX_MILESTONE_NAME = 120;
export const MAX_PROJECT_NAME = 120;
/** As many as one to-do waits on – a plan's worth. */
export const MAX_BLOCKED_BY = 50;

/**
 * An area's to-dos stand in projects: the area's own one – „Allgemein“, every to-do without a
 * project (`projectId` null) – and those made beside it, each with its own to-dos, milestones and
 * timeline. One's own to-dos have none.
 */
export const DEFAULT_PROJECT_NAME = 'Allgemein';

/** A project of an area: a plan of its own beside the area's „Allgemein“. */
export interface TodoProject {
  id: string;
  workspaceId: string;
  /** `null`: one's own (beside one's own „Allgemein“). */
  areaId: string | null;
  name: string;
  canEdit: boolean;
  createdAt: string;
}

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(MAX_PROJECT_NAME),
  /** `null` or none: one's own. */
  areaId: z.string().min(1).max(100).nullish(),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const projectChangeSchema = z.object({
  name: z.string().trim().min(1).max(MAX_PROJECT_NAME),
});
export type ProjectChange = z.infer<typeof projectChangeSchema>;

/**
 * A milestone – a point a place's to-dos lead to, by a date: one's own or an area's, as the
 * to-dos in it (a to-do takes only a milestone of its own place).
 */
export interface TodoMilestone {
  id: string;
  workspaceId: string;
  areaId: string | null;
  /** Of one of the area's projects; `null`: its „Allgemein“ (or one's own). */
  projectId: string | null;
  name: string;
  /** `YYYY-MM-DD`: when it is to be reached. */
  dueOn: string | null;
  canEdit: boolean;
  createdAt: string;
}

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const milestoneInputSchema = z.object({
  name: z.string().trim().min(1).max(MAX_MILESTONE_NAME),
  areaId: z.string().min(1).max(100).nullable().optional(),
  /** One of the area's projects; none: its „Allgemein“. */
  projectId: z.string().min(1).max(100).nullable().optional(),
  dueOn: day.optional(),
});
export type MilestoneInput = z.infer<typeof milestoneInputSchema>;

export const milestoneChangeSchema = z
  .object({ name: z.string().trim().min(1).max(MAX_MILESTONE_NAME), dueOn: day })
  .partial();
export type MilestoneChange = z.infer<typeof milestoneChangeSchema>;

export interface Todo {
  id: string;
  workspaceId: string;
  /** In an area – its people's; `null`: one's own. */
  areaId: string | null;
  /** The area's project it stands in; `null`: the area's „Allgemein“ (or one's own). */
  project: { id: string; name: string } | null;
  /** Counted per workspace: „#12“. */
  number: number;
  title: string;
  description: string;
  /** Files put on it, in their order. */
  attachments?: Attachment[];
  status: TodoStatus;
  priority: TodoPriority;
  assignee: Author | null;
  /** An agent given it: once sent, it works on it as the one who sent it may (running: the agents' list). */
  assigneeAgent: { id: string; title: string } | null;
  /** `YYYY-MM-DD`: when work on it begins – its bar's start on the timeline. */
  startOn: string | null;
  /** `YYYY-MM-DD`. */
  dueOn: string | null;
  /** The milestone it leads to – one of its place's. */
  milestone: { id: string; name: string; dueOn: string | null } | null;
  /** Its place among its milestone's on the timeline, lowest first – moved there by hand. */
  position: number;
  /**
   * The to-dos it waits on („Wartet auf“) – of its own place, ids: it is to start once they are
   * done. The timeline marks it red where it starts before one of them is due.
   */
  blockedBy: string[];
  source: TodoSource | null;
  createdBy: Author | null;
  /** Written by an agent: its name. */
  agent: { id: string; title: string } | null;
  /** Whether the caller may change it (an area they only view: not). */
  canEdit: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const todoFields = {
  title: z.string().trim().min(1).max(MAX_TODO_TITLE),
  description: z.string().max(MAX_TODO_DESCRIPTION),
  areaId: z.string().min(1).max(100).nullable(),
  /** One of its area's projects; `null`: the area's „Allgemein“. Moved to another area, it leaves it. */
  projectId: z.string().min(1).max(100).nullable(),
  status: z.enum(TODO_STATUSES),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  assigneeId: z.string().min(1).max(100).nullable(),
  /** Gives it to that agent – it starts only once sent („Losschicken“, `POST /todos/:id/send`). */
  assigneeAgentId: z.string().min(1).max(100).nullable(),
  startOn: day,
  dueOn: day,
  /** One of its place's milestones; moved to another place, it leaves it. */
  milestoneId: z.string().min(1).max(100).nullable(),
};

export const todoInputSchema = z.object({
  ...todoFields,
  description: todoFields.description.optional(),
  areaId: todoFields.areaId.optional(),
  projectId: todoFields.projectId.optional(),
  status: todoFields.status.optional(),
  priority: todoFields.priority.optional(),
  assigneeId: todoFields.assigneeId.optional(),
  assigneeAgentId: todoFields.assigneeAgentId.optional(),
  startOn: todoFields.startOn.optional(),
  dueOn: todoFields.dueOn.optional(),
  milestoneId: todoFields.milestoneId.optional(),
  source: z
    .object({
      kind: z.literal('mail'),
      threadId: z.string().min(1).max(100),
      // https only: shown to the area as „Öffnen“, followed by agents – never javascript:, data:.
      url: z
        .string()
        .url()
        .max(2000)
        .refine((each) => each.startsWith('https://'), { message: 'Nur https-Links.' })
        .optional(),
      label: z.string().max(200).optional(),
    })
    .nullable()
    .optional(),
});
export type TodoInput = z.infer<typeof todoInputSchema>;

/**
 * A change: any of the fields; `areaId` moves it (to one's own: `null`) – and drops what it waits
 * on and what waits on it (a place's to-dos wait on each other alone).
 */
export const todoChangeSchema = z
  .object({
    ...todoFields,
    /**
     * Its place among its milestone's (between its neighbours'); none while put into another
     * milestone or place: last.
     */
    position: z.number().finite(),
    /** What it waits on as it should stand (to-dos of its place): itself or a loop is refused. */
    blockedBy: z.array(z.string().min(1).max(100)).max(MAX_BLOCKED_BY),
    /** Its files as they should stand (ids): new ones are taken (`attachments`), left out go. */
    attachments: z.array(z.string().min(1).max(100)).max(MAX_ATTACHMENTS),
  })
  .partial();
export type TodoChange = z.infer<typeof todoChangeSchema>;
