"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarPlusIcon, PencilIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { ApplicationNote } from "@jword/core/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime } from "@/lib/format";
import { addNoteAction, updateNoteAction } from "@/server/actions/applications";
import type { ActionResult } from "@/server/actions/result";

interface NoteDraft {
  body: string;
  /** null = undated; string = YYYY-MM-DD */
  noteDate: string | null;
}

function todayLocal(): string {
  // The date picker default is a convenience; the server owns "today" for defaults.
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function useNoteMutation(onDone: () => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(perform: () => Promise<ActionResult<{ summary: string; noop: boolean }>>) {
    setError(null);
    startTransition(async () => {
      const result = await perform();
      if (result.ok) {
        toast.success(result.data.noop ? "Nothing to change." : result.data.summary);
        onDone();
        router.refresh();
        return;
      }
      if (result.error.code === "CONFLICT" && result.error.reason === "STALE_VERSION") {
        setError(
          "This application changed since you opened it. Refresh the page, then save again. Your text is kept here.",
        );
        return;
      }
      setError(result.error.message);
    });
  }
  return { pending, error, run };
}

function DateLabelControl({
  draft,
  onChange,
  idPrefix,
}: {
  draft: NoteDraft;
  onChange: (next: NoteDraft) => void;
  idPrefix: string;
}) {
  if (draft.noteDate === null) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange({ ...draft, noteDate: todayLocal() })}
      >
        <CalendarPlusIcon data-icon="inline-start" aria-hidden />
        Add date
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={`${idPrefix}-date`} className="text-muted-foreground text-xs">
        Date label
      </Label>
      <Input
        id={`${idPrefix}-date`}
        type="date"
        className="h-7 w-[150px] text-xs"
        value={draft.noteDate}
        onChange={(e) => onChange({ ...draft, noteDate: e.target.value })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Remove date label"
        onClick={() => onChange({ ...draft, noteDate: null })}
      >
        <XIcon aria-hidden />
      </Button>
    </div>
  );
}

function NoteEditor({
  note,
  applicationId,
  version,
  onClose,
}: {
  note: ApplicationNote;
  applicationId: string;
  version: number;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<NoteDraft>({ body: note.body, noteDate: note.noteDate });
  const { pending, error, run } = useNoteMutation(onClose);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          updateNoteAction({
            requestId: crypto.randomUUID(),
            applicationId,
            noteId: note.noteId,
            expectedVersion: version,
            note: draft.body,
            noteDate: draft.noteDate === "" ? null : draft.noteDate,
          }),
        );
      }}
    >
      <Label htmlFor={`note-${note.noteId}`} className="sr-only">
        Edit note
      </Label>
      <Textarea
        id={`note-${note.noteId}`}
        rows={3}
        value={draft.body}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        required
        autoFocus
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateLabelControl draft={draft} onChange={setDraft} idPrefix={`note-${note.noteId}`} />
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending || draft.body.trim() === ""}>
            {pending ? "Saving…" : "Save note"}
          </Button>
        </div>
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** One Notes section (decision 012): individual editable notes with optional date labels. */
export function NotesSection({
  applicationId,
  version,
  notes,
  hasMore,
}: {
  applicationId: string;
  version: number;
  notes: ApplicationNote[];
  hasMore: boolean;
}) {
  const [draft, setDraft] = useState<NoteDraft>({ body: "", noteDate: null });
  const [editing, setEditing] = useState<string | null>(null);
  const { pending, error, run } = useNoteMutation(() => setDraft({ body: "", noteDate: null }));

  return (
    <section aria-labelledby="notes-heading" className="space-y-4">
      <h2 id="notes-heading" className="text-sm font-semibold">
        Notes
      </h2>
      <form
        className="space-y-2 rounded-lg border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            addNoteAction({
              requestId: crypto.randomUUID(),
              applicationId,
              expectedVersion: version,
              note: draft.body,
              noteDate: draft.noteDate === "" ? null : draft.noteDate,
            }),
          );
        }}
      >
        <Label htmlFor="new-note">Add a note</Label>
        <Textarea
          id="new-note"
          rows={3}
          placeholder="What happened, what to remember…"
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DateLabelControl draft={draft} onChange={setDraft} idPrefix="new-note" />
          <Button type="submit" size="sm" disabled={pending || draft.body.trim() === ""}>
            {pending ? "Adding…" : "Add note"}
          </Button>
        </div>
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {notes.length === 0 ? (
        <p className="text-muted-foreground text-sm">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.noteId} className="rounded-lg border p-3" data-testid="note">
              {editing === note.noteId ? (
                <NoteEditor
                  note={note}
                  applicationId={applicationId}
                  version={version}
                  onClose={() => setEditing(null)}
                />
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-muted-foreground text-xs">
                      {note.noteDate ? (
                        <span className="text-foreground font-medium">
                          {formatDate(note.noteDate)}
                        </span>
                      ) : (
                        <span>Undated</span>
                      )}
                      <span className="mx-1.5">·</span>
                      <time dateTime={note.createdAt}>added {formatDateTime(note.createdAt)}</time>
                      {note.updatedAt !== note.createdAt ? (
                        <span> · edited {formatDateTime(note.updatedAt)}</span>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Edit note"
                      onClick={() => setEditing(note.noteId)}
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {hasMore ? (
        <p className="text-muted-foreground text-xs">Showing the most recent notes.</p>
      ) : null}
    </section>
  );
}
