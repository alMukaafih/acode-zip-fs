import type { WCPage } from "acode/editor/page";
import type { FileSystem, FileUrl } from "acode/utils/fileSystem";
import plugin from "../plugin.json";
import { createFs, ZipFS } from "./zipFs";

const fs = acode.require("fs") as Fs;

class AcodePlugin {
	public baseUrl: string | undefined;

	test = (url: string) => /^zip:\/\//.test(url);

	async init(_$page: WCPage): Promise<void> {
		const zipFs = new ZipFS();
		fs.extend(this.test, (url) => createFs(url, zipFs));
	}

	async destroy() {
		fs.remove(this.test);
	}
}

if (window.acode) {
	const acodePlugin = new AcodePlugin();
	acode.setPluginInit(plugin.id, async (baseUrl: string, $page: WCPage) => {
		if (!baseUrl.endsWith("/")) {
			baseUrl += "/";
		}
		acodePlugin.baseUrl = baseUrl;
		await acodePlugin.init($page);
	});
	acode.setPluginUnmount(plugin.id, () => {
		acodePlugin.destroy();
	});
}

interface Fs {
	/**
	 * Create a file system object from a URL
	 * @param url URL of the file or directory
	 * @returns File system object
	 */
	(url0: `http:${string}`, ...url: string[]): FileUrl;
	(url0: `https:${string}`, ...url: string[]): FileUrl;
	(...url: string[]): FileSystem;

	extend(test: (url: string) => boolean, fs: (url: string) => FileSystem): void;
	remove(test: (url: string) => boolean): void;
}
