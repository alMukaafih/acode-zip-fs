import { zipSync } from "fflate";
import { expect, test } from "vitest";
import { ZipFS } from "./zipFs";

// @ts-ignore
window.acode = {
	// @ts-ignore
	require(module: "fs") {
		const modules = {
			fs(url: string) {
				return {
					readFile() {
						const data = {
							"file:/test/file.zip": zipSync({
								"path/in/zip/test_file.txt": new Uint8Array(
									new TextEncoder().encode("This is a test file"),
								),
								"path/in/zip/hello.txt": new Uint8Array(
									new TextEncoder().encode("Hello World!"),
								),
							}),
						}[url];
						if (data) {
							return data;
						} else {
							throw new Error("File not found");
						}
					},
				};
			},
		};

		return modules[module];
	},
};

const zipFS = new ZipFS();

test("correctly resolves path", () => {
	zipFS
		.resolvePath("zip:/test/file.zip/path/in/zip/test_file.txt")
		.then((pathInfo) => {
			expect(pathInfo.resolved[0]).toBe("/test/file.zip");
			expect(pathInfo.resolved[1]).toBe("path/in/zip/test_file.txt");
		});
});

test("resolves file", () => {
	zipFS.resolve("zip:/test/file.zip/path/in/zip/test_file.txt").then((data) => {
		expect(new TextDecoder().decode(data as Uint8Array)).toBe(
			"This is a test file",
		);
	});
});

test("resolves directory", () => {
	zipFS.resolve("zip:/test/file.zip/path/in/zip/").then((data) => {
		const children = data as string[];
		expect(children).toContain("test_file.txt");
		expect(children).toContain("hello.txt");
	});
});
