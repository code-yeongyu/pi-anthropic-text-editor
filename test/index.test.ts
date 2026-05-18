import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TextContent } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	ANTHROPIC_TEXT_EDITOR_SECTION,
	addAnthropicTextEditorToPayload,
	executeTextEditorCommand,
	isAnthropicTextEditorEnabled,
} from "../src/index.js";

const ANTHROPIC_TEXT_EDITOR_ENV = "PI_ANTHROPIC_TEXT_EDITOR";

const tempDirectories = new Set<string>();

async function makeTempDirectory(): Promise<string> {
	const directoryPath = await mkdtemp(path.join(tmpdir(), "anthropic-text-editor-test-"));
	tempDirectories.add(directoryPath);
	return directoryPath;
}

afterEach(async () => {
	delete process.env[ANTHROPIC_TEXT_EDITOR_ENV];
	await Promise.all(
		[...tempDirectories].map(async (directoryPath) => {
			await rm(directoryPath, { recursive: true, force: true });
		}),
	);
	tempDirectories.clear();
});

describe("anthropic-text-editor extension", () => {
	it("is a no-op when env var is unset", () => {
		const payload = { tools: [{ name: "read", description: "function read" }] };
		const result = addAnthropicTextEditorToPayload("anthropic-messages", payload);
		expect(result).toBe(payload);
	});

	it("injects native text_editor_20250728 when enabled and no native tool exists", () => {
		process.env[ANTHROPIC_TEXT_EDITOR_ENV] = "true";
		const result = addAnthropicTextEditorToPayload("anthropic-messages", {
			tools: [{ name: "grep", description: "function grep" }],
		}) as { tools: Array<Record<string, unknown>> };

		expect(result.tools).toContainEqual({
			type: "text_editor_20250728",
			name: "str_replace_based_edit_tool",
		});
	});

	it("strips function-shape str_replace_based_edit_tool and preserves caller native tool", () => {
		process.env[ANTHROPIC_TEXT_EDITOR_ENV] = "on";

		const result = addAnthropicTextEditorToPayload("anthropic-messages", {
			tools: [
				{ name: "str_replace_based_edit_tool", input_schema: { type: "object" } },
				{ type: "text_editor_20250728", name: "str_replace_editor" },
			],
		}) as { tools: Array<Record<string, unknown>> };

		const nativeTools = result.tools.filter((tool) => tool["type"] === "text_editor_20250728");
		expect(nativeTools).toHaveLength(1);
		expect(nativeTools[0]).toEqual({ type: "text_editor_20250728", name: "str_replace_editor" });
	});

	it("isAnthropicTextEditorEnabled returns true for truthy values", () => {
		for (const envValue of ["1", "true", "yes", "on", " TRUE ", "\tYes\n"] as const) {
			process.env[ANTHROPIC_TEXT_EDITOR_ENV] = envValue;
			expect(isAnthropicTextEditorEnabled()).toBe(true);
		}
	});

	it("isAnthropicTextEditorEnabled returns false for falsy and unknown values", () => {
		for (const envValue of ["0", "false", "no", "off", "", "garbage"] as const) {
			process.env[ANTHROPIC_TEXT_EDITOR_ENV] = envValue;
			expect(isAnthropicTextEditorEnabled()).toBe(false);
		}
	});

	it("ANTHROPIC_TEXT_EDITOR_SECTION mentions text editor", () => {
		expect(ANTHROPIC_TEXT_EDITOR_SECTION.trim().length).toBeGreaterThan(0);
		expect(ANTHROPIC_TEXT_EDITOR_SECTION.toLowerCase()).toContain("text_editor");
	});

	it("view on existing file returns formatted contents with line numbers", async () => {
		const directoryPath = await makeTempDirectory();
		const filePath = path.join(directoryPath, "file.txt");
		await writeFile(filePath, "first\nsecond\nthird", "utf-8");

		const result = await executeTextEditorCommand({ command: "view", path: filePath });
		expect(result.isError).toBeUndefined();
		const text = (result.content[0] as TextContent).text;
		expect(text).toContain("1\tfirst");
		expect(text).toContain("2\tsecond");
		expect(text).toContain("3\tthird");
	});

	it("view on existing file returns requested line range", async () => {
		const directoryPath = await makeTempDirectory();
		const filePath = path.join(directoryPath, "file.txt");
		await writeFile(filePath, "first\nsecond\nthird", "utf-8");

		const result = await executeTextEditorCommand({ command: "view", path: filePath, view_range: [2, 2] });

		expect(result.isError).toBeUndefined();
		expect(result.content[0]).toEqual({ type: "text", text: "2\tsecond" });
	});

	it("create writes new file successfully", async () => {
		const directoryPath = await makeTempDirectory();
		const filePath = path.join(directoryPath, "new.txt");
		const result = await executeTextEditorCommand({ command: "create", path: filePath, file_text: "hello" });
		expect(result.isError).toBeUndefined();
		expect(await readFile(filePath, "utf-8")).toBe("hello");
	});

	it("create returns access errors other than missing file", async () => {
		const directoryPath = await makeTempDirectory();
		const filePath = path.join(directoryPath, "existing-file");
		await writeFile(filePath, "already here", "utf-8");

		const result = await executeTextEditorCommand({
			command: "create",
			path: path.join(filePath, "child.txt"),
			file_text: "new content",
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("not a directory");
	});

	it("str_replace with single match performs replacement", async () => {
		const directoryPath = await makeTempDirectory();
		const filePath = path.join(directoryPath, "replace.txt");
		await writeFile(filePath, "hello world", "utf-8");
		const result = await executeTextEditorCommand({
			command: "str_replace",
			path: filePath,
			old_str: "world",
			new_str: "there",
		});
		expect(result.isError).toBeUndefined();
		expect(await readFile(filePath, "utf-8")).toBe("hello there");
	});

	it("str_replace reports no match without changing file", async () => {
		const directoryPath = await makeTempDirectory();
		const filePath = path.join(directoryPath, "replace.txt");
		await writeFile(filePath, "hello world", "utf-8");

		const result = await executeTextEditorCommand({
			command: "str_replace",
			path: filePath,
			old_str: "missing",
			new_str: "there",
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toBe("No match found for replacement");
		expect(await readFile(filePath, "utf-8")).toBe("hello world");
	});

	it("str_replace reports multiple matches without changing file", async () => {
		const directoryPath = await makeTempDirectory();
		const filePath = path.join(directoryPath, "replace.txt");
		await writeFile(filePath, "hello hello", "utf-8");

		const result = await executeTextEditorCommand({
			command: "str_replace",
			path: filePath,
			old_str: "hello",
			new_str: "there",
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toBe("Multiple matches found; provide more context");
		expect(await readFile(filePath, "utf-8")).toBe("hello hello");
	});

	it("view lists directories", async () => {
		const directoryPath = await makeTempDirectory();
		await mkdir(path.join(directoryPath, "subdir"));
		await writeFile(path.join(directoryPath, "file.txt"), "contents", "utf-8");

		const result = await executeTextEditorCommand({ command: "view", path: directoryPath });

		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("d subdir/");
		expect(result.content[0]?.text).toContain("- file.txt");
	});

	it("insert at line 0 inserts at beginning", async () => {
		const directoryPath = await makeTempDirectory();
		const filePath = path.join(directoryPath, "insert.txt");
		await writeFile(filePath, "b\nc", "utf-8");
		const result = await executeTextEditorCommand({
			command: "insert",
			path: filePath,
			insert_line: 0,
			new_str: "a",
		});
		expect(result.isError).toBeUndefined();
		expect(await readFile(filePath, "utf-8")).toBe("a\nb\nc");
	});
});
