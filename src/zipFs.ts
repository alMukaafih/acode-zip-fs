import type { File, FileSystem, Stat } from "acode/utils/fileSystem";
import { unzip as _unzip, type Unzipped } from "fflate";
import { basename, dirname, join } from "./path";

function unzip(data: Uint8Array): Promise<Unzipped> {
	return new Promise((resolve, reject) => {
		_unzip(data, (err, unzipped) => {
			if (err) {
				reject(err);
			}
			resolve(unzipped);
		});
	});
}

interface PathInfo {
	resolved: [string, string];
	isFile: boolean;
	isDirectory: boolean;
}

const decoder = new TextDecoder();

export class ZipFS {
	cache: Record<string, string> = {};
	paths: Record<string, PathInfo> = {};
	zipFiles: Record<string, Unzipped> = {};

	async resolvePath(url: string): Promise<PathInfo> {
		const fs = acode.require("fs");

		let path = url.replace(/^zip:/, "").replace(/\/$/, "");
		if (this.paths[url]) {
			return this.paths[url];
		}

		for (const [name, _] of Object.entries(this.zipFiles)) {
			const regex = new RegExp(`^${name}/(.*)`);
			const match = path.match(regex);
			if (match) {
				const rest = match[1];
				const pathInfo: PathInfo = {
					resolved: [name, rest],
					isFile: false,
					isDirectory: false,
				};
				this.paths[url] = pathInfo;
				return pathInfo;
			}
		}

		const path0 = path;
		for (;;) {
			try {
				const f = fs(`file:${path}`);
				const buffer = await f.readFile();
				this.zipFiles[path] = await unzip(new Uint8Array(buffer));
				const pathInfo: PathInfo = {
					resolved: [path, path0.replace(new RegExp(`^${path}/`), "")],
					isFile: false,
					isDirectory: false,
				};
				this.paths[url] = pathInfo;
				return pathInfo;
			} catch (_e) {
				const p = dirname(path);
				if (p) {
					path = p;
				} else {
					throw new Error(`Invalid path: ${url}`);
				}
			}
		}
	}

	async resolve(url: string) {
		const pathInfo = await this.resolvePath(url);
		const zipFile = this.zipFiles[pathInfo.resolved[0]];

		const inZip = pathInfo.resolved[1];
		const data = zipFile[inZip];
		if (data) {
			pathInfo.isFile = true;
			return data;
		}

		let children: string[] | undefined;
		for (const [path] of Object.entries(zipFile)) {
			const match = path.match(new RegExp(`^${inZip}/(.*)`));
			if (!match) continue;
			const child = match[1].split("/")[0];
			if (child.length > 0) {
				pathInfo.isDirectory = true;
				children = children || [];
				children.push(child);
			}
		}
		if (children) {
			return children;
		}
		throw new Error(`Invalid path: ${url}`);
	}

	async lsDir(url: string): Promise<File[]> {
		const data = await this.resolve(url);
		if (Array.isArray(data)) {
			const files: File[] = [];
			for (const child in data) {
				files.push(await this.stat(join(url, child)));
			}

			return files;
		}
		throw new Error("Operation not supported");
	}

	readFile(url: string): Promise<ArrayBuffer>;
	readFile(url: string, encoding: "utf-8"): Promise<string>;
	readFile(url: string, encoding: "json"): Promise<any>;
	async readFile(
		url: string,
		encoding?: "utf-8" | "json",
	): Promise<ArrayBuffer | string> {
		const data = await this.resolve(url);
		if (Array.isArray(data)) {
			throw new Error("Method not implemented.");
		}

		if (encoding === "utf-8") {
			return decoder.decode(data);
		} else if (encoding === "json") {
			return JSON.parse(decoder.decode(data));
		} else {
			return data.buffer;
		}
	}

	writeFile(url: string, content: string | ArrayBuffer): Promise<void> {
		throw new Error("Method not implemented.");
	}

	createFile(url: string, name: string, content?: string): Promise<string> {
		throw new Error("Method not implemented.");
	}

	createDirectory(url: string, name: string): Promise<string> {
		throw new Error("Method not implemented.");
	}

	delete(): Promise<void> {
		throw new Error("Method not implemented.");
	}

	copyTo(url: string, destination: string): Promise<string> {
		throw new Error("Method not implemented.");
	}

	moveTo(url: string, destination: string): Promise<string> {
		throw new Error("Method not implemented.");
	}

	renameTo(url: string, newName: string): Promise<string> {
		throw new Error("Method not implemented.");
	}

	async exists(url: string): Promise<boolean> {
		try {
			await this.stat(url);
			return true;
		} catch (_) {
			return false;
		}
	}

	async stat(url: string): Promise<Stat> {
		await this.resolve(url);
		const pathInfo = this.paths[url];

		return {
			name: basename(url),
			url,
			isFile: pathInfo.isFile,
			isDirectory: pathInfo.isDirectory,
			isLink: false,
			size: 0,
			modifiedDate: Date.now(),
			canRead: true,
			canWrite: true,
		};
	}
}
