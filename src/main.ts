import type { WCPage } from "acode/editor/page";
import type { FileSystem, FileUrl } from "acode/utils/fileSystem";
import plugin from "../plugin.json";

const fs = acode.require("fs") as Fs;

class AcodePlugin {
	public baseUrl: string | undefined;

	async init(
		_$page: WCPage,
		cacheFile: FileSystem,
		cacheFileUrl: string,
	): Promise<void> {
		// Add your initialization code here
		// fs.extend()
	}

	async destroy() {
		// Add your cleanup code here
	}
}

if (window.acode) {
	const acodePlugin = new AcodePlugin();
	acode.setPluginInit(
		plugin.id,
		async (baseUrl: string, $page: WCPage, { cacheFileUrl, cacheFile }) => {
			if (!baseUrl.endsWith("/")) {
				baseUrl += "/";
			}
			acodePlugin.baseUrl = baseUrl;
			await acodePlugin.init($page, cacheFile, cacheFileUrl);
		},
	);
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

	extend(test: string, fs: (url: string) => FileSystem): void;
	remove(test: string): void;
}
