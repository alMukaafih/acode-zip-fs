import type { File, FileSystem, FS, Stat } from "acode/utils/fileSystem";
import { unzip as _unzip, zip as _zip, type Unzipped } from "fflate";
import { basename, dirname, join } from "./path";
import { ZipFiles } from "./zipFiles";

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

function zip(unzipped: Unzipped): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		_zip(unzipped, (err, data) => {
			if (err) {
				reject(err);
			}
			resolve(data);
		});
	});
}

interface PathInfo {
	resolved: [string, string];
	isFile: boolean;
	isDirectory: boolean;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class ZipFS {
	/** empty directories created */
	emptyDirs: Record<string, boolean> = {};
	/** resolved paths */
	paths: Record<string, PathInfo> = {};
	/** cached zip files */
	zipFiles: Record<string, Unzipped> = ZipFiles();
	timers: Record<string, number> = {};
	fs: FS;

	constructor() {
		this.fs = acode.require("fs");
	}

	async resolvePath(url: string): Promise<PathInfo> {
		let path = url.replace(/^zip:\/\//, "").replace(/\/$/, "");
		if (this.paths[url]) {
			return this.paths[url];
		}

		// check if the zip file is cached
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

		// 1. set isFile = false, try to read file at path, on success set isFile = true
		// 2. if file is present, try to uncompress it as a zip file
		// 3. if successfull, cache zip file, then return resolved path i.e [/* path to zip */, /* path in zip file */];
		// 4. on failure for 2. and 3. if isFile is true then we have a regular file, break out of loop.
		//      if path does not end in ".backup" set path = path + ".backup", then go back to step 1.
		// 5. get parent of path
		// 6. if parent exists, set path = parent
		// 7. if parent does not exists, then we have an error;
		const path0 = path;
		let isFile: boolean;
		for (;;) {
			isFile = false;
			try {
				const f = this.fs(`file://${path}`);
				const buffer = await f.readFile();
				isFile = true;
				this.zipFiles[path] = await unzip(new Uint8Array(buffer));

				const pathInfo: PathInfo = {
					resolved: [path, path0.replace(new RegExp(`^${path}/`), "")],
					isFile: false,
					isDirectory: false,
				};
				this.paths[url] = pathInfo;
				return pathInfo;
			} catch (_) {
				if (isFile) break; // we have a regular file
				if (!path.endsWith(".backup")) {
					path = `${path}.backup`;
					continue;
				}
			}

			const p = dirname(path);
			if (p) {
				path = p;
			} else {
				throw new Error(`File does not exist: ${url}`);
			}
		}

		const pathInfo: PathInfo = {
			resolved: ["", path0],
			isFile: false,
			isDirectory: false,
		};
		this.paths[url] = pathInfo;
		return pathInfo;
	}

	/**
	 *
	 * @param url
	 * @returns a string if it finds a regular path,
	 * a buffer if it finds a file in zip and
	 * an array of string if it finds a directory in zip.
	 */
	async resolve(url: string) {
		const pathInfo = await this.resolvePath(url);
		if (pathInfo.resolved[0].length === 0) {
			return `file://${pathInfo.resolved[1]}`;
		}

		const zipFile = this.zipFiles[pathInfo.resolved[0]];

		const inZip = pathInfo.resolved[1];
		const data = zipFile[inZip];
		if (data) {
			pathInfo.isFile = true;
			return data;
		}

		// if an empty directory was created return an empty array.
		if (this.emptyDirs[url]) {
			return [];
		}

		// try to see if any path in zip file starts with given url
		// and add it to its children
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
		throw new Error(`File does not exist: ${url}`);
	}

	async lsDir(url: string): Promise<File[]> {
		const data = await this.resolve(url);
		if (typeof data === "string") {
			return this.fs(data).lsDir();
		}

		if (Array.isArray(data)) {
			const files: File[] = [];
			for (const child in data) {
				files.push(await this.stat(join(url, child)));
			}

			return files;
		}
		throw new Error(`File is not a directory: ${url}`);
	}

	readFile(url: string): Promise<ArrayBuffer>;
	readFile(url: string, encoding: "utf-8"): Promise<string>;
	// biome-ignore lint/suspicious/noExplicitAny: ignore
	readFile(url: string, encoding: "json"): Promise<any>;
	async readFile(
		url: string,
		encoding?: "utf-8" | "json",
	): Promise<ArrayBuffer | string> {
		const data = await this.resolve(url);
		if (typeof data === "string") {
			return this.fs(data).readFile(encoding as "utf-8");
		}
		if (Array.isArray(data)) {
			throw new Error(`File is a directory: ${url}`);
		}

		if (encoding === "utf-8") {
			return decoder.decode(data);
		} else if (encoding === "json") {
			return JSON.parse(decoder.decode(data));
		} else {
			return data.buffer as ArrayBuffer;
		}
	}

	async writeFile(url: string, content: string | ArrayBuffer): Promise<void> {
		const data = await this.resolve(url);
		if (typeof data === "string") {
			return this.fs(data).writeFile(content);
		}
		const pathInfo = this.paths[url];
		if (pathInfo.isDirectory) {
			throw new Error(`File is a directory: ${url}`);
		}

		const zipFile = this.zipFiles[pathInfo.resolved[0]];
		const inZip = pathInfo.resolved[1];

		if (typeof content === "string") {
			zipFile[inZip] = encoder.encode(content);
		} else {
			zipFile[inZip] = new Uint8Array(content);
		}
		this.saveZip(pathInfo.resolved[0]);
	}

	async createFile(
		url: string,
		name: string,
		content?: string | ArrayBuffer,
	): Promise<string> {
		const data = await this.resolve(url);
		if (typeof data === "string") {
			// content type of ArrayBuffer is only used internally
			return this.fs(data).createFile(name, content as string);
		}

		const pathInfo = this.paths[url];
		if (pathInfo.isFile) {
			throw new Error(`File is not a directory: ${url}`);
		}

		const zipFile = this.zipFiles[pathInfo.resolved[0]];

		const newPath = join(url, name);
		if (typeof content === "undefined") {
			zipFile[newPath] = new Uint8Array();
		} else if (typeof content === "string") {
			zipFile[newPath] = encoder.encode(content);
		} else {
			zipFile[newPath] = new Uint8Array(content);
		}
		this.saveZip(pathInfo.resolved[0]);

		if (this.emptyDirs[url]) {
			delete this.emptyDirs[url];
		}

		return newPath;
	}

	async createDirectory(url: string, name: string): Promise<string> {
		const data = await this.resolve(url);
		if (typeof data === "string") {
			return this.fs(data).createDirectory(name);
		}

		const pathInfo = this.paths[url];
		if (pathInfo.isFile) {
			throw new Error(`File is not a directory: ${url}`);
		}
		const newPath = join(url, name);
		this.emptyDirs[newPath] = true;
		return newPath;
	}

	async delete(url: string): Promise<void> {
		const data = await this.resolve(url);
		if (typeof data === "string") {
			return this.fs(data).delete();
		}

		const pathInfo = this.paths[url];

		if (this.emptyDirs[url]) {
			delete this.emptyDirs[url];
		} else if (Array.isArray(data)) {
			const zipFile = this.zipFiles[pathInfo.resolved[0]];
			for (const child of data) {
				delete zipFile[join(pathInfo.resolved[1], child)];
			}
		} else {
			const zipFile = this.zipFiles[pathInfo.resolved[0]];
			const inZip = pathInfo.resolved[1];
			delete zipFile[inZip];
		}
	}

	validateUrl(url: string, action: string) {
		if (url.startsWith("file:")) {
			return url.replace(/^file:/, "").replace(/\/$/, "zip:");
		} else if (url.startsWith("zip:")) {
			return url;
		} else {
			throw new Error(`${action} to ${url} is not supported`);
		}
	}

	async copyTo(url: string, destination: string): Promise<string> {
		const srcData = await this.resolve(url);
		const srcInfo = this.paths[url];

		destination = this.validateUrl(url, "Copy");

		let destData: string | string[] | Uint8Array<ArrayBufferLike>;
		try {
			destData = await this.resolve(destination);
		} catch (_) {
			const parent = dirname(destination);
			if (parent) destData = await this.resolve(parent);
			else throw new Error(`File does not exist: ${url}`);
		}
		const destInfo = this.paths[destination];

		if (typeof destData === "string") {
			if (typeof srcData === "string") {
				// regular copy
				return this.fs(srcData).copyTo(destData);
			}
		} else if (Array.isArray(destData)) {
			// we are copying to a zip file
			if (typeof srcData === "string") {
			} else if (Array.isArray(srcData)) {
				const srcZip = this.zipFiles[srcInfo.resolved[0]];
				const destZip = this.zipFiles[destInfo.resolved[0]];

				for (const child of srcData) {
					destZip[join(destInfo.resolved[1], child)] =
						srcZip[join(srcInfo.resolved[1], child)];
				}

				this.saveZip(srcInfo.resolved[0]);
				this.saveZip(destInfo.resolved[0]);
			} else {
				this.createFile(
					destination,
					basename(url),
					srcData.buffer as ArrayBuffer,
				);
				return join(destination, basename(url));
			}
		} else {
			if (typeof srcData === "string") {
			} else if (Array.isArray(srcData)) {
			} else {
				this.writeFile(destination, srcData.buffer as ArrayBuffer);
			}
		}

		// const destZip = this.zipFiles[destInfo.resolved[0]];
		throw new Error("Method not implemented.");
	}

	async moveTo(url: string, destination: string): Promise<string> {
		destination = this.validateUrl(url, "Move");
		const res = await this.copyTo(url, destination);
		this.delete(url);
		return res;
	}

	renameTo(url: string, newName: string): Promise<string> {
		const parent = dirname(url);
		if (!parent) {
			throw new Error(`File does not exist: ${url}`);
		}
		const destination = join(parent, newName);
		return this.moveTo(url, destination);
	}

	async exists(url: string): Promise<boolean> {
		const data = await this.resolve(url);
		if (typeof data === "string") {
			return this.fs(data).exists();
		}

		try {
			await this.stat(url);
			return true;
		} catch (_) {
			return false;
		}
	}

	async stat(url: string): Promise<Stat> {
		const data = await this.resolve(url);
		if (typeof data === "string") {
			return this.fs(data).stat();
		}

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

	async saveZip(path: string) {
		try {
			this.fs(`file://${path}.backup`).delete();
		} catch (_) {}
		const fs = this.fs(`file://${path}`);

		try {
			fs.copyTo(`file://${path}.backup`);
		} catch (_) {
			throw new Error(`Failed to backup zip file: ${path}`);
		}

		fs.writeFile((await zip(this.zipFiles[path])).buffer as ArrayBuffer);
	}
}

export function createFs(url: string, zipFs: ZipFS): FileSystem {
	return {
		lsDir: (): Promise<File[]> => zipFs.lsDir(url),
		// @ts-ignore
		readFile: (encoding) => zipFs.readFile(url, encoding),
		writeFile: (content) => zipFs.writeFile(url, content),
		createFile: (name: string, content?: string) =>
			zipFs.createFile(url, name, content),
		createDirectory: (name: string) => zipFs.createDirectory(url, name),
		delete: (): Promise<void> => zipFs.delete(url),
		copyTo: (destination: string) => zipFs.copyTo(url, destination),
		moveTo: (destination: string) => zipFs.moveTo(url, destination),
		renameTo: (newName: string) => zipFs.renameTo(url, newName),
		exists: () => zipFs.exists(url),
		stat: () => zipFs.stat(url),
	};
}
