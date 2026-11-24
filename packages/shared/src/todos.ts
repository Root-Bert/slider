/**
 * To-dos – a workspace's tasks, as Linear's issues at their simplest: a title, words to it, a
 * status, a priority, who does it, from when and by when, the milestone it leads to. One's own
 * (only one sees them) or an area's (whoever sees the area) – an area's list is its project plan,
 * its milestones and dates its timeline („Zeitplan“). Read and changed by agents as the person
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

/**
 * A milestone – a point a place's to-dos lead to, by a date: one's own or an area's, as the
 * to-dos in it (a to-do takes only a milestone of its own place).
 */
export interface TodoMilestone {
  id: string;
  workspaceId: string;
  areaId: string | null;
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

/** A change: any of the fields; `areaId` moves it (to one's own: `null`). */
export const todoChangeSchema = z
  .object({
    ...todoFields,
    /** Its files as they should stand (ids): new ones are taken (`attachments`), left out go. */
    attachments: z.array(z.string().min(1).max(100)).max(MAX_ATTACHMENTS),
  })
  .partial();
export type TodoChange = z.infer<typeof todoChangeSchema>;
