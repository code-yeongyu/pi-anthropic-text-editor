import { access, lstat, readdir, readFile, writeFile } from "node:fs/promises";
import type { Api, TextContent } from "@mariozechner/pi-ai";
import type { AgentToolResult, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type Static, Type } from "typebox";

type ToolDefinition = Record<string, unknown>;

const ANTHROPIC_TEXT_EDITOR_ENV = "PI_ANTHROPIC_TEXT_EDITOR";
const ANTHROPIC_NATIVE_TEXT_EDITOR_TOOL = {
	type: "text_editor_20250728",
	name: "str_replace_based_edit_tool",
} as const;

const textEditorSchema = Type.Object({
	command: Type.Union(
		[Type.Literal("view"), Type.Literal("create"), Type.Literal("str_replace"), Type.Literal("insert")],
		{ description: "The text editor command to execute" },
	),
	path: Type.String({ description: "Absolute path to the target file" }),
	view_range: Type.Optional(
		Type.Array(Type.Number(), {
			minItems: 2,
			maxItems: 2,
			description: "[start_line, end_line] inclusive 1-indexed; -1 for end of file",
		}),
	),
	file_text: Type.Optional(Type.String({ description: "File content for create" })),
	old_str: Type.Optional(Type.String({ description: "Exact string to replace" })),
	new_str: Type.Optional(Type.String({ description: "Replacement string" })),
	insert_line: Type.Optional(
		Type.Number({ description: "Line number AFTER which to insert (0 = beginning of file)" }),
	),
});

export type TextEditorInput = Static<typeof textEditorSchema>;
export type TextEditorCommandResult = {
	content: TextContent[];
	details?: undefined;
	isError?: boolean;
};

export class TextEditorCommandExecutionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TextEditorCommandExecutionError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isTextEditorType(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("text_editor_");
}

function success(text: string): TextEditorCommandResult {
	return { content: [{ type: "text", text }] };
}

function failure(text: string): TextEditorCommandResult {
	return { content: [{ type: "text", text }], isError: true };
}

function formatWithLineNumbers(content: string): string {
	const lines = content.split("\n");
	return lines.map((line, index) => `${index + 1}\t${line}`).join("\n");
}

function formatRangeWithLineNumbers(content: string, viewRange: [number, number] | undefined): string {
	if (!viewRange) {
		return formatWithLineNumbers(content);
	}

	const [startLine, endLineRaw] = viewRange;
	const allLines = content.split("\n");
	const endLine = endLineRaw === -1 ? allLines.length : endLineRaw;
	const safeStart = Math.max(1, startLine);
	const safeEnd = Math.min(allLines.length, endLine);
	if (safeStart > safeEnd) {
		return "";
	}

	const selectedLines = allLines.slice(safeStart - 1, safeEnd);
	return selectedLines.map((line, index) => `${safeStart + index}\t${line}`).join("\n");
}

function sanitizeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return "Unknown file system error";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function parseViewRange(viewRange: TextEditorInput["view_range"]): [number, number] | undefined {
	if (!viewRange) {
		return undefined;
	}

	const [startLine, endLine] = viewRange;
	if (typeof startLine !== "number" || typeof endLine !== "number") {
		return undefined;
	}

	return [startLine, endLine];
}

async function executeView(input: TextEditorInput): Promise<TextEditorCommandResult> {
	const targetPath = input.path;
	try {
		const stats = await lstat(targetPath);
		if (stats.isDirectory()) {
			const entries = await readdir(targetPath, { withFileTypes: true });
			const listing = entries
				.map((entry) => `${entry.isDirectory() ? "d" : "-"} ${entry.name}${entry.isDirectory() ? "/" : ""}`)
				.join("\n");
			return success(listing);
		}

		const contents = await readFile(targetPath, "utf-8");
		const viewRange = parseViewRange(input.view_range);
		return success(formatRangeWithLineNumbers(contents, viewRange));
	} catch (error: unknown) {
		return failure(sanitizeError(error));
	}
}

async function executeCreate(input: TextEditorInput): Promise<TextEditorCommandResult> {
	if (typeof input.file_text !== "string") {
		return failure("Missing required field: file_text");
	}

	try {
		await access(input.path);
		return failure(`File already exists: ${input.path}`);
	} catch (error: unknown) {
		if (!isNodeError(error) || error.code !== "ENOENT") {
			return failure(sanitizeError(error));
		}
	}

	try {
		await writeFile(input.path, input.file_text, "utf-8");
		return success(`File created successfully at: ${input.path}`);
	} catch (error: unknown) {
		return failure(sanitizeError(error));
	}
}

