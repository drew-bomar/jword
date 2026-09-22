"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, CircleAlertIcon, FileUpIcon } from "lucide-react";
import {
  IMPORT_FIELDS,
  IMPORT_FIELD_LABELS,
  IMPORT_MAX_BYTES,
  JwordError,
  REQUIRED_IMPORT_FIELDS,
  STATUS_LABELS,
  isFlagged,
  missingRequiredMappings,
  parseCsv,
  suggestMapping,
  type ApplicationStatus,
  type ImportField,
  type ImportMapping,
  type ImportRowPreview,
  type MutationResult,
} from "@jword/core/browser";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { commitImportAction, previewImportAction } from "@/server/actions/import";
import type { ActionError } from "@/server/actions/result";
import { cn } from "@/lib/utils";

type Step = "upload" | "map" | "preview" | "done";

interface PreviewState {
  rows: ImportRowPreview[];
  totalRows: number;
  blankRowsSkipped: number;
}

interface RowChoice {
  include: boolean;
  importSeparate: boolean;
}

const SKIP = "__skip__";

function StepHeader({ step }: { step: Step }) {
  const steps: Array<[Step, string]> = [
    ["upload", "1. Select CSV"],
    ["map", "2. Map columns"],
    ["preview", "3. Review & confirm"],
    ["done", "4. Result"],
  ];
  return (
    <ol className="flex flex-wrap gap-2 text-xs" aria-label="Import steps">
      {steps.map(([key, label]) => (
        <li
          key={key}
          aria-current={step === key ? "step" : undefined}
          className={cn(
            "rounded-md border px-2 py-1",
            step === key ? "border-foreground/40 bg-muted font-medium" : "text-muted-foreground",
          )}
        >
          {label}
        </li>
      ))}
    </ol>
  );
}

