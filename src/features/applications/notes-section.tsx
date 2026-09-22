"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PencilIcon } from "lucide-react";
import { toast } from "sonner";
import type { ApplicationNote } from "@jword/core/browser";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { addNoteAction, updateNoteAction } from "@/server/actions/applications";
import type { ActionResult } from "@/server/actions/result";

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
  const [body, setBody] = useState(note.body);
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
            note: body,
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
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        autoFocus
      />
      <div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || body.trim() === ""}>
          {pending ? "Saving…" : "Save note"}
        </Button>
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** One Notes section: individual editable notes, each stamped with when it was added and edited. */
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
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const { pending, error, run } = useNoteMutation(() => setBody(""));

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
              note: body,
            }),
          );
        }}
      >
        <Label htmlFor="new-note">Add a note</Label>
        <Textarea
          id="new-note"
          rows={3}
          placeholder="What happened, what to remember…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending || body.trim() === ""}>
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
                      <time dateTime={note.createdAt}>{formatDateTime(note.createdAt)}</time>
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