async function executeStrReplace(input: TextEditorInput): Promise<TextEditorCommandResult> {
	if (typeof input.old_str !== "string") {
		return failure("Missing required field: old_str");
	}

	if (typeof input.new_str !== "string") {
		return failure("Missing required field: new_str");
	}

	try {
		const contents = await readFile(input.path, "utf-8");
		const firstIndex = contents.indexOf(input.old_str);
		if (firstIndex === -1) {
			return failure("No match found for replacement");
		}

		const secondIndex = contents.indexOf(input.old_str, firstIndex + 1);
		if (secondIndex !== -1) {
			return failure("Multiple matches found; provide more context");
		}

		const replaced = `${contents.slice(0, firstIndex)}${input.new_str}${contents.slice(firstIndex + input.old_str.length)}`;
		await writeFile(input.path, replaced, "utf-8");
		return success(`File updated successfully at: ${input.path}`);
	} catch (error: unknown) {
		return failure(sanitizeError(error));
	}
}

async function executeInsert(input: TextEditorInput): Promise<TextEditorCommandResult> {
	if (typeof input.insert_line !== "number") {
		return failure("Missing required field: insert_line");
	}

	if (typeof input.new_str !== "string") {
		return failure("Missing required field: new_str");
	}

	try {
		const contents = await readFile(input.path, "utf-8");
		const lines = contents.split("\n");
		const lineNumber = input.insert_line;

		if (lineNumber < 0 || lineNumber > lines.length) {
			return failure(`insert_line out of range: ${lineNumber}`);
		}

		lines.splice(lineNumber, 0, input.new_str);
		await writeFile(input.path, lines.join("\n"), "utf-8");
		return success(`File updated successfully at: ${input.path}`);
	} catch (error: unknown) {
		return failure(sanitizeError(error));
	}
}

export async function executeTextEditorCommand(input: TextEditorInput): Promise<TextEditorCommandResult> {
	switch (input.command) {
		case "view":
			return executeView(input);
		case "create":
			return executeCreate(input);
		case "str_replace":
			return executeStrReplace(input);
		case "insert":
			return executeInsert(input);
	}
}

function sanitizeTools(tools: unknown[]): ToolDefinition[] {
	const sanitizedTools: ToolDefinition[] = [];
	for (const tool of tools) {
		if (!isRecord(tool)) {
			continue;
		}

		const toolName = typeof tool.name === "string" ? tool.name : undefined;
		const shouldStripTextEditorFunctionShape =
			toolName === "str_replace_based_edit_tool" && !isTextEditorType(tool.type);
		const shouldStripReadWriteEditFunctionShape =
			(toolName === "read" || toolName === "write" || toolName === "edit") && !isTextEditorType(tool.type);
		if (!shouldStripTextEditorFunctionShape && !shouldStripReadWriteEditFunctionShape) {
			sanitizedTools.push(tool);
		}
	}
	return sanitizedTools;
}

export function isAnthropicTextEditorEnabled(): boolean {
	const value = process.env[ANTHROPIC_TEXT_EDITOR_ENV];
	if (!value) {
		return false;
	}

	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function addAnthropicTextEditorToPayload(api: Api | undefined, payload: unknown): unknown {
	if (api !== "anthropic-messages") {
		return payload;
	}

	if (!isAnthropicTextEditorEnabled()) {
		return payload;
	}

	if (!isRecord(payload)) {
		return payload;
	}

	const tools = Array.isArray(payload.tools) ? payload.tools : [];
	const sanitizedTools = sanitizeTools(tools);
	const hasNativeTextEditor = sanitizedTools.some((tool) => isTextEditorType(tool.type));
	if (!hasNativeTextEditor) {
		sanitizedTools.push(ANTHROPIC_NATIVE_TEXT_EDITOR_TOOL);
	}

	return {
		...payload,
		tools: sanitizedTools,
	};
}

export const ANTHROPIC_TEXT_EDITOR_SECTION = `
## Text Editor

The native text_editor tool is available in this session. Use the
str_replace_based_edit_tool with commands view, create, str_replace,
and insert to read and modify files. The local read/write/edit tools
are not exposed when this extension is active — use the native tool
exclusively for file operations.
`;

export default function anthropicTextEditorExtension(pi: ExtensionAPI): void {
	if (isAnthropicTextEditorEnabled()) {
		pi.registerTool({
			name: "str_replace_based_edit_tool",
			label: "Text Editor",
			description:
				"Use command=view/create/str_replace/insert to inspect and edit files. view supports optional view_range.",
			parameters: textEditorSchema,
			async execute(_toolCallId, params): Promise<AgentToolResult<undefined>> {
				const result = await executeTextEditorCommand(params);
				if (result.isError) {
					const firstContent = result.content[0];
					throw new TextEditorCommandExecutionError(
						firstContent?.type === "text" ? firstContent.text : "Text editor command failed",
					);
				}

				return {
					content: result.content,
					details: undefined,
				};
			},
		});
	}

	pi.on("before_provider_request", (event, ctx) => {
		return addAnthropicTextEditorToPayload(ctx.model?.api, event.payload);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (ctx.model?.api !== "anthropic-messages") {
			return undefined;
		}

		if (!isAnthropicTextEditorEnabled()) {
			return undefined;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n${ANTHROPIC_TEXT_EDITOR_SECTION}`,
		};
	});
}