export function ImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [sample, setSample] = useState<string[][]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [choices, setChoices] = useState<Record<number, RowChoice>>({});
  const [error, setError] = useState<ActionError | null>(null);
  const [result, setResult] = useState<MutationResult | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      setError({
        code: "VALIDATION_ERROR",
        message: `That file is ${Math.round(file.size / 1000)} KB. The limit is ${Math.round(IMPORT_MAX_BYTES / 1000)} KB.`,
      });
      return;
    }
    const text = await file.text();
    try {
      const parsed = parseCsv(text);
      setCsvText(text);
      setFileName(file.name);
      setHeaders(parsed.headers);
      setSample(parsed.rows.slice(0, 5));
      setRowCount(parsed.rows.length);
      setMapping(suggestMapping(parsed.headers));
      setStep("map");
    } catch (err) {
      setError({
        code: "VALIDATION_ERROR",
        message: err instanceof JwordError ? err.message : "Could not read that CSV file.",
      });
    }
  }

  function runPreview() {
    if (!mapping) return;
    setError(null);
    startTransition(async () => {
      const res = await previewImportAction({ csvText, mapping });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const initial: Record<number, RowChoice> = {};
      for (const row of res.data.rows) {
        const flagged = isFlagged(row);
        initial[row.rowIndex] = {
          include: row.errors.length === 0 && !flagged,
          importSeparate: false,
        };
      }
      setChoices(initial);
      setPreview({
        rows: res.data.rows,
        totalRows: res.data.totalRows,
        blankRowsSkipped: res.data.blankRowsSkipped,
      });
      setStep("preview");
    });
  }

  const selectedRows = useMemo(() => {
    if (!preview) return [];
    return preview.rows.filter((row) => row.values && choices[row.rowIndex]?.include);
  }, [preview, choices]);

  const blockedSelections = useMemo(
    () => selectedRows.filter((row) => isFlagged(row) && !choices[row.rowIndex]?.importSeparate),
    [selectedRows, choices],
  );

  function runCommit() {
    if (!preview) return;
    setError(null);
    // One request id per confirmation; reused if we retry after an unconfirmed outcome.
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    startTransition(async () => {
      let res;
      try {
        res = await commitImportAction({
          requestId: id,
          rows: selectedRows.map((row) => ({
            ...row.values!,
            duplicateChoice: isFlagged(row) ? ("import_separate" as const) : undefined,
          })),
        });
      } catch {
        // Lost response: the batch may or may not have committed. Keep the request id for a safe retry.
        setUnconfirmed(true);
        return;
      }
      if (!res.ok) {
        setError(res.error);
        setRequestId(null);
        return;
      }
      setResult(res.data);
      setStep("done");
    });
  }

  return (
    <div className="space-y-5">
      <StepHeader step={step} />

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>
            {error.code === "IMPORT_ROW_ERROR"
              ? "Import failed; nothing was saved"
              : "Something went wrong"}
          </AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}

      {unconfirmed ? (
        <Alert role="alert">
          <AlertTitle>Import result unconfirmed</AlertTitle>
          <AlertDescription>
            The connection dropped before the server answered. The batch may or may not have been
            saved. Retry: the same request id is reused, so a successful import will not be
            duplicated.
          </AlertDescription>
          <div className="mt-2">
            <Button type="button" size="sm" onClick={runCommit} disabled={pending}>
              Retry safely
            </Button>
          </div>
        </Alert>
      ) : null}

      {step === "upload" ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <FileUpIcon className="text-muted-foreground mx-auto mb-3 size-6" aria-hidden />
          <Label htmlFor="csv-file" className="block text-sm font-medium">
            Choose a CSV file
          </Label>
          <p className="text-muted-foreground mt-1 text-xs">
            Up to {Math.round(IMPORT_MAX_BYTES / 1000)} KB and 500 rows. Company and role columns
            are required.
          </p>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            className="file:bg-background mx-auto mt-4 block text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5 file:text-sm"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
      ) : null}

      {step === "map" && mapping ? (
        <div className="space-y-5">
          <div className="text-sm">
            <span className="font-medium">{fileName}</span> · {rowCount} data rows ·{" "}
            {headers.length} columns
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map((h, i) => (
                    <TableHead key={i}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sample.map((row, r) => (
                  <TableRow key={r}>
                    {row.map((cell, c) => (
                      <TableCell key={c} className="max-w-[200px] truncate text-xs">
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {IMPORT_FIELDS.map((field) => (
              <MappingSelect
                key={field}
                field={field}
                headers={headers}
                value={mapping[field]}
                onChange={(v) => setMapping({ ...mapping, [field]: v })}
              />
            ))}
          </div>
          {missingRequiredMappings(mapping).length ? (
            <p className="text-destructive text-sm" role="alert">
              Map the required columns:{" "}
              {missingRequiredMappings(mapping)
                .map((f) => IMPORT_FIELD_LABELS[f])
                .join(", ")}
              .
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={runPreview}
              disabled={pending || missingRequiredMappings(mapping).length > 0}
            >
              {pending ? "Validating…" : "Validate rows"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep("upload")}
              disabled={pending}
            >
              Choose a different file
            </Button>
          </div>
        </div>
      ) : null}

      {step === "preview" && preview ? (
        <PreviewTable
          preview={preview}
          choices={choices}
          setChoices={setChoices}
          selectedCount={selectedRows.length}
          blockedCount={blockedSelections.length}
          pending={pending}
          onBack={() => setStep("map")}
          onCommit={runCommit}
        />
      ) : null}

      {step === "done" && result ? (
        <div className="space-y-4 rounded-lg border p-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2Icon className="size-5 text-emerald-600" aria-hidden />
            {result.replayed
              ? "This import was already saved earlier; no rows were added twice."
              : result.summary}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground text-xs">Imported</dt>
              <dd className="font-medium">{result.imported ?? 0}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Skipped</dt>
              <dd className="font-medium">
                {(preview?.rows.length ?? 0) - (result.imported ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Blank rows dropped</dt>
              <dd className="font-medium">{preview?.blankRowsSkipped ?? 0}</dd>
            </div>
          </dl>
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/">View applications</Link>
            </Button>
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              Import another file
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MappingSelect({
  field,
  headers,
  value,
  onChange,
}: {
  field: ImportField;
  headers: string[];
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const required = REQUIRED_IMPORT_FIELDS.includes(field);
  return (
    <div className="space-y-1">
      <Label htmlFor={`map-${field}`} className="text-xs">
        {IMPORT_FIELD_LABELS[field]}
        {required ? " *" : ""}
      </Label>
      <Select
        value={value === null ? SKIP : String(value)}
        onValueChange={(v) => onChange(v === SKIP ? null : Number(v))}
      >
        <SelectTrigger
          id={`map-${field}`}
          className="w-full"
          aria-invalid={required && value === null}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SKIP}>— Not imported —</SelectItem>
          {headers.map((h, i) => (
            <SelectItem key={i} value={String(i)}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PreviewTable({
  preview,
  choices,
  setChoices,
  selectedCount,
  blockedCount,
  pending,
  onBack,
  onCommit,
}: {
  preview: PreviewState;
  choices: Record<number, RowChoice>;
  setChoices: React.Dispatch<React.SetStateAction<Record<number, RowChoice>>>;
  selectedCount: number;
  blockedCount: number;
  pending: boolean;
  onBack: () => void;
  onCommit: () => void;
}) {
  const errorRows = preview.rows.filter((r) => r.errors.length > 0).length;
  const flaggedRows = preview.rows.filter(isFlagged).length;
  const validRows = preview.rows.length - errorRows;

  const setChoice = (rowIndex: number, patch: Partial<RowChoice>) =>
    setChoices((c) => ({
      ...c,
      [rowIndex]: { ...(c[rowIndex] ?? { include: false, importSeparate: false }), ...patch },
    }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          <span className="font-medium">{validRows}</span> valid
        </span>
        <span className={cn(flaggedRows && "text-amber-700 dark:text-amber-300")}>
          <span className="font-medium">{flaggedRows}</span> possible duplicates
        </span>
        <span className={cn(errorRows && "text-destructive")}>
          <span className="font-medium">{errorRows}</span> with errors (cannot be imported)
        </span>
        {preview.blankRowsSkipped ? (
          <span className="text-muted-foreground">
            {preview.blankRowsSkipped} blank rows dropped
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <span className="sr-only">Include</span>
              </TableHead>
              <TableHead className="w-12">Row</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Applied</TableHead>
              <TableHead>Checks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.rows.map((row) => {
              const choice = choices[row.rowIndex] ?? { include: false, importSeparate: false };
              const flagged = isFlagged(row);
              const hasErrors = row.errors.length > 0;
              return (
                <TableRow
                  key={row.rowIndex}
                  data-testid="import-row"
                  data-state={hasErrors ? "error" : flagged ? "flagged" : "valid"}
                >
                  <TableCell>
                    <Checkbox
                      aria-label={`Include row ${row.rowIndex}`}
                      checked={choice.include}
                      disabled={hasErrors}
                      onCheckedChange={(v) => setChoice(row.rowIndex, { include: v === true })}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs tabular-nums">
                    {row.rowIndex}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate">
                    {row.values?.company ?? row.raw.company}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate">
                    {row.values?.title ?? row.raw.title}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.values
                      ? STATUS_LABELS[(row.values.status ?? "SAVED") as ApplicationStatus]
                      : (row.raw.status ?? "")}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {row.values?.appliedAt ?? (row.raw.appliedAt ? row.raw.appliedAt : "—")}
                  </TableCell>
                  <TableCell className="space-y-1 text-xs">
                    {row.errors.map((e, i) => (
                      <p key={`e${i}`} className="text-destructive flex items-start gap-1">
                        <CircleAlertIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
                        <span>
                          <span className="sr-only">Error: </span>
                          {IMPORT_FIELD_LABELS[e.field as ImportField] ?? "Row"}: {e.message}
                        </span>
                      </p>
                    ))}
                    {row.warnings.map((w, i) => (
                      <p
                        key={`w${i}`}
                        className="flex items-start gap-1 text-amber-700 dark:text-amber-300"
                      >
                        <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
                        <span>
                          <span className="sr-only">Warning: </span>
                          {w.message}
                        </span>
                      </p>
                    ))}
                    {row.duplicates.map((d) => (
                      <p
                        key={d.applicationId}
                        className="flex items-start gap-1 text-amber-700 dark:text-amber-300"
                      >
                        <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
                        <span>
                          Looks like existing{" "}
                          <Link
                            href={`/applications/${d.applicationId}`}
                            className="underline"
                            target="_blank"
                          >
                            {d.company} — {d.title}
                          </Link>{" "}
                          ({d.matchedOn.join(", ").replace(/_/g, " ")})
                        </span>
                      </p>
                    ))}
                    {row.duplicateOfRows.length ? (
                      <p className="flex items-start gap-1 text-amber-700 dark:text-amber-300">
                        <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
                        <span>Duplicates row {row.duplicateOfRows.join(", ")} in this file</span>
                      </p>
                    ) : null}
                    {flagged && !hasErrors ? (
                      <label className="flex items-center gap-1.5 pt-1">
                        <Checkbox
                          checked={choice.importSeparate}
                          onCheckedChange={(v) =>
                            setChoice(row.rowIndex, {
                              importSeparate: v === true,
                              include: v === true ? true : choice.include,
                            })
                          }
                          aria-label={`Import row ${row.rowIndex} as a separate application`}
                        />
                        <span>Import as a separate application</span>
                      </label>
                    ) : null}
                    {!hasErrors && !flagged && row.warnings.length === 0 ? (
                      <span className="text-muted-foreground">OK</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {blockedCount > 0 ? (
        <p className="text-sm text-amber-700 dark:text-amber-300" role="alert">
          {blockedCount} selected {blockedCount === 1 ? "row is" : "rows are"} flagged as possible
          duplicates. Uncheck them to skip, or mark them &ldquo;Import as a separate
          application&rdquo;.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={onCommit}
          disabled={pending || selectedCount === 0 || blockedCount > 0}
        >
          {pending
            ? "Importing…"
            : `Import ${selectedCount} ${selectedCount === 1 ? "row" : "rows"}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
          Back to mapping
        </Button>
        <p className="text-muted-foreground text-xs">
          All selected rows are saved together, or none are.
        </p>
      </div>
    </div>
  );
}
