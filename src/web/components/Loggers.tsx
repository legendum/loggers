import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AddButton,
  Dialog,
  type UseResourceResult,
  useDelete,
  useDndPositions,
  useEscape,
  useFilter,
  useRename,
} from "pues/base/objects";
import { ThemeChooser } from "pues/base/theme";
import { useCallback, useState } from "react";
import type { LevelCounts, LoggerEntry } from "../types.js";
import { EMPTY_LEVEL_COUNTS } from "../types.js";
import LevelCountsPill from "./LevelCountsPill";

type Props = {
  resource: UseResourceResult<LoggerEntry>;
  countsByLogger: Record<string, LevelCounts>;
  onSelect: (entry: LoggerEntry) => void;
  filterQuery: string;
};

const loggerMatchesFilter = (row: LoggerEntry, q: string): boolean => {
  const needle = q.toLowerCase();
  return (
    row.label.toLowerCase().includes(needle) ||
    row.slug.toLowerCase().includes(needle) ||
    String(row.id).toLowerCase().includes(needle)
  );
};

export default function Loggers({
  resource,
  countsByLogger,
  onSelect,
  filterQuery,
}: Props) {
  const loggers = resource.rows;
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [renameLogger, setRenameLogger] = useState<LoggerEntry | null>(null);
  const [renameText, setRenameText] = useState("");
  const [deleteLogger, setDeleteLogger] = useState<LoggerEntry | null>(null);

  const { active: filterActive, visibleRows: filteredLoggers } = useFilter(
    loggers,
    filterQuery,
    loggerMatchesFilter,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
  );

  const dnd = useDndPositions<LoggerEntry>({
    name: "loggers",
    resource,
  });
  const { rename } = useRename<LoggerEntry>({
    resource,
    resourceName: "loggers",
  });
  const { del } = useDelete<LoggerEntry>({
    resource,
    resourceName: "loggers",
  });

  useEscape(!!deleteLogger, () => setDeleteLogger(null));

  const confirmDelete = async () => {
    if (!deleteLogger) return;
    await del(deleteLogger.id);
    setDeleteLogger(null);
  };

  const openRename = (entry: LoggerEntry) => {
    setRenameLogger(entry);
    setRenameText(entry.label);
  };

  const saveRename = async () => {
    if (!renameLogger) return;
    const trimmed = renameText.trim();
    if (!trimmed || trimmed === renameLogger.label) {
      setRenameLogger(null);
      return;
    }
    await rename(renameLogger.id, trimmed);
    setRenameLogger(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      dnd.onDragEnd(event);
    },
    [dnd],
  );

  const draggedEntry = activeDragId
    ? loggers.find((l) => l.id === activeDragId)
    : null;

  return (
    <div className="screen screen--home">
      {filterActive ? (
        <ul className="list">
          {filteredLoggers.map((entry) => (
            <StaticLoggerRow
              key={entry.id}
              entry={entry}
              counts={countsByLogger[entry.id] ?? EMPTY_LEVEL_COUNTS}
              onSelect={() => onSelect(entry)}
              onEdit={() => openRename(entry)}
              onDelete={() => setDeleteLogger(entry)}
            />
          ))}
        </ul>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={dnd.itemIds.map(String)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="list">
              {loggers.map((entry) => (
                <SortableLoggerRow
                  key={entry.id}
                  entry={entry}
                  counts={countsByLogger[entry.id] ?? EMPTY_LEVEL_COUNTS}
                  onSelect={() => onSelect(entry)}
                  onEdit={() => openRename(entry)}
                  onDelete={() => setDeleteLogger(entry)}
                />
              ))}
            </ul>
          </SortableContext>
          <DragOverlay>
            {draggedEntry ? (
              <div className="drag-overlay">
                <div className="list-item list-item--no-border">
                  <span className="drag-handle drag-handle--static" aria-hidden>
                    ⠿
                  </span>
                  <div className="list-item-content list-item-content--indent">
                    <div className="list-item-title">{draggedEntry.label}</div>
                  </div>
                  <LevelCountsPill
                    counts={
                      countsByLogger[draggedEntry.id] ?? EMPTY_LEVEL_COUNTS
                    }
                  />
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {!resource.loading && loggers.length === 0 && !filterActive && (
        <p className="empty-state-hint">No loggers yet. Tap + to create one.</p>
      )}

      {filterActive && filteredLoggers.length === 0 && (
        <p className="empty-state-hint">No matches.</p>
      )}

      <AddButton resource="loggers" placeholder="Logger name" />

      <div className="links-list-theme links-list-theme--home">
        <p className="links-list-theme-label">Theme</p>
        <ThemeChooser endpoint="/pues/me" />
      </div>

      {renameLogger && (
        <Dialog title="Rename logger" onClose={() => setRenameLogger(null)}>
          <label className="dialog-field">
            <span>Name</span>
            <input
              type="text"
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              maxLength={100}
              autoFocus
            />
          </label>
          <div className="form-button-row form-button-row--end">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setRenameLogger(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={!renameText.trim()}
              onClick={() => void saveRename()}
            >
              Save
            </button>
          </div>
        </Dialog>
      )}

      {deleteLogger && (
        <Dialog title="Delete logger?" onClose={() => setDeleteLogger(null)}>
          <p className="dialog-lede">
            Permanently delete <strong>{deleteLogger.label}</strong> and all
            stored log lines?
          </p>
          <div className="form-button-row form-button-row--end">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDeleteLogger(null)}
            >
              No
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void confirmDelete()}
            >
              Yes
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function LoggerRowInner({
  entry,
  counts,
  onSelect,
  onEdit,
  onDelete,
  listeners,
  dragDisabled,
}: {
  entry: LoggerEntry;
  counts: LevelCounts;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  listeners?: ReturnType<typeof useSortable>["listeners"];
  dragDisabled: boolean;
}) {
  return (
    <div className="row-slider">
      <div className="row-main" onClick={onSelect}>
        <div className="list-item list-item--no-border">
          {dragDisabled ? (
            <span className="drag-handle drag-handle--static" aria-hidden>
              ⠿
            </span>
          ) : (
            <button
              type="button"
              className="drag-handle"
              aria-label="Drag to reorder"
              {...listeners}
              onClick={(e) => e.stopPropagation()}
            >
              ⠿
            </button>
          )}
          <div className="list-item-content list-item-content--indent">
            <div className="list-item-title">{entry.label}</div>
          </div>
          <LevelCountsPill counts={counts} />
        </div>
      </div>
      <button
        type="button"
        className="row-edit"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        Edit
      </button>
      <button
        type="button"
        className="row-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        Delete
      </button>
    </div>
  );
}

function SortableLoggerRow(props: {
  entry: LoggerEntry;
  counts: LevelCounts;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.entry.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li className="row-wrap" ref={setNodeRef} style={style} {...attributes}>
      <LoggerRowInner {...props} listeners={listeners} dragDisabled={false} />
    </li>
  );
}

function StaticLoggerRow(props: {
  entry: LoggerEntry;
  counts: LevelCounts;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="row-wrap">
      <LoggerRowInner {...props} dragDisabled />
    </li>
  );
}
