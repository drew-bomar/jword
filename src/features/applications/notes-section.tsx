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
import { useReliableMutation } from "@/lib/mutations/use-reliable-mutation";
import type { ActionResult } from "@/server/actions/result";

function useNoteMutation(onDone: () => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { save, unconfirmed } = useReliableMutation();
  const [stale, setStale] = useState(false);
  function run(
    command: Record<string, unknown>,
    perform: (
      input: unknown,
    ) => Promise<ActionResult<{ summary: string; noop: boolean; replayed?: boolean }>>,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await save(command, perform);
      if (result.ok) {
        toast.success(
          result.data.replayed
            ? "Earlier save confirmed."
            : result.data.noop
              ? "Nothing to change."
              : result.data.summary,
        );
        onDone();
        router.refresh();
        return;
      }
      if (result.error.code === "CONFLICT" && result.error.reason === "STALE_VERSION") {
        setStale(true);
        setError(
          "This application changed since you opened it. Your draft is kept. Refresh and review before saving again.",
        );
        return;
      }
      setError(result.error.message);
    });
  }
  return {
    pending,
    error,
    run,
    unconfirmed,
    stale,
    reviewed: () => {
      setStale(false);
      setError(null);
    },
    refresh: () => {
      router.refresh();
      setStale(false);
    },
  };
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
  const [expectedVersion, setExpectedVersion] = useState(version);
  const newer = version !== expectedVersion;
  const { pending, error, run, unconfirmed, stale, refresh, reviewed } = useNoteMutation(onClose);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || ((stale || newer) && !unconfirmed)) return;
        run(
          {
            applicationId,
            noteId: note.noteId,
            expectedVersion,
            note: body,
          },
          updateNoteAction,
        );
      }}
    >
      {note.body !== body ? (
        <details>
          <summary>Latest saved note</summary>
          <p className="text-sm whitespace-pre-wrap">{note.body}</p>
        </details>
      ) : null}
      <Label htmlFor={`note-${note.noteId}`} className="sr-only">
        Edit note
      </Label>
      <Textarea
        id={`note-${note.noteId}`}
        rows={3}
        disabled={pending || unconfirmed}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        autoFocus
      />
      <div className="flex justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={pending || unconfirmed}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={pending || ((stale || newer) && !unconfirmed) || body.trim() === ""}
        >
          {pending ? "Saving…" : unconfirmed ? "Retry original save" : "Save note"}
        </Button>
      </div>
      {newer ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setExpectedVersion(version);
            reviewed();
          }}
        >
          Reapply my note
        </Button>
      ) : null}
      {stale ? (
        <Button type="button" variant="outline" onClick={refresh}>
          Refresh latest values
        </Button>
      ) : null}
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
  const { pending, error, run, unconfirmed, stale, refresh } = useNoteMutation(() => setBody(""));

  return (
    <section aria-labelledby="notes-heading" className="space-y-4">
      <h2 id="notes-heading" className="text-sm font-semibold">
        Notes
      </h2>
      <form
        className="space-y-2 rounded-lg border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            {
              applicationId,
              expectedVersion: version,
              note: body,
            },
            addNoteAction,
          );
        }}
      >
        <Label htmlFor="new-note">Add a note</Label>
        <Textarea
          id="new-note"
          rows={3}
          placeholder="What happened, what to remember…"
          disabled={pending || unconfirmed}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending || stale || body.trim() === ""}>
            {pending ? "Adding…" : unconfirmed ? "Retry original save" : "Add note"}
          </Button>
        </div>
        {stale ? (
          <Button type="button" variant="outline" onClick={refresh}>
            Refresh latest values
          </Button>
        ) : null}
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
        <p className="text-muted-foreground text-xs">More notes are available below.</p>
      ) : null}
    </section>
  );
}
