"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";

export type RichTextLetterEditorHandle = {
  insertTextAtCursor: (text: string) => void;
};

type Props = {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  minHeightClassName?: string;
  showToolbar?: boolean;
};

const RichTextLetterEditor = forwardRef<RichTextLetterEditorHandle, Props>(
  function RichTextLetterEditor(
    {
      value,
      onChange,
      placeholder,
      readOnly = false,
      className = "",
      minHeightClassName = "min-h-96",
      showToolbar = true,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    function updateValue(next: string) {
      onChange?.(next);
    }

    function insertTextAtCursor(text: string) {
      const textarea = textareaRef.current;

      if (!textarea || readOnly) {
        updateValue(`${value}${text}`);
        return;
      }

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const next = value.substring(0, start) + text + value.substring(end);

      updateValue(next);

      requestAnimationFrame(() => {
        textarea.focus();
        const cursorPosition = start + text.length;
        textarea.setSelectionRange(cursorPosition, cursorPosition);
      });
    }

    useImperativeHandle(ref, () => ({
      insertTextAtCursor,
    }));

    function wrapSelection(before: string, after = before) {
      const textarea = textareaRef.current;
      if (!textarea || readOnly || !onChange) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = value.slice(start, end);

      if (!selected) {
        alert("Highlight the text first.");
        return;
      }

      const replacement = `${before}${selected}${after}`;
      const next = value.substring(0, start) + replacement + value.substring(end);

      updateValue(next);

      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(start, start + replacement.length);
      });
    }

    function addList(type: "bullet" | "number") {
      const textarea = textareaRef.current;
      if (!textarea || readOnly || !onChange) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = value.substring(start, end);
      const lines = selected ? selected.split("\n") : [""];

      const replacement = lines
        .map((line, index) =>
          type === "bullet" ? `- ${line}` : `${index + 1}. ${line}`,
        )
        .join("\n");

      const next = value.substring(0, start) + replacement + value.substring(end);

      updateValue(next);

      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(start, start + replacement.length);
      });
    }

    function insertTable() {
      const columnInput = window.prompt("How many columns?", "3");
      if (columnInput === null) return;

      const rowInput = window.prompt(
        "How many data rows? The heading row is added automatically.",
        "2",
      );
      if (rowInput === null) return;

      const columnCount = Math.min(
        6,
        Math.max(1, Number.parseInt(columnInput, 10) || 3),
      );

      const rowCount = Math.min(
        20,
        Math.max(1, Number.parseInt(rowInput, 10) || 2),
      );

      const headerRow =
        "| " +
        Array.from(
          { length: columnCount },
          (_, index) => `Heading ${index + 1}`,
        ).join(" | ") +
        " |";

      const separatorRow =
        "| " +
        Array.from({ length: columnCount }, () => "---").join(" | ") +
        " |";

      const dataRows = Array.from({ length: rowCount }, () => {
        return (
          "| " +
          Array.from({ length: columnCount }, () => "Enter text").join(" | ") +
          " |"
        );
      });

      const tableText = [headerRow, separatorRow, ...dataRows].join("\n");

      const prefix =
        value.length > 0 && !value.endsWith("\n\n")
          ? value.endsWith("\n")
            ? "\n"
            : "\n\n"
          : "";

      const suffix = "\n\n";

      insertTextAtCursor(`${prefix}${tableText}${suffix}`);
    }

    return (
      <div className={className}>
        {showToolbar && !readOnly ? (
          <div className="mb-3 flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
            <button
              type="button"
              onClick={() => wrapSelection("**")}
              className="rounded-lg border bg-white px-3 py-1 text-sm font-bold"
            >
              B
            </button>

            <button
              type="button"
              onClick={() => wrapSelection("_")}
              className="rounded-lg border bg-white px-3 py-1 text-sm italic"
            >
              I
            </button>

            <button
              type="button"
              onClick={() => wrapSelection("__")}
              className="rounded-lg border bg-white px-3 py-1 text-sm underline"
            >
              U
            </button>

            <button
              type="button"
              onClick={() => addList("bullet")}
              className="rounded-lg border bg-white px-3 py-1 text-sm"
            >
              • List
            </button>

            <button
              type="button"
              onClick={() => addList("number")}
              className="rounded-lg border bg-white px-3 py-1 text-sm"
            >
              1. List
            </button>

            <button
              type="button"
              onClick={insertTable}
              className="rounded-lg border bg-white px-3 py-1 text-sm font-semibold"
              title="Insert a table"
            >
              ▦ Table
            </button>
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => updateValue(e.target.value)}
          className={[
            minHeightClassName,
            "w-full rounded-xl border border-slate-300 p-4 font-sans",
            readOnly ? "bg-slate-50" : "bg-white",
          ].join(" ")}
        />
      </div>
    );
  },
);

export default RichTextLetterEditor;