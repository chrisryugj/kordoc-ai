/** 순서 바꾸는 파일 목록 — 끌어서 옮기거나 위·아래 단추로 (합본 PDF·붙임 순서) */

import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import { FormatBadge } from "./FormatBadge";
import { baseName, formatOf } from "../../lib/format";

function Row({ path, index, total, onMove, onRemove, note }: {
  path: string; index: number; total: number; onMove: (to: number) => void; onRemove: () => void; note?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: path });
  return (
    <li ref={setNodeRef} className="kd-order-row" data-dragging={isDragging}
      style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes}>
      <button type="button" className="kd-icon-btn kd-grip" {...listeners} aria-label="끌어서 순서 바꾸기" tabIndex={-1}>
        <GripVertical size={15} />
      </button>
      <span className="kd-order-n kd-num">{index + 1}</span>
      <FormatBadge format={formatOf(path)} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold" style={{ overflowWrap: "anywhere" }}>{baseName(path)}</span>
        {note && <span className="kd-row-desc block">{note}</span>}
      </span>
      <button type="button" className="kd-icon-btn" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`${baseName(path)} 위로`}><ChevronUp size={15} /></button>
      <button type="button" className="kd-icon-btn" disabled={index === total - 1} onClick={() => onMove(index + 1)} aria-label={`${baseName(path)} 아래로`}><ChevronDown size={15} /></button>
      <button type="button" className="kd-icon-btn" onClick={onRemove} aria-label={`${baseName(path)} 빼기`}><X size={14} /></button>
    </li>
  );
}

export function OrderList({ items, onChange, notes }: { items: string[]; onChange: (next: string[]) => void; notes?: Record<string, string> }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onChange(arrayMove(items, items.indexOf(String(e.active.id)), items.indexOf(String(e.over.id))));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ol className="kd-order">
          {items.map((p, i) => (
            <Row key={p} path={p} index={i} total={items.length} note={notes?.[p]}
              onMove={(to) => onChange(arrayMove(items, i, to))}
              onRemove={() => onChange(items.filter((x) => x !== p))} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
