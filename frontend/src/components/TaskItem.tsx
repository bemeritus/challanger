import type { Task } from "../types";
import { PRIORITY_COLORS } from "../types";
import { recurrenceLabel } from "../i18n";
import { formatDue } from "../util";
import { Icon } from "./Icon";

interface Props {
  task: Task;
  selected: boolean;
  onSelect: () => void;
  onComplete: () => void;
  onTagClick?: (tag: string) => void;
  subtaskCount?: { done: number; total: number };
  /// Drag-and-drop (faqat "Qo'lda" tartiblash rejimida yoqiladi)
  draggable?: boolean;
  dragging?: boolean;
  dragOver?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}

export function TaskItem({
  task,
  selected,
  onSelect,
  onComplete,
  onTagClick,
  subtaskCount,
  draggable,
  dragging,
  dragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: Props) {
  const due = formatDue(task.due_date);
  return (
    <div
      className={`task-item ${selected ? "selected" : ""} ${task.completed ? "done" : ""} ${
        dragging ? "dragging" : ""
      } ${dragOver ? "drag-over" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (onDragOver) {
          e.preventDefault();
          onDragOver(e);
        }
      }}
      onDrop={(e) => {
        if (onDrop) {
          e.preventDefault();
          onDrop();
        }
      }}
      onDragEnd={onDragEnd}
    >
      {draggable && <span className="drag-handle" aria-hidden>⠿</span>}
      <button
        className="checkbox"
        style={{ borderColor: PRIORITY_COLORS[task.priority] }}
        onClick={(e) => {
          e.stopPropagation();
          onComplete();
        }}
        aria-label="Bajarildi"
      >
        {task.completed ? "✓" : ""}
      </button>

      <div className="task-body" onClick={onSelect}>
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {due.text && <span className={`due tone-${due.tone}`}>{due.text}</span>}
          {task.recurrence && (
            <span className="recur"><Icon name="repeat" size={13} /> {recurrenceLabel(task.recurrence)}</span>
          )}
          {task.reminder_at && <span className="reminder"><Icon name="clock" size={13} /></span>}
          {task.notes && <span className="has-notes"><Icon name="file-text" size={13} /></span>}
          {subtaskCount && subtaskCount.total > 0 && (
            <span
              className={`subtask-badge ${subtaskCount.done === subtaskCount.total ? "complete" : ""}`}
            >
              <Icon name="list-checks" size={13} /> {subtaskCount.done}/{subtaskCount.total}
            </span>
          )}
          {(task.tags ?? []).map((t) => (
            <span
              key={t}
              className="task-tag"
              onClick={(e) => {
                e.stopPropagation();
                onTagClick?.(t);
              }}
            >
              #{t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
